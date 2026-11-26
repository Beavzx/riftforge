// Rift Judge verification, range r10401 (question ids 10401-11700). See docs/riftjudge/README.md, log docs/riftjudge/r10401.md.
import { test } from 'node:test';
import {
  assert, S0, put, hand, play, pass, passN, control, act, move, mod, nextTurn, endTurn, setRunes, fundAll, addRunes,
  P0, P1, BF_A, BF_B, zone, locOf, mightOf, resolveChain, passAll, pend, answer, yes, no, choose, legal, canPlayNow, addPrevent,
  validateAction, activate, getView, hasKeyword, readyRunes, optionIds, attackSetup, needsScripts, cid, setBattlefieldCard, realCard, rejects, EventLog, playDests, chainLabels, moveDests, kwValue, clearDeck,
  type GameState, type ObjId,
} from '../conformance/harness.ts';
import { attachNow, playCostOf } from '../../src/engine/testkit.ts';
import { chars } from '../../src/engine/chars.ts';
import { playOptions, playCost } from '../../src/engine/play.ts';
import { withTokens, drive as drive11, unitsNamed as unitsNamed11 } from './r11701.helpers.ts';

const dbg = (g: GameState) => { const d = g.pending; return d ? `${d.kind} P${d.player} ${d.prompt} [${(d.options ?? []).map(o => o.id + '=' + o.label).join('; ')}]` : 'none'; };
void dbg;
type Pick = (g: GameState) => string[] | undefined;
/** Drive the game until a top-level main-phase decision: in-step decisions use `pick` (else yes / first option), chain and showdown decisions pass. Returns the state and the prompts seen. */
function drive(g: GameState, pick: Pick = () => undefined, limit = 40): { g: GameState; seen: string[] } {
  const seen: string[] = [];
  for (let i = 0; i < limit; i++) {
    const d = g.pending;
    if (!d || d.kind === 'mainAction') break;
    seen.push(`${d.kind}:P${d.player}:${d.prompt}`);
    if (d.kind === 'assignDamage') { const l = legal(g, d.player); assert.ok(l.length, 'no legal damage assignment offered'); g = act(g, l[0]); continue; }
    if (d.inStep) { const ids = pick(g) ?? (d.kind === 'optional' ? ['yes'] : [d.options![0].id]); g = act(g, { type: 'choose', player: d.player, optionIds: ids }); }
    else g = act(g, { type: 'pass', player: d.player });
  }
  return { g, seen };
}
/** Make p's legend a real legend card. */
function setLegend(g: GameState, p: typeof P0, name: string): ObjId { const d = realCard(name); g.cards = { ...g.cards, [d.id]: d }; const l = g.players[p].legend; g.objects[l].cardId = d.id; g.objects[l].exhausted = false; return l; }
/** Add real token definitions to the game's card pool. */
function tokens(g: GameState, ...names: string[]) { for (const n of names) { const d = realCard(n); g.cards = { ...g.cards, [d.id]: d }; } }
/** Put n copies of a card on top of p's Main Deck. */
function clearDeckTop(g: GameState, p: typeof P0, n: number, card: string) { for (let i = 0; i < n; i++) put(g, p, card, 'deckTop'); }
/** Make p the turn player of a quiescent S0 state (setup). */
function S0tp(g: GameState, p: typeof P0): GameState { g.activePlayer = p; g.pending = { kind: 'mainAction', player: p, prompt: 'Your turn', inStep: false } as GameState['pending']; g.timestamp++; return g; }
const logText = (g: GameState) => g.log.map(l => l.text).join('\n');

test('RJ#10401 Fizz: a spell played from the trash with Fizz that is countered is recycled, not trashed', () => {
  const g0 = S0(); fundAll(g0, P0); fundAll(g0, P1);
  const enemy = put(g0, P1, 'V(4)', BF_A); control(g0, BF_A, P1);
  const ray = put(g0, P0, 'Hextech Ray', 'trash');
  const fizz = hand(g0, P0, 'Fizz, Trickster');
  const ww = hand(g0, P1, 'Wind Wall');
  let g = passAll(play(g0, P0, fizz));
  g = answer(g, { targets: [[ray]] }, P0);   // Fizz's trash spell is chosen as his trigger is chained (RJ#10771)
  g = pass(pass(g));                         // the trigger resolves: Ray is played
  g = answer(g, { targets: [[enemy]] }, P0);
  g = pass(g);
  g = play(g, P1, ww, { targets: [[ray]] });
  g = passAll(g);
  assert.equal(g.objects[enemy].damage, 0, 'Hextech Ray was countered');
  assert.equal(zone(g, ray), 'mainDeck');
  assert.equal(g.players[P0].mainDeck.at(-1), ray, 'recycled to the bottom of the Main Deck');
});

test('RJ#10402 Immortal Phoenix: Cull the Weak killing Phoenix itself (and an enemy) lets you pay to play Phoenix from the trash', () => {
  const g0 = S0(); fundAll(g0, P0);
  const ph = put(g0, P0, 'Immortal Phoenix', 'base');
  const e = put(g0, P1, 'V(2)', 'base');
  const cull = hand(g0, P0, 'Cull the Weak');
  let g = play(g0, P0, cull);
  g = passAll(g);
  for (let i = 0; i < 4 && g.pending?.inStep && g.pending.player === P1; i++) g = choose(g, e);
  for (let i = 0; i < 4 && g.pending?.inStep && g.pending.player === P0 && g.pending.kind === 'chooseCards'; i++) g = choose(g, ph);
  assert.equal(zone(g, ph), 'trash'); assert.equal(zone(g, e), 'trash');
  g = answer(g, { may: [true] }, P0);
  g = passAll(g);
  if (g.pending?.kind === 'optional' && g.pending.player === P0) g = yes(g);
  g = passAll(g);
  assert.equal(zone(g, ph), 'base', 'Phoenix was played from the trash');
});


test('RJ#10403 Deceiver: the Reflection token played by the legend does not trigger Star Spring (non-token units only)', () => {
  const g0 = S0(); fundAll(g0, P0); setBattlefieldCard(g0, BF_A, 'Star Spring');
  setLegend(g0, P0, 'Deceiver'); tokens(g0, 'Reflection');
  const x = put(g0, P0, 'V(3)', 'base'); hand(g0, P0, 'V(1)');
  const { g, seen } = drive(move(g0, P0, [x], BF_A));
  assert.ok(/creates a Reflection token at Star Spring/.test(logText(g)), 'Reflection was played');
  assert.ok(!seen.some(s => /Star Spring|move another unit/i.test(s)), 'Star Spring did not trigger');
  assert.ok(!/Trigger: Star Spring/.test(logText(g)));
});

test('RJ#10404 Baited Hook on Ruined Rex: the played unit\'s play trigger resolves before the Deathknell', () => {
  const g0 = S0(); fundAll(g0, P0);
  const rex = put(g0, P0, 'Ruined Rex', 'base');
  put(g0, P1, 'V(5)', BF_A); control(g0, BF_A, P1);
  const hook = put(g0, P0, 'Baited Hook', 'base');
  const st = put(g0, P0, 'Evershade Stalker', 'deckTop');
  hand(g0, P0, 'V(1)');
  let g = act(g0, { type: 'activate', player: P0, obj: hook, abilityIndex: 0 });
  g = passAll(g);
  assert.equal(zone(g, rex), 'trash');
  g = choose(g, st);
  const labels = g.chain.map(c => String(c.label ?? ''));
  assert.equal(labels.length, 2);
  assert.match(labels[0], /Ruined Rex/, 'Deathknell is lower on the chain');
  assert.match(labels[1], /Evershade Stalker/, 'the play trigger is on top and resolves first');
});

test('RJ#10405 Hard Bargain: Repeat is decided while playing it; it cannot be added once the spell is on the chain', () => {
  const g0 = S0(); fundAll(g0, P0); fundAll(g0, P1);
  put(g0, P1, 'V(3)', BF_A); control(g0, BF_A, P1);
  const sp = hand(g0, P0, 'Hextech Ray'); const hb = hand(g0, P1, 'Hard Bargain');
  let g = pass(act(g0, { type: 'playCard', player: P0, obj: sp }));
  g = act(g, { type: 'playCard', player: P1, obj: hb });
  assert.equal(pend(g).kind, 'optional'); assert.match(pend(g).prompt, /Repeat/);
  g = no(g);
  assert.equal(g.chain.length, 2);
  assert.ok(!legal(g, pend(g).player).some(a => 'obj' in a && a.obj === hb), 'no way to add Repeat afterwards');
});

test('RJ#10406 Glasc Mixologist killed by Unchecked Power: its Deathknell may play a unit to the battlefield where it died', () => {
  const g0 = S0(); fundAll(g0, P0, 7);
  const mix = put(g0, P0, 'Glasc Mixologist', BF_A); control(g0, BF_A, P0);
  const v = put(g0, P0, 'V(2)', 'trash');
  const up = hand(g0, P0, 'Unchecked Power');
  let g = passAll(play(g0, P0, up));
  assert.equal(zone(g, mix), 'trash');
  let dests: string[] = [];
  const r = drive(g, gg => {
    const d = gg.pending!;
    if (d.kind === 'chooseCards' && d.options!.some(o => o.id === v)) return [v];
    if (d.kind === 'chooseDestination') { dests = d.options!.map(o => o.id); return [String(BF_A)]; }
    return undefined;
  });
  g = r.g;
  assert.ok(dests.includes(String(BF_A)), `BF-A offered as destination (got ${dests})`);
  assert.equal(locOf(g, v), BF_A, 'the unit was played to the battlefield where Mixologist died');
});

test('RJ#10407 Combat vs 2+2+1 defenders: a lone 6 kills all and conquers; 3+2 attackers trade off completely (no result, uncontrolled)', () => {
  const assign = (g: GameState, a: Record<ObjId, number>) => act(g, { type: 'assignDamage', player: pend(g).player, assignment: a });
  // A: one 6-Might attacker
  let { g, atk, def } = attackSetup(['V(6)'], ['V(2)', 'V(2)', 'V(1)']);
  for (let i = 0; i < 20; i++) {
    const d = g.pending!; if (d.kind === 'mainAction') break;
    if (d.kind === 'assignDamage') g = d.player === P0 ? assign(g, { [def[0]]: 2, [def[1]]: 2, [def[2]]: 2 }) : assign(g, { [atk[0]]: 5 });
    else if (d.inStep) g = choose(g, d.options![0].id); else g = pass(g);
  }
  assert.ok(def.every(d => zone(g, d) === 'trash'));
  assert.equal(locOf(g, atk[0]), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0); assert.equal(g.players[P0].points, 1, 'conquer');
  // B: 3 + 2 attackers
  ({ g, atk, def } = attackSetup(['V(3)', 'V(2)'], ['V(2)', 'V(2)', 'V(1)']));
  for (let i = 0; i < 20; i++) {
    const d = g.pending!; if (d.kind === 'mainAction') break;
    if (d.kind === 'assignDamage') g = d.player === P0 ? assign(g, { [def[0]]: 2, [def[1]]: 2, [def[2]]: 1 }) : assign(g, { [atk[0]]: 3, [atk[1]]: 2 });
    else if (d.inStep) g = choose(g, d.options![0].id); else g = pass(g);
  }
  assert.ok([...atk, ...def].every(d => zone(g, d) === 'trash'), 'everything dies');
  assert.equal(g.battlefields[BF_A].controller, null, 'uncontrolled');
  assert.equal(g.players[P0].points, 0, 'no conquer');
});

test('RJ#10409 Runes are readied in the Awaken phase, before Temporary triggers in the Beginning phase (so they can pay for responses)', () => {
  const g0 = S0();
  const t = put(g0, P1, 'Temp(2)', 'base');
  for (const r of g0.players[P1].runesInPlay) g0.objects[r].exhausted = true;
  let g = endTurn(g0, P0);
  assert.equal(zone(g, t), 'base', 'not killed before the trigger resolves');
  assert.ok(g.chain.length > 0 && /Temp/.test(String(g.chain[0].label)), 'Temporary trigger on the chain');
  assert.equal(readyRunes(g, P1), g.players[P1].runesInPlay.length, 'all of P1\'s runes are ready while it is pending');
  g = passAll(g);
  assert.equal(zone(g, t), 'trash');
});

test('RJ#10411 Elder Dragon: 1 damage is lethal for its controller, so it may assign 1 to the Tank and 1 to each other unit', () => {
  let { g, atk, def } = attackSetup(['Elder Dragon'], ['Tank(8)', 'V(6)', 'V(6)', 'V(6)']);
  for (let i = 0; i < 10 && pend(g).kind !== 'assignDamage'; i++) g = pass(g);
  assert.equal(pend(g).player, P0);
  assert.notEqual(validateAction(g, { type: 'assignDamage', player: P0, assignment: { [def[1]]: 4, [def[2]]: 3, [def[3]]: 3 } }), null, 'Tank still first');
  assert.equal(validateAction(g, { type: 'assignDamage', player: P0, assignment: { [def[0]]: 1, [def[1]]: 1, [def[2]]: 1, [def[3]]: 7 } }), null);
  g = act(g, { type: 'assignDamage', player: P0, assignment: { [def[0]]: 1, [def[1]]: 1, [def[2]]: 1, [def[3]]: 7 } });
  for (let i = 0; i < 10 && g.pending!.kind !== 'mainAction'; i++) { const d = g.pending!; g = d.kind === 'assignDamage' ? act(g, { type: 'assignDamage', player: d.player, assignment: { [atk[0]]: 26 } }) : d.inStep ? choose(g, d.options![0].id) : pass(g); }
  assert.ok(def.every(d => zone(g, d) === 'trash'), 'all four defenders die');
});

test('RJ#10412 Opponent moves onto my battlefield with Overzealous Fan: the attacker (contesting player) gets focus; Fan\'s defend trigger needs no focus', () => {
  const g0 = S0();
  const fan = put(g0, P1, 'Overzealous Fan', BF_A); control(g0, BF_A, P1);
  const a = put(g0, P0, 'V(3)', 'base');
  let g = move(g0, P0, [a], BF_A);
  assert.equal(g.showdown?.attacker, P0);
  assert.equal(g.showdown?.focus, P0, 'attacker has focus');
  assert.equal(pend(g).kind, 'optional'); assert.equal(pend(g).player, P1, 'Fan\'s controller finalizes its defend trigger without focus');
  g = yes(g);
  g = passAll(g);
  assert.equal(zone(g, fan), 'trash'); assert.equal(locOf(g, a), 'base');
});

test('RJ#10414 Frigid Jewel played after the turn\'s draw: the next draw is the second card drawn this turn and triggers it', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  g = nextTurn(nextTurn(g)); // P0's next turn, through its Draw phase (first card drawn this turn)
  assert.equal(g.activePlayer, P0);
  const u = put(g, P0, 'V(2)', 'base');
  const fj = hand(g, P0, 'Frigid Jewel');
  g = passAll(play(g, P0, fj));
  assert.equal(zone(g, fj), 'base');
  const dr = hand(g, P0, 'DrawR');
  const r = drive(play(g, P0, dr));
  assert.equal(mightOf(r.g, u), 4, 'Frigid Jewel gave +2');
});

test('RJ#10415 A unit of the other player arriving during a non-combat showdown makes it a combat; the attacker then has focus', () => {
  let g = S0(); fundAll(g, P1);
  const a = put(g, P0, 'V(2)', 'base');
  const b = put(g, P1, 'V(3)', 'base');
  const rtw = hand(g, P1, 'Ride the Wind');
  g = move(g, P0, [a], BF_A);
  assert.equal(g.showdown?.isCombat, false);
  g = pass(g);
  assert.equal(pend(g).player, P1);
  g = play(g, P1, rtw, { targets: [[b]] });
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? answer(g, { locations: [BF_A] }) : pass(g);
  assert.equal(locOf(g, b), BF_A);
  assert.equal(g.showdown?.isCombat, true, 'combat showdown');
  assert.equal(g.showdown?.attacker, P0);
  assert.equal(pend(g).kind, 'showdownAction'); assert.equal(pend(g).player, P0, 'attacker has focus');
});

test('RJ#10416 Elder Dragon: any amount is lethal, so 1 damage each kills two units', () => {
  let { g, def } = attackSetup(['Elder Dragon'], ['V(5)', 'V(5)']);
  for (let i = 0; i < 10 && pend(g).kind !== 'assignDamage'; i++) g = pass(g);
  assert.equal(validateAction(g, { type: 'assignDamage', player: P0, assignment: { [def[0]]: 1, [def[1]]: 9 } }), null);
  g = act(g, { type: 'assignDamage', player: P0, assignment: { [def[0]]: 1, [def[1]]: 9 } });
  g = drive(g, gg => gg.pending!.kind === 'assignDamage' ? undefined : undefined).g;
  assert.ok(def.every(d => zone(g, d) === 'trash'));
});

test('RJ#10417 Teemo, Strategist\'s defend trigger resolves before combat damage; a killed attacker deals no damage', () => {
  const g0 = S0();
  const t = put(g0, P1, 'Teemo, Strategist', BF_A); control(g0, BF_A, P1);
  clearDeckTop(g0, P1, 5, 'HidU(1)');
  const a = put(g0, P0, 'V(3)', 'base');
  let g = move(g0, P0, [a], BF_A);
  g = drive(g).g;
  assert.equal(zone(g, a), 'trash', 'Teemo dealt 5 to the attacker');
  assert.equal(zone(g, t), 'battlefield');
  assert.equal(g.objects[t].damage, 0, 'no combat damage dealt to Teemo');
});

test('RJ#10419 Moonfall: choosing an enemy unit with Deflect to move costs the Deflect tax', () => {
  const recycled = (tgt: string) => {
    const g0 = S0(); fundAll(g0, P0);
    put(g0, P0, 'V(2)', BF_A); control(g0, BF_A, P0);
    const e = put(g0, P1, tgt, BF_B); control(g0, BF_B, P1);
    const n0 = g0.players[P0].runesInPlay.length;
    const g = play(g0, P0, hand(g0, P0, 'Moonfall'), { targets: [[e]] });
    assert.equal(g.chain[0].targets.flat().includes(e), true);
    return n0 - g.players[P0].runesInPlay.length;
  };
  assert.equal(recycled('Deflect(3,1)') - recycled('V(3)'), 1, 'one more power paid for Deflect');
});

test('RJ#10420 Stellacorn Herder: the opponent can Gust it in response to its "when I move" trigger', () => {
  const g0 = S0(); fundAll(g0, P1);
  const h = put(g0, P0, 'Stellacorn Herder', 'base');
  const gust = hand(g0, P1, 'Gust');
  put(g0, P0, 'V(1)', BF_B); control(g0, BF_B, P0);
  let g = move(g0, P0, [h], BF_B);
  assert.ok(g.chain.some(c => /Stellacorn/.test(String(c.label))), 'move trigger on the chain');
  const hand0 = g.players[P0].hand.length;
  g = pass(g);
  assert.equal(pend(g).player, P1);
  g = play(g, P1, gust, { targets: [[h]] });
  g = resolveChain(g);
  assert.equal(zone(g, h), 'hand', 'Gust resolved first');
  assert.equal(g.players[P0].hand.length, hand0 + 2, 'Herder back in hand + the draw still resolved');
});

test('RJ#10422 Falling Star leaves a unit 1 short, then Stupefy (-1 Might): marked damage >= Might, it dies', () => {
  const g0 = S0(); fundAll(g0, P0);
  const u = put(g0, P1, 'V(4)', BF_A); control(g0, BF_A, P1);
  put(g0, P1, 'V(9)', BF_B);
  let g = play(g0, P0, hand(g0, P0, 'Falling Star'), { targets: [[u], [put(g0, P1, 'V(9)', BF_B)]] });
  g = resolveChain(g);
  assert.equal(g.objects[u].damage, 3); assert.equal(zone(g, u), 'battlefield');
  g = resolveChain(play(g, P0, hand(g, P0, 'Stupefy'), { targets: [[u]] }));
  assert.equal(zone(g, u), 'trash');
});

test('RJ#10424/10428 Acceptable Losses can be played when only the opponent controls gear; they kill one of theirs', () => {
  const g0 = S0(); fundAll(g0, P0);
  const gear = put(g0, P1, 'Baited Hook', 'base');
  const al = hand(g0, P0, 'Acceptable Losses');
  assert.ok(canPlayNow(g0, P0, al));
  const g = drive(play(g0, P0, al)).g;
  assert.equal(zone(g, gear), 'trash');
});

test('RJ#10425 Combat damage: lethal must be assigned in full before the next unit (3 damage cannot be split 1/1/1 among 2-Might units)', () => {
  let { g, def } = attackSetup(['V(3)'], ['V(2)', 'V(2)', 'V(2)']);
  for (let i = 0; i < 10 && pend(g).kind !== 'assignDamage'; i++) g = pass(g);
  assert.notEqual(validateAction(g, { type: 'assignDamage', player: P0, assignment: { [def[0]]: 1, [def[1]]: 1, [def[2]]: 1 } }), null);
  assert.equal(validateAction(g, { type: 'assignDamage', player: P0, assignment: { [def[0]]: 2, [def[1]]: 1 } }), null);
  let r = attackSetup(['V(3)'], ['V(1)', 'V(1)', 'V(1)']);
  g = r.g; for (let i = 0; i < 10 && pend(g).kind !== 'assignDamage'; i++) g = pass(g);
  assert.equal(validateAction(g, { type: 'assignDamage', player: P0, assignment: { [r.def[0]]: 1, [r.def[1]]: 1, [r.def[2]]: 1 } }), null, '1 each is fine when 1 is lethal');
});

test('RJ#10427 Hidden Zhonya\'s Hourglass not played when its battlefield\'s only (Deathknell) unit dies: it is trashed', () => {
  const g0 = S0({ tp: P1 }); fundAll(g0, P1);
  const u = put(g0, P0, 'DK(1)', BF_A); control(g0, BF_A, P0);
  const z = put(g0, P0, 'Zhonya\'s Hourglass', { facedown: BF_A });
  const g = drive(play(g0, P1, hand(g0, P1, 'Hidden Blade'), { targets: [[u]] })).g;
  assert.equal(zone(g, u), 'trash');
  assert.equal(zone(g, z), 'trash', 'facedown card trashed once control is lost');
  assert.equal(g.battlefields[BF_A].controller, null);
});

test('RJ#10429 Repulse counters Hidden Blade on the chosen friendly unit, but cannot stop Cull the Weak (no choice)', () => {
  const g0 = S0({ tp: P1 }); fundAll(g0, P0); fundAll(g0, P1);
  const u = put(g0, P0, 'V(2)', BF_A); control(g0, BF_A, P0);
  const rep0 = hand(g0, P0, 'Repulse');
  let g = play(g0, P1, hand(g0, P1, 'Hidden Blade'), { targets: [[u]] });
  g = pass(g);
  g = play(g, P0, rep0, { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(locOf(g, u), BF_A, 'Hidden Blade countered');
  const h0 = S0({ tp: P1 }); fundAll(h0, P0); fundAll(h0, P1);
  const v = put(h0, P0, 'V(2)', BF_A); control(h0, BF_A, P0); put(h0, P1, 'V(1)', 'base');
  const rep = hand(h0, P0, 'Repulse');
  let h = play(h0, P1, hand(h0, P1, 'Cull the Weak'));
  h = pass(h);
  if (canPlayNow(h, P0, rep)) h = play(h, P0, rep, { targets: [[v]] });
  h = drive(h).g;
  assert.equal(zone(h, v), 'trash', 'Cull the Weak still made P0 kill their unit');
});

test('RJ#10430 Diana, Lunari: one Predict, then reveal the top card and draw it if it is a spell', () => {
  let g = S0(); fundAll(g, P0);
  const di = put(g, P0, 'Diana, Lunari', 'base');
  const sp = put(g, P0, 'DrawR', 'deckTop');
  g = move(g, P0, [di], BF_A);
  let predicts = 0;
  g = drive(g, gg => { const d = gg.pending!; if (d.kind === 'chooseCards' && /Predict/.test(d.prompt)) { predicts++; return []; } return undefined; }).g;
  assert.equal(predicts, 1, 'Predict once');
  assert.equal(zone(g, sp), 'hand', 'the revealed spell is drawn');
});

test('RJ#10423 Death from Below whose target left the battlefield in response: no kill, so it cannot be replayed from the trash', () => {
  const g0 = S0(); fundAll(g0, P0); fundAll(g0, P1);
  const u = put(g0, P1, 'V(2)', BF_A); control(g0, BF_A, P1);
  const gust = hand(g0, P1, 'Gust');
  const dfb = hand(g0, P0, 'Death from Below');
  let g = play(g0, P0, dfb, { targets: [[u]] });
  g = pass(g);
  g = play(g, P1, gust, { targets: [[u]] });
  const { g: h, seen } = drive(g);
  assert.equal(zone(h, u), 'hand');
  assert.equal(zone(h, dfb), 'trash');
  assert.ok(!seen.some(s => /^optional/.test(s)), 'no "you may play this from your trash" offer');
  assert.ok(!canPlayNow(h, P0, dfb), 'not playable from the trash');
});

test('RJ#10426 Heedless Resurrection: the unit from the trash is played ignoring its cost; only the spell\'s own cost is paid', () => {
  const g0 = S0(); fundAll(g0, P0);
  put(g0, P0, 'V(3)', 'base'); const v = put(g0, P0, 'V(2)', 'trash');
  const n0 = g0.players[P0].runesInPlay.length;
  const g = drive(play(g0, P0, hand(g0, P0, 'Heedless Resurrection')), gg => gg.pending!.kind === 'chooseCards' ? [v] : undefined).g;
  assert.equal(zone(g, v), 'base');
  const used = (n0 - g.players[P0].runesInPlay.length) + g.players[P0].runesInPlay.filter(r => g.objects[r].exhausted).length;
  assert.ok(used <= 3, `only [2] + [C] for Heedless Resurrection (runes used: ${used})`);
});

test('RJ#10432 Convergent Mutation + Ravenbloom Student: Might is increased to the other unit\'s, then Ravenbloom\'s spell trigger adds +1; "increase" never lowers', () => {
  const run = (targetRb: boolean) => {
    const g0 = S0(); fundAll(g0, P0);
    const rb = put(g0, P0, 'Ravenbloom Student', 'base'); const tt = put(g0, P0, 'Tideturner', 'base'); mod(g0, rb, { might: 2 });
    const g = drive(play(g0, P0, hand(g0, P0, 'Convergent Mutation'), { targets: [[targetRb ? rb : tt]] }), gg => gg.pending!.kind === 'chooseTargets' ? [targetRb ? tt : rb] : undefined).g;
    return [mightOf(g, rb), mightOf(g, tt)];
  };
  assert.deepEqual(run(false), [5, 4], 'Tideturner raised to 4; Ravenbloom 4 + 1');
  // RJ said Ravenbloom would drop to 2 (then 3). Official text says "increase its Might to", which can't lower it.
  assert.deepEqual(run(true), [5, 2], 'Ravenbloom stays 4 (+1 = 5)');
});

test('RJ#10433 Heedless Resurrection: the unit killed for its additional cost cannot be the unit it plays (chosen before costs are paid)', () => {
  const g0 = S0(); fundAll(g0, P0);
  const ed = put(g0, P0, 'Elder Dragon', 'base'); put(g0, P0, 'V(2)', 'trash');
  let offered: string[] = [];
  drive(play(g0, P0, hand(g0, P0, 'Heedless Resurrection')), gg => { if (gg.pending!.kind === 'chooseCards') offered = gg.pending!.options!.map(o => o.id); return undefined; });
  assert.ok(!offered.includes(ed), 'Elder Dragon was on the board when the unit was chosen');
});

test('RJ#10431 Fresh Beans: a unit played by a conquer trigger is not played during a showdown; Rek\'Sai, Swarm Queen\'s trigger is an ATTACK trigger, so its unit is', () => {
  // Void Burrower (legend, "When you conquer ... play it"): the showdown is over, no Fresh Beans.
  const g = S0(); fundAll(g, P0); setLegend(g, P0, 'Void Burrower');
  const u = put(g, P0, 'V(2)', 'base');
  put(g, P0, 'Fresh Beans', 'base');
  const top = put(g, P0, 'V(1)', 'deckTop');
  let r = drive(move(g, P0, [u], BF_A), gg => gg.pending!.kind === 'chooseCards' ? [top] : undefined);
  assert.ok(['base', 'battlefield'].includes(zone(r.g, top)), 'Void Burrower played the card');
  assert.ok(!r.seen.some(s => /Fresh Beans/i.test(s)), 'no Fresh Beans offer');
  // Rek'Sai, Swarm Queen: "When I attack" (official text) — the unit is played during the combat showdown.
  const g2 = S0(); fundAll(g2, P0);
  const rs = put(g2, P0, 'Rek\'Sai, Swarm Queen', 'base'); put(g2, P1, 'V(9)', BF_A); control(g2, BF_A, P1);
  put(g2, P0, 'Fresh Beans', 'base'); const t2 = put(g2, P0, 'V(1)', 'deckTop');
  r = drive(move(g2, P0, [rs], BF_A), gg => gg.pending!.kind === 'chooseCards' ? [t2] : undefined);
  assert.ok(['base', 'battlefield', 'trash'].includes(zone(r.g, t2)), 'Rek\'Sai played the card');
  assert.ok(r.seen.some(s => /Fresh Beans/i.test(s)), `Fresh Beans offered (${r.seen.join(' | ')})`);
});

test('RJ#10434 Scuttle Crab dies with hidden Zhonya\'s Hourglass there: while its Deathknell is on the chain the hidden card can still be played', () => {
  const g0 = S0({ tp: P1 }); fundAll(g0, P0);
  const sc = put(g0, P0, 'Scuttle Crab', BF_A); control(g0, BF_A, P0);
  const z = put(g0, P0, 'Zhonya\'s Hourglass', { facedown: BF_A });
  put(g0, P1, 'V(1)', 'hand');
  const a = put(g0, P1, 'V(3)', 'base');
  let g = move(g0, P1, [a], BF_A);
  let playable = false;
  for (let i = 0; i < 30; i++) {
    const d = g.pending!; if (d.kind === 'mainAction') break;
    if (zone(g, sc) === 'trash' && g.chain.some(c => /Scuttle/.test(String(c.label))) && d.player === P0 && !d.inStep) { playable = canPlayNow(g, P0, z); break; }
    g = d.kind === 'assignDamage' ? act(g, { type: 'assignDamage', player: d.player, assignment: d.player === P1 ? { [sc]: 3 } : { [a]: 0 } }) : d.inStep ? choose(g, d.kind === 'optional' ? 'no' : d.options![0].id) : pass(g);
  }
  assert.equal(zone(g, sc), 'trash');
  assert.ok(playable, 'Zhonya\'s Hourglass can be played in response to the Deathknell');
});

test('RJ#10435 Star-Crossed can be played in response to Thrill of the Hunt and resolves first', () => {
  const g0 = S0(); fundAll(g0, P0); fundAll(g0, P1);
  const f = put(g0, P0, 'V(2)', 'base');
  const e = put(g0, P1, 'V(2)', 'base');
  const sc = hand(g0, P1, 'Star-Crossed');
  let g = play(g0, P0, hand(g0, P0, 'Thrill of the Hunt'), { targets: [[f]] });
  g = pass(g);
  assert.ok(canPlayNow(g, P1, sc));
  g = play(g, P1, sc, { targets: [[e], [f]] });
  assert.match(String(g.chain.at(-1)!.label), /Star-Crossed/);
  g = drive(g).g;
  assert.equal(zone(g, f), 'hand', 'Star-Crossed resolved first, Thrill lost its target');
  assert.equal(zone(g, e), 'hand');
});

test('RJ#10436 Lucian + two Trinity Force + Skyfall of Areion conquering at 7 points wins (the hold triggers also act on conquer)', () => {
  const g0 = S0();
  const lu = put(g0, P0, 'Lucian, Merciless', 'base');
  for (const n of ['Trinity Force', 'Trinity Force', 'Skyfall of Areion']) attachNow(g0, put(g0, P0, n, 'base'), lu);
  put(g0, P1, 'V(1)', BF_A); control(g0, BF_A, P1);
  put(g0, P1, 'V(1)', BF_B); control(g0, BF_B, P1);
  g0.players[P0].points = 7;
  const g = drive(move(g0, P0, [lu], BF_A)).g;
  assert.equal(g.winner, P0);
  // control: without the equipment the conquer can't give the final point (BF-B not scored this turn)
  const h0 = S0(); const l2 = put(h0, P0, 'Lucian, Merciless', 'base');
  put(h0, P1, 'V(1)', BF_A); control(h0, BF_A, P1); put(h0, P1, 'V(1)', BF_B); control(h0, BF_B, P1);
  h0.players[P0].points = 7;
  const h = drive(move(h0, P0, [l2], BF_A)).g;
  assert.equal(h.winner ?? null, null);
});

test('RJ#10437 Vi, Peacekeeper played with Ambush into a combat becomes an attacker and her attack trigger stuns', () => {
  const g0 = S0(); fundAll(g0, P0);
  const e = put(g0, P1, 'V(3)', BF_A); control(g0, BF_A, P1);
  const a = put(g0, P0, 'V(1)', 'base');
  const vi = hand(g0, P0, 'Vi, Peacekeeper');
  let g = move(g0, P0, [a], BF_A);
  assert.ok(canPlayNow(g, P0, vi, BF_A));
  g = play(g, P0, vi, { dest: BF_A });
  let stunned = false;
  for (let i = 0; i < 20 && !stunned; i++) {
    const d = g.pending!; if (d.kind === 'mainAction' || d.kind === 'assignDamage') break;
    g = d.inStep ? choose(g, d.options!.some(o => o.id === e) ? e : d.options![0].id) : pass(g);
    stunned = !!g.objects[e]?.stunned;
  }
  assert.equal(g.objects[vi].combatRole, 'attacker');
  assert.ok(stunned, 'Vi stunned the enemy');
});

test('RJ#10438 Karthus, Eternal dying simultaneously with Watchful Sentry: the Sentry\'s Deathknell still triggers twice', () => {
  const g0 = S0(); fundAll(g0, P1);
  const k = put(g0, P0, 'Karthus, Eternal', BF_A); const w = put(g0, P0, 'Watchful Sentry', BF_A); control(g0, BF_A, P0);
  const h0 = g0.players[P0].hand.length;
  const g = drive(play(S0tp(g0, P1), P1, hand(g0, P1, 'Falling Star'), { targets: [[k], [w]] })).g;
  assert.equal(zone(g, k), 'trash'); assert.equal(zone(g, w), 'trash');
  assert.equal(g.players[P0].hand.length, h0 + 2, 'drew 2');
});

test('RJ#10439 Hidden card vs Unchecked Power: it must be played before the spell resolves; afterwards it is trashed with the battlefield lost', () => {
  const g0 = S0({ tp: P1 }); fundAll(g0, P1, 7);
  put(g0, P0, 'V(2)', BF_A); control(g0, BF_A, P0);
  const hid = put(g0, P0, 'HidU(2)', { facedown: BF_A });
  let g = play(g0, P1, hand(g0, P1, 'Unchecked Power'));
  g = pass(g);
  assert.equal(pend(g).player, P0);
  assert.ok(canPlayNow(g, P0, hid), 'playable while Unchecked Power is on the chain');
  g = drive(g).g;
  assert.equal(zone(g, hid), 'trash');
  assert.equal(g.battlefields[BF_A].controller, null);
});

test('RJ#10440 Relentless Pursuit on the opponent\'s turn: the granted "When I conquer, you may move me to my base" still triggers', () => {
  const g0 = S0({ tp: P1 }); fundAll(g0, P0);
  const a = put(g0, P1, 'V(1)', 'base');
  const d = put(g0, P0, 'V(5)', 'base');
  const rp = hand(g0, P0, 'Relentless Pursuit');
  let g = move(g0, P1, [a], BF_A);
  g = pass(g);
  assert.equal(pend(g).player, P0);
  g = play(g, P0, rp, { targets: [[d]] });
  let sawMove = false;
  for (let i = 0; i < 30; i++) {
    const p = g.pending!; if (p.kind === 'mainAction') break;
    if (p.kind === 'chooseDestination') { g = choose(g, String(BF_A)); continue; }
    if (p.kind === 'optional' && /base/i.test(p.prompt)) { sawMove = true; g = yes(g); continue; }
    if (p.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: p.player, assignment: p.player === P0 ? { [a]: 5 } : { [d]: 1 } }); continue; }
    g = p.inStep ? choose(g, p.kind === 'optional' ? 'yes' : p.options![0].id) : pass(g);
  }
  assert.ok(/P0 conquers BF-A/.test(logText(g)), 'P0 conquered');
  assert.ok(sawMove, 'conquer trigger offered');
  assert.equal(locOf(g, d), 'base');
});

test('RJ#10441 Sunken Temple: pay [1] energy (no rune is recycled) to draw when conquering with a Mighty unit', () => {
  const g0 = S0(); setBattlefieldCard(g0, BF_A, 'Sunken Temple');
  const u = put(g0, P0, 'V(5)', 'base');
  const n0 = g0.players[P0].runesInPlay.length, h0 = g0.players[P0].hand.length;
  const g = drive(move(g0, P0, [u], BF_A)).g;
  assert.equal(g.players[P0].hand.length, h0 + 1);
  assert.equal(g.players[P0].runesInPlay.length, n0, 'nothing recycled');
  assert.equal(readyRunes(g, P0), n0 - 1, 'one rune exhausted for [1]');
});

test('RJ#10442 Vex, Cheerless in combat: an enemy spell targeting a Deflect unit pays Deflect AND Vex\'s +[1][A]', () => {
  const recycled = (tgt: string, vex: boolean) => {
    const g0 = S0({ tp: P1 }); fundAll(g0, P1);
    const t = put(g0, P0, tgt, BF_A); control(g0, BF_A, P0);
    if (vex) put(g0, P0, 'Vex, Cheerless', BF_A); else put(g0, P0, 'V(5)', BF_A);
    const ray = hand(g0, P1, 'Hextech Ray');
    let g = move(g0, P1, [put(g0, P1, 'V(1)', 'base')], BF_A);
    assert.ok(g.showdown?.isCombat);
    if (pend(g).player !== P1) g = pass(g);
    const n0 = g.players[P1].runesInPlay.length;
    g = play(g, P1, ray, { targets: [[t]] });
    assert.ok(g.chain.some(c => /Hextech/.test(String(c.label))));
    return n0 - g.players[P1].runesInPlay.length;
  };
  assert.equal(recycled('Deflect(2,1)', true), 3, 'power: 1 base + 1 Deflect + 1 Vex');
  assert.equal(recycled('V(2)', true), 2);
  assert.equal(recycled('Deflect(2,1)', false), 2);
});

test('RJ#10443 Jhin, Meticulous Killer: spending 4+ on a spell does not give timing permission on the opponent\'s turn', () => {
  const g0 = S0({ tp: P1 }); fundAll(g0, P0, 5); fundAll(g0, P1);
  const jhin = hand(g0, P0, 'Jhin, Meticulous Killer');
  const ff = hand(g0, P0, 'Flurry of Feathers');
  let g = play(g0, P1, hand(g0, P1, 'DrawR'));
  g = pass(g);
  g = play(g, P0, ff, { mode: [] });
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, pend(g).options!.at(-1)!.id);
  assert.ok(g.chain.some(c => /Flurry/.test(String(c.label))), 'spent 4 on a spell');
  if (pend(g).player !== P0) g = pass(g);
  assert.ok(!canPlayNow(g, P0, jhin), 'cannot play Jhin now');
  g = drive(g).g;
  assert.equal(zone(g, jhin), 'hand');
});

test('RJ#10445 Whirlwind does not choose: on resolution the caster may return an enemy Baron Nashor', () => {
  const g0 = S0(); fundAll(g0, P0);
  const b = put(g0, P1, 'Baron Nashor', 'base');
  let g = play(g0, P0, hand(g0, P0, 'Whirlwind'));
  let offered = false;
  g = drive(g, gg => {
    const d = gg.pending!;
    if (d.player === P1) return d.kind === 'optional' ? ['no'] : d.options!.some(o => o.id === 'none') ? ['none'] : [];
    if (d.options!.some(o => o.id === b)) { offered = true; return [b]; }
    return undefined;
  }).g;
  assert.ok(offered, 'Baron Nashor can be picked');
  assert.equal(zone(g, b), 'hand');
});

test('RJ#10446 There is no maximum hand size', () => {
  let g = S0();
  for (let i = 0; i < 15; i++) hand(g, P0, 'V(1)');
  g = endTurn(g, P0);
  g = drive(g).g;
  assert.equal(g.players[P0].hand.length, 15, 'no discard at end of turn');
});

test('RJ#10447 A stunned Elder Dragon still applies "any amount of your damage is enough to kill"', () => {
  let { g, def } = attackSetup(['Elder Dragon', 'V(2)'], ['V(5)', 'V(5)'], { atkOpts: [{ stunned: true }, {}] });
  for (let i = 0; i < 10 && pend(g).kind !== 'assignDamage'; i++) g = pass(g);
  assert.equal(pend(g).player, P0);
  g = act(g, { type: 'assignDamage', player: P0, assignment: { [def[0]]: 1, [def[1]]: 1 } });
  g = drive(g).g;
  assert.ok(def.every(d => zone(g, d) === 'trash'), 'stunned Dragon contributes 0 Might but its passive applies');
});

test('RJ#10448 Gust can return a Reflection token (it then ceases to exist)', () => {
  const g0 = S0(); fundAll(g0, P1); tokens(g0, 'Reflection');
  const r = put(g0, P0, 'Reflection', BF_A, { token: true }); control(g0, BF_A, P0);
  put(g0, P0, 'V(1)', BF_A);
  const g = drive(play(S0tp(g0, P1), P1, hand(g0, P1, 'Gust'), { targets: [[r]] })).g;
  assert.ok(!g.players[P0].hand.includes(r) && zone(g, r) !== 'battlefield', 'token left the board and is gone');
});

test('RJ#10449 Cull the Weak can be played by a player with no units; the others still kill one', () => {
  const g0 = S0(); fundAll(g0, P0);
  const e = put(g0, P1, 'V(2)', 'base');
  const cull = hand(g0, P0, 'Cull the Weak');
  assert.ok(canPlayNow(g0, P0, cull));
  const g = drive(play(g0, P0, cull)).g;
  assert.equal(zone(g, e), 'trash');
});

test('RJ#10450 Conscription on the opponent\'s only unit at their battlefield: unit recalled to my base, no point, no battlefield control', () => {
  const g0 = S0(); fundAll(g0, P0);
  const e = put(g0, P1, 'V(3)', BF_A); control(g0, BF_A, P1);
  const g = drive(play(g0, P0, hand(g0, P0, 'Conscription'), { targets: [[e]], may: [false] })).g;
  assert.equal(g.objects[e].controller, P0);
  assert.equal(locOf(g, e), 'base');
  assert.equal(g.players[P0].points, 0);
  assert.notEqual(g.battlefields[BF_A].controller, P0);
});

test('RJ#10451 The Grand Plaza: no window to add units before the hold is scored; 6 units at the start of turn do not win', () => {
  const run = (n: number) => {
    let g = S0({ tp: P1 }); fundAll(g, P0); setBattlefieldCard(g, BF_A, 'The Grand Plaza');
    for (let i = 0; i < n; i++) put(g, P0, 'V(1)', BF_A);
    control(g, BF_A, P0);
    hand(g, P0, 'Flurry of Feathers');
    g = endTurn(g, P1);
    const seen: string[] = [];
    for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction' && g.winner == null; i++) { seen.push(g.pending.kind); g = g.pending.inStep ? choose(g, g.pending.options![0].id) : pass(g); }
    return { g, seen };
  };
  const six = run(6);
  assert.equal(six.g.winner ?? null, null);
  assert.equal(run(7).g.winner, P0, 'control: 7 units win');
});

test('RJ#10451b The Grand Plaza with 6 units: the "if you have 7+ units here" trigger condition is false, so nothing goes on the chain (no priority window)', () => {
  let g = S0({ tp: P1 }); setBattlefieldCard(g, BF_A, 'The Grand Plaza');
  for (let i = 0; i < 6; i++) put(g, P0, 'V(1)', BF_A);
  control(g, BF_A, P0);
  g = endTurn(g, P1);
  assert.equal(g.chain.length, 0);
  assert.equal(pend(g).kind, 'mainAction');
});

test('RJ#10452 My only unit (Hwei) moved away by Blitzcrank: while items are on the chain I still control the battlefield and can play my hidden Tideturner there', () => {
  const g0 = S0({ tp: P1 }); fundAll(g0, P1); fundAll(g0, P0);
  const hw = put(g0, P0, 'Hwei, Brooding Painter', BF_A); control(g0, BF_A, P0);
  const tt = put(g0, P0, 'Tideturner', { facedown: BF_A });
  put(g0, P1, 'V(1)', BF_B); control(g0, BF_B, P1);
  let g = play(g0, P1, hand(g0, P1, 'Blitzcrank, Impassive'), { dest: BF_B });
  g = answer(g, { may: [true], targets: [[hw]] }, P1);
  for (let i = 0; i < 8 && locOf(g, hw) !== BF_B; i++) g = pend(g).inStep ? answer(g, { may: [true], targets: [[hw]] }) : pass(g);
  assert.equal(locOf(g, hw), BF_B, 'Hwei was moved');
  assert.ok(g.chain.length > 0, 'Hwei\'s move trigger is on the chain');
  if (pend(g).player !== P0) g = pass(g);
  assert.equal(g.battlefields[BF_A].controller, P0, 'control not lost while the chain is non-empty');
  assert.ok(canPlayNow(g, P0, tt), 'hidden Tideturner playable');
});

test('RJ#10453 Kha\'Zix readied by Ride the Wind into a lost attack is recalled keeping its ready state', () => {
  const g0 = S0(); fundAll(g0, P0);
  put(g0, P1, 'V(9)', BF_A, { stunned: true }); control(g0, BF_A, P1);
  const a = put(g0, P0, 'V(1)', 'base');
  const kz = put(g0, P0, 'Kha\'Zix, Mutating Horror', 'base', { ready: false });
  let g = move(g0, P0, [a], BF_A);
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[kz]] });
  g = drive(g, gg => gg.pending!.kind === 'chooseDestination' ? [String(BF_A)] : undefined).g;
  assert.equal(locOf(g, kz), 'base', 'recalled');
  assert.equal(g.objects[kz].exhausted, false, 'still ready');
  assert.equal(g.objects[a].exhausted, true, 'the standard-moved unit stays exhausted');
});

test('RJ#10454 Nidalee, Cat Form kills Scuttle Crab: Scuttle\'s Deathknell resolves before Nidalee\'s "win a combat" draw', () => {
  const g0 = S0();
  put(g0, P1, 'Scuttle Crab', BF_A); control(g0, BF_A, P1);
  const n = put(g0, P0, 'Nidalee, Cat Form', 'base');
  const g = drive(move(g0, P0, [n], BF_A)).g;
  const L = logText(g);
  const iScuttle = L.indexOf('Resolving Scuttle Crab'), iNid = L.indexOf('Trigger: Nidalee');
  assert.ok(iScuttle >= 0 && iNid >= 0, L.slice(-600));
  assert.ok(iScuttle < iNid, 'Deathknell fully resolved before Nidalee triggered');
});

test('RJ#10455 Mirror Image: the Reflection copies the printed unit only — not its buff or other modifications', () => {
  const g0 = S0(); fundAll(g0, P0); tokens(g0, 'Reflection');
  const u = put(g0, P0, 'V(3)', 'base', { buff: true }); mod(g0, u, { might: 2 });
  assert.equal(mightOf(g0, u), 6);
  const before = new Set(Object.keys(g0.objects));
  const g = drive(play(g0, P0, hand(g0, P0, 'Mirror Image'), { targets: [[u]] })).g;
  const r = g.players[P0].base.find(id => !before.has(id) && g.objects[id].isToken)!;
  assert.ok(r, 'Reflection created');
  assert.equal(mightOf(g, r), 3, 'base copy: printed Might only');
  assert.ok(!(g.objects[r].counters.buff > 0), 'no buff copied');
});

test('RJ#10457 Defy checks the printed cost: it cannot counter a Sky Splitter whose cost was reduced to 0', () => {
  const g0 = S0(); fundAll(g0, P0); fundAll(g0, P1);
  put(g0, P0, 'V(8)', 'base');
  const e = put(g0, P1, 'V(3)', BF_A); control(g0, BF_A, P1);
  const defy = hand(g0, P1, 'Defy');
  let g = play(g0, P0, hand(g0, P0, 'Sky Splitter'), { targets: [[e]] });
  g = pass(g);
  assert.equal(pend(g).player, P1);
  assert.ok(!canPlayNow(g, P1, defy), 'no legal target for Defy');
});

test('RJ#10458 Call to Glory: spending the buff of a damaged unit makes its damage lethal; it dies and the spell has no target', () => {
  const g0 = S0(); fundAll(g0, P0);
  const u = put(g0, P0, 'V(2)', BF_A, { buff: true, damage: 2 }); control(g0, BF_A, P0);
  assert.equal(mightOf(g0, u), 3);
  const g = drive(play(g0, P0, hand(g0, P0, 'Call to Glory'), { may: [true], targets: [[u]] }), gg => gg.pending!.kind === 'optional' ? ['yes'] : gg.pending!.options!.some(o => o.id === u) ? [u] : undefined).g;
  assert.equal(zone(g, u), 'trash');
});

test('RJ#10459 Rengar, Trophy Hunter ambushing into a battlefield the enemy moved into becomes the Defender', () => {
  const g0 = S0(); fundAll(g0, P1);
  const a = put(g0, P0, 'V(2)', 'base');
  const r = hand(g0, P1, 'Rengar, Trophy Hunter');
  let g = move(g0, P0, [a], BF_A);
  g = pass(g);
  assert.ok(canPlayNow(g, P1, r, BF_A));
  g = play(g, P1, r, { dest: BF_A });
  g = resolveChain(g);
  assert.equal(g.showdown?.isCombat, true);
  assert.equal(g.showdown?.attacker, P0); assert.equal(g.showdown?.defender, P1);
  assert.equal(g.objects[r].combatRole, 'defender');
});

test('RJ#10461 Hostile Takeover can take back your own unit that an opponent\'s Hostile Takeover took (it is an enemy unit to you now)', () => {
  const g0 = S0({ tp: P1 }); fundAll(g0, P0); fundAll(g0, P1);
  const u = put(g0, P0, 'V(3)', BF_B); control(g0, BF_B, P0);
  put(g0, P0, 'V(1)', BF_B);
  const ht0 = put(g0, P0, 'Hostile Takeover', { facedown: BF_B });
  let g = play(g0, P1, hand(g0, P1, 'Hostile Takeover'), { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(g.objects[u].controller, P1);
  // P0 plays its hidden Hostile Takeover in response to something P1 does (a cheap Reaction)
  g = play(g, P1, hand(g, P1, 'DrawR'));
  g = pass(g);
  assert.ok(canPlayNow(g, P0, ht0), 'hidden Hostile Takeover playable');
  g = play(g, P0, ht0, { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(g.objects[u].controller, P0, 'P0 took it back');
  assert.equal(g.objects[u].exhausted, false, 'readied');
});

test('RJ#10462 Stacked Deck puts a card into your hand: that is not a draw', () => {
  const g0 = S0(); fundAll(g0, P0);
  const log = new EventLog();
  let g = log.act(g0, { type: 'playCard', player: P0, obj: hand(g0, P0, 'Stacked Deck') });
  for (let i = 0; i < 10 && g.pending!.kind !== 'mainAction'; i++) g = g.pending!.inStep ? log.choose(g, g.pending!.options![0].id) : log.pass(g);
  assert.equal(g.players[P0].hand.length, 1);
  assert.equal(log.of('draw').length, 0, 'no draw event');
});

test('RJ#10463 Rek\'Sai, Swarm Queen moving to an empty battlefield (non-combat showdown) does not attack, so her trigger does not fire', () => {
  const g0 = S0(); fundAll(g0, P0);
  const r = put(g0, P0, 'Rek\'Sai, Swarm Queen', 'base');
  const { g, seen } = drive(move(g0, P0, [r], BF_A));
  assert.ok(!seen.some(s => /Rek'Sai|reveal the top 2/i.test(s)));
  assert.ok(!/Trigger: Rek'Sai/.test(logText(g)));
});

test('RJ#10465 Kha\'Zix: the "enemy unit alone here" condition was met when the trigger went on the chain; a unit added in response doesn\'t stop the +2 / 2 XP', () => {
  const g0 = S0(); fundAll(g0, P1);
  put(g0, P1, 'V(2)', BF_A); control(g0, BF_A, P1);
  const amb = hand(g0, P1, 'Ambusher(1)');
  const kz = put(g0, P0, 'Kha\'Zix, Mutating Horror', 'base');
  let g = move(g0, P0, [kz], BF_A);
  for (let i = 0; i < 4 && !g.chain.some(c => /Kha/.test(String(c.label))); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.ok(g.chain.some(c => /Kha/.test(String(c.label))), 'Kha\'Zix trigger on the chain');
  if (pend(g).player !== P1) g = pass(g);
  g = play(g, P1, amb, { dest: BF_A });
  for (let i = 0; i < 8 && g.chain.length; i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(locOf(g, amb), BF_A, 'second enemy unit arrived');
  assert.equal(mightOf(g, kz), 6, '+2 Might');
  assert.equal(g.players[P0].xp, 2, 'gained 2 XP');
});

test('RJ#10467 Flurry of Feathers (Reaction) cannot be played in the Beginning Phase with an empty chain — no window is offered', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  hand(g, P0, 'Flurry of Feathers');
  g = endTurn(g, P1);
  assert.equal(pend(g).kind, 'mainAction'); assert.equal(pend(g).player, P0, 'straight to the Main phase');
});

test('RJ#10468 Hold (6) + conquer (7) then Baron Nashor conquers the Baron Pit: all battlefields scored this turn, the final point wins', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 4); addRunes(g, P0, 4, 'chaos');
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const m = put(g, P0, 'V(2)', 'base');
  g.players[P0].points = 5;
  tokens(g, 'Baron Pit');
  const baron = hand(g, P0, 'Baron Nashor');
  g = endTurn(g, P1);
  assert.equal(g.players[P0].points, 6, 'hold');
  g = drive(move(g, P0, [m], BF_B)).g;
  assert.equal(g.players[P0].points, 7, 'conquer');
  g = drive(play(g, P0, baron)).g;
  assert.equal(g.winner, P0);
});

test('RJ#10469 Battle Mistress readied by an enemy death needs another rune recycle before it can be exhausted again', () => {
  const g0 = S0(); fundAll(g0, P0); tokens(g0, 'Gold');
  const l = setLegend(g0, P0, 'Battle Mistress');
  const golds = (g: GameState) => g.players[P0].base.filter(id => g.cards[g.objects[id].cardId]?.name === 'Gold').length;
  const e = put(g0, P1, 'V(2)', BF_A); control(g0, BF_A, P1);
  let g = drive(play(g0, P0, hand(g0, P0, 'Hextech Ray'), { targets: [[e]] }), gg => gg.pending!.kind === 'optional' ? ['yes'] : undefined).g;
  assert.equal(zone(g, e), 'trash');
  assert.equal(golds(g), 1, 'recycle for power -> Gold');
  assert.equal(g.objects[l].exhausted, false, 'readied by the enemy death');
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === l), 'no way to exhaust it without a new recycle');
});

test('RJ#10470 Not So Fast counters Charm moving my unit (an enemy spell choosing a friendly unit)', () => {
  const g0 = S0(); fundAll(g0, P0); fundAll(g0, P1);
  const u = put(g0, P1, 'V(2)', BF_A); control(g0, BF_A, P1);
  const nsf = hand(g0, P1, 'Not So Fast');
  let g = play(g0, P0, hand(g0, P0, 'Charm'), { targets: [[u]] });
  g = pass(g);
  assert.ok(canPlayNow(g, P1, nsf));
  g = play(g, P1, nsf, { targets: [[g.chain[0].source]] });
  g = drive(g, gg => gg.pending!.kind === 'chooseDestination' ? ['base'] : undefined).g;
  assert.equal(locOf(g, u), BF_A, 'Charm countered');
});

test('RJ#10471 Unyielding Spirit prevents Elder Dragon\'s ability damage, so its "any amount is lethal" kills nothing', () => {
  const g0 = S0(); fundAll(g0, P0, 3); addRunes(g0, P0, 4, 'body'); fundAll(g0, P1);
  const e = put(g0, P1, 'V(3)', BF_A); control(g0, BF_A, P1);
  const us = hand(g0, P1, 'Unyielding Spirit');
  let g = play(g0, P0, hand(g0, P0, 'Elder Dragon'));
  for (let i = 0; i < 6 && !g.chain.some(c => /Elder/.test(String(c.label))); i++) g = pend(g).inStep ? answer(g, { targets: [[e]] }) : pass(g);
  g = answer(g, { targets: [[e]] });
  if (pend(g).player !== P1) g = pass(g);
  g = play(g, P1, us);
  g = drive(g, gg => gg.pending!.kind === 'chooseTargets' && gg.pending!.options!.some(o => o.id === e) ? [e] : undefined).g;
  assert.equal(zone(g, e), 'battlefield', 'no damage marked, no kill');
  assert.equal(g.objects[e].damage, 0);
});

test('RJ#10472 Defy can counter a Hard Bargain whose Repeat was paid (printed cost 2; one chain item)', () => {
  const g0 = S0(); fundAll(g0, P0); fundAll(g0, P1);
  put(g0, P1, 'V(3)', BF_A); control(g0, BF_A, P1);
  const ray = hand(g0, P0, 'Hextech Ray'); const defy = hand(g0, P0, 'Defy');
  let g = pass(act(g0, { type: 'playCard', player: P0, obj: ray }));
  const hb = hand(g, P1, 'Hard Bargain');
  g = act(g, { type: 'playCard', player: P1, obj: hb });
  g = yes(g);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, pend(g).options![0].id);
  assert.equal(g.chain.length, 2);
  if (pend(g).player !== P0) g = pass(g);
  assert.ok(canPlayNow(g, P0, defy));
  g = play(g, P0, defy, { targets: [[String(g.chain.find(c => c.source === hb)!.id)]] });
  g = resolveChain(g);
  assert.equal(zone(g, hb), 'trash');
  assert.ok(g.chain.length === 0 || !g.chain.some(c => c.source === hb));
});

test('RJ#10473 En Garde played in a showdown keeps it going: after it resolves focus passes on, and the showdown ends only after consecutive passes', () => {
  const g0 = S0(); fundAll(g0, P1);
  const a = put(g0, P0, 'V(2)', 'base');
  const b = put(g0, P1, 'V(2)', BF_A); control(g0, BF_A, P1);
  const eg = hand(g0, P1, 'En Garde');
  let g = move(g0, P0, [a], BF_A);
  g = pass(g);
  assert.equal(pend(g).player, P1);
  g = play(g, P1, eg, { targets: [[b]] });
  g = resolveChain(g);
  assert.ok(g.showdown, 'showdown continues');
  assert.equal(pend(g).kind, 'showdownAction'); assert.equal(pend(g).player, P0, 'focus passed to the next player');
});

test('RJ#10474 Hidden Sprite Call played in response to the old Sprite\'s Temporary trigger: only the old Sprite dies', () => {
  const g0 = S0({ tp: P1 }); fundAll(g0, P0); tokens(g0, 'Sprite');
  const old = put(g0, P0, 'Sprite', BF_A, { token: true }); control(g0, BF_A, P0);
  const sc = put(g0, P0, 'Sprite Call', { facedown: BF_A });
  let g = endTurn(g0, P1);
  assert.ok(g.chain.length > 0, 'Temporary trigger on the chain');
  g = play(g, P0, sc);
  g = drive(g).g;
  assert.notEqual(zone(g, old), 'battlefield');
  assert.equal(g.players[P0].base.concat(Object.keys(g.objects).filter(id => g.objects[id].zone === 'battlefield')).filter(id => g.cards[g.objects[id].cardId]?.name === 'Sprite').length, 1, 'the new Sprite survives');
});

test('RJ#10475 Ava Achiever\'s attack trigger: pay [C] to play Hidden Hostile Takeover from hand ignoring its cost', () => {
  const g0 = S0(); fundAll(g0, P0);
  const e = put(g0, P1, 'V(2)', BF_A); control(g0, BF_A, P1);
  const ava = put(g0, P0, 'Ava Achiever', 'base');
  const ht = hand(g0, P0, 'Hostile Takeover');
  const g = drive(move(g0, P0, [ava], BF_A), gg => {
    const d = gg.pending!;
    if (d.kind === 'chooseCards' && d.options!.some(o => o.id === ht)) return [ht];
    if (d.kind === 'chooseTargets' && d.options!.some(o => o.id === e)) return [e];
    return undefined;
  }).g;
  assert.notEqual(zone(g, ht), 'hand', 'Hostile Takeover was played');
  assert.ok(g.objects[e].controller === P0 || zone(g, e) === 'trash', 'it took the enemy unit');
});

test('RJ#10478 Hidden Blade: a unit moved to another battlefield in response still dies if it was played from hand; from Hidden it mistargets', () => {
  const run = (hidden: boolean) => {
    const g0 = S0({ tp: P1 }); fundAll(g0, P1);
    const u = put(g0, P0, 'V(2)', BF_A); put(g0, P0, 'V(1)', BF_B); control(g0, BF_B, P0);
    if (hidden) { put(g0, P1, 'V(1)', BF_A); control(g0, BF_A, P1); } else control(g0, BF_A, P0);
    const hb = hidden ? put(g0, P1, 'Hidden Blade', { facedown: BF_A }) : hand(g0, P1, 'Hidden Blade');
    let g = play(g0, P1, hb, { targets: [[u]] });
    g.objects[u].battlefieldIndex = BF_B; g.timestamp++; // P0 moves the unit to BF-B in response (setup)
    g = drive(g).g;
    return zone(g, u);
  };
  assert.equal(run(false), 'trash', 'from hand: still "a unit at a battlefield"');
});

test('RJ#10478b Hidden Blade played from Hidden mistargets a unit that moved to another battlefield in response', () => {
  const g0 = S0({ tp: P1 }); fundAll(g0, P1);
  const u = put(g0, P0, 'V(2)', BF_A); put(g0, P0, 'V(1)', BF_B); control(g0, BF_B, P0);
  put(g0, P1, 'V(1)', BF_A); control(g0, BF_A, P1);
  const hb = put(g0, P1, 'Hidden Blade', { facedown: BF_A });
  let g = play(g0, P1, hb, { targets: [[u]] });
  g.objects[u].battlefieldIndex = BF_B; g.timestamp++;
  g = drive(g).g;
  assert.equal(zone(g, u), 'battlefield');
});

test('RJ#10479 Ruined Rex dying with Ferrous Forerunner: Rex\'s Deathknell target is chosen when it goes on the chain, before the Mechs exist', () => {
  const g0 = S0();
  const rex = put(g0, P1, 'Ruined Rex', BF_A); control(g0, BF_A, P1);
  const ff = put(g0, P0, 'Ferrous Forerunner', 'base');
  const other = put(g0, P0, 'V(5)', 'base');
  let g = move(g0, P0, [ff], BF_A);
  let rexTargets: string[] = [];
  g = drive(g, gg => { const d = gg.pending!; if (d.kind === 'chooseTargets' && d.player === P1) { rexTargets = d.options!.map(o => o.id); } return undefined; }).g;
  assert.equal(zone(g, rex), 'trash'); assert.equal(zone(g, ff), 'trash');
  const mechs = Object.keys(g.objects).filter(id => g.objects[id].isToken && g.objects[id].zone === 'base' && g.objects[id].controller === P0);
  assert.equal(mechs.length, 2, 'two Mechs');
  assert.ok(mechs.every(m => !rexTargets.includes(m)), 'Mechs were not choosable');
  assert.ok(mechs.every(m => (g.objects[m].damage ?? 0) === 0));
  assert.equal(g.objects[other].damage, 4, 'Rex hit the only enemy unit that existed');
});

test('RJ#10480 Sacrifice countered by Defy: the unit killed as its additional cost stays dead', () => {
  const g0 = S0(); fundAll(g0, P0); fundAll(g0, P1);
  const m = put(g0, P0, 'V(5)', 'base');
  const defy = hand(g0, P1, 'Defy');
  const sac = hand(g0, P0, 'Sacrifice');
  let g = play(g0, P0, sac, { targets: [[m]], cards: [[m]] });
  assert.equal(zone(g, m), 'trash', 'cost paid on play');
  if (pend(g).player !== P1) g = pass(g);
  g = play(g, P1, defy);
  g = resolveChain(g);
  assert.equal(zone(g, sac), 'trash'); assert.equal(zone(g, m), 'trash');
  assert.equal(g.players[P0].hand.length, 0, 'no draw (countered)');
});

test('RJ#10481 Void Assault moves units only (a battlefield is never a choice)', () => {
  const g0 = S0(); fundAll(g0, P0);
  const f = put(g0, P0, 'V(2)', 'base'); const f2 = put(g0, P0, 'V(1)', 'base');
  put(g0, P1, 'V(2)', BF_A); control(g0, BF_A, P1);
  const g = act(g0, { type: 'playCard', player: P0, obj: hand(g0, P0, 'Void Assault') });
  const d = pend(g);
  assert.equal(d.kind, 'chooseTargets');
  assert.ok(d.options!.every(o => g.objects[o.id]?.zone === 'base' || g.objects[o.id]?.zone === 'battlefield'), 'only units offered');
  assert.ok(d.options!.some(o => o.id === f) && d.options!.some(o => o.id === f2));
});

test('RJ#10482 Fading Memories\' Temporary kills the unit at its controller\'s Beginning Phase; a hidden Sprite Call in response makes a Sprite that survives', () => {
  const g0 = S0({ tp: P1 }); fundAll(g0, P0); fundAll(g0, P1); tokens(g0, 'Sprite');
  const u = put(g0, P0, 'V(2)', BF_A); control(g0, BF_A, P0);
  const sc = put(g0, P0, 'Sprite Call', { facedown: BF_A });
  let g = drive(play(g0, P1, hand(g0, P1, 'Fading Memories'), { targets: [[u]] })).g;
  g = endTurn(g, P1);
  assert.ok(g.chain.length > 0, 'Temporary trigger on the chain');
  g = drive(play(g, P0, sc)).g;
  assert.equal(zone(g, u), 'trash');
  const sprites = Object.keys(g.objects).filter(id => ['base', 'battlefield'].includes(g.objects[id].zone) && g.cards[g.objects[id].cardId]?.name === 'Sprite');
  assert.equal(sprites.length, 1, 'the new Sprite survives this turn');
});

test('RJ#10483 Void Assault: both units and their destinations are declared when it is played (before responses)', () => {
  const g0 = S0(); fundAll(g0, P0);
  const f = put(g0, P0, 'V(2)', 'base');
  const e = put(g0, P1, 'V(2)', BF_A); control(g0, BF_A, P1);
  let g = act(g0, { type: 'playCard', player: P0, obj: hand(g0, P0, 'Void Assault') });
  const seenBeforeChain: string[] = [];
  for (let i = 0; i < 8 && pend(g).inStep; i++) { seenBeforeChain.push(pend(g).kind); g = answer(g, { targets: [[f], [e]], locations: [BF_B, 'base'] }); if (pend(g).inStep && pend(g).kind === seenBeforeChain.at(-1) && i > 5) break; }
  assert.ok(seenBeforeChain.includes('chooseDestination'), `destinations chosen while playing (saw ${seenBeforeChain})`);
  g = resolveChain(g);
  assert.equal(pend(g).inStep, false, 'nothing left to choose on resolution');
});

test('RJ#10484 Deceiver\'s Reflection (to become a copy of Ruined Rex) can be Gusted in the reflexive "Then do this" window; it returns to hand and no Deathknell triggers', () => {
  const g0 = S0(); fundAll(g0, P0); fundAll(g0, P1); setLegend(g0, P0, 'Deceiver'); tokens(g0, 'Reflection');
  const rex = put(g0, P0, 'Ruined Rex', 'base'); hand(g0, P0, 'V(1)');
  const e = put(g0, P1, 'V(2)', BF_B); control(g0, BF_B, P1);
  const gust = hand(g0, P1, 'Gust');
  let g = move(g0, P0, [rex], BF_A);
  let refl: string | undefined;
  for (let i = 0; i < 20 && !refl; i++) {
    const d = pend(g); if (d.kind === 'mainAction') break;
    g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : d.options![0].id) : pass(g);
    refl = Object.keys(g.objects).find(id => g.objects[id].isToken && g.objects[id].zone === 'battlefield');
  }
  assert.ok(refl, 'Reflection entered');
  assert.ok(g.chain.length > 0, 'the copy instruction is still pending on the chain');
  if (pend(g).player !== P1) g = pass(g);
  g = play(g, P1, gust, { targets: [[refl!]] });
  g = drive(g).g;
  assert.ok(!['battlefield', 'trash'].includes(zone(g, refl!)), 'returned to hand / ceased to exist');
  assert.equal(g.objects[e].damage ?? 0, 0, 'no Deathknell');
});

test('RJ#10485 Portal Rescue on a token: the banished token ceases to exist, so it is not played back', () => {
  const g0 = S0(); fundAll(g0, P0); tokens(g0, 'Sprite');
  const t = put(g0, P0, 'Sprite', 'base', { token: true });
  const g = drive(play(g0, P0, hand(g0, P0, 'Portal Rescue'), { targets: [[t]] })).g;
  assert.ok(!g.players[P0].base.includes(t), 'not back in base');
  assert.ok(!Object.keys(g.objects).some(id => id !== t && g.objects[id].zone === 'base' && g.cards[g.objects[id].cardId]?.name === 'Sprite'), 'no new Sprite played');
});

test('RJ#10486 Rift Herald\'s Deathknell plays a unit (Elder Dragon returned by Star-Crossed) from hand to base ignoring its Energy cost', () => {
  const g0 = S0(); fundAll(g0, P0); fundAll(g0, P1);
  const rh = put(g0, P0, 'Rift Herald', BF_A); control(g0, BF_A, P0);
  const ed = hand(g0, P0, 'Elder Dragon');
  setRunes(g0, P0, 0); addRunes(g0, P0, 4, 'body'); // power only: no energy for the Dragon's 12
  const g = drive(play(S0tp(g0, P1), P1, hand(g0, P1, 'Hidden Blade'), { targets: [[rh]] }), gg => gg.pending!.kind === 'chooseCards' && gg.pending!.options!.some(o => o.id === ed) ? [ed] : undefined).g;
  assert.equal(zone(g, rh), 'trash');
  assert.equal(zone(g, ed), 'base', 'Elder Dragon played to base');
});

test('RJ#10487 Daughter of the Void (Kai\'Sa legend) adds power, not energy, usable only to play spells', () => {
  const g0 = S0(); setRunes(g0, P0, 0);
  const l = setLegend(g0, P0, 'Daughter of the Void');
  const ab = legal(g0, P0, 'activate').find(a => a.type === 'activate' && a.obj === l);
  assert.ok(ab, 'legend ability available');
  let g = act(g0, ab!);
  g = drive(g).g;
  assert.equal(g.players[P0].pool.energy, 0, 'no energy');
  const r = (g.players[P0].poolRestricted ?? []) as { kind: string; amount: number; only?: string }[];
  assert.deepEqual(r.map(x => [x.kind, x.amount, x.only]), [['power', 1, 'spell']], 'one power, usable only to play spells');
});

test('RJ#10488 Scuttle Crab\'s Deathknell: the hand reveal is one-time, but the facedown cards stay visible for the rest of the turn', () => {
  const g0 = S0({ tp: P1 }); fundAll(g0, P1);
  const sc = put(g0, P0, 'Scuttle Crab', BF_A); control(g0, BF_A, P0);
  const h1 = hand(g0, P1, 'V(2)');
  put(g0, P1, 'V(1)', BF_B); control(g0, BF_B, P1);
  const fd = put(g0, P1, 'HidU(2)', { facedown: BF_B, hiddenTurn: g0.turn });
  const g = drive(play(g0, P1, hand(g0, P1, 'Hidden Blade'), { targets: [[sc]] }), gg => gg.pending!.kind === 'chooseTargets' && gg.pending!.options!.some(o => o.id === P1 as unknown as string || o.id === '1') ? ['1'] : undefined).g;
  assert.equal(zone(g, sc), 'trash');
  const v = getView(g, P0).state.objects;
  assert.equal(v[fd]?.cardId, g.objects[fd].cardId, 'facedown card visible to P0 this turn');
  assert.notEqual(v[h1]?.cardId, g.objects[h1].cardId, 'hand hidden again');
});

test('RJ#10489 Deceiver\'s hold trigger resolves in the Beginning Phase scoring step, before the Channel and Draw phases', () => {
  const g0 = S0({ tp: P1 }); setLegend(g0, P0, 'Deceiver'); tokens(g0, 'Reflection');
  put(g0, P0, 'V(2)', BF_A); control(g0, BF_A, P0);
  hand(g0, P0, 'V(1)');
  const g = drive(endTurn(g0, P1)).g;
  const L = logText(g);
  const iRes = L.indexOf('Resolving Deceiver'), iCh = L.lastIndexOf('P0 channels'), iDr = L.lastIndexOf('P0 draws');
  assert.ok(iRes >= 0, 'Deceiver triggered on hold');
  assert.ok(iRes < iCh && iRes < iDr, 'resolved before channel and draw');
});

test('RJ#10490 Runes can be recycled for power whenever you have priority (even on the opponent\'s turn); merely adding power is not "spending" it for Sivir, Mercenary', () => {
  const g0 = S0({ tp: P1 }); fundAll(g0, P0); fundAll(g0, P1);
  const sv = put(g0, P0, 'Sivir, Mercenary', 'base');
  let g = pass(play(g0, P1, hand(g0, P1, 'DrawR')));
  assert.equal(pend(g).player, P0);
  for (let i = 0; i < 2; i++) {
    const r = legal(g, P0, 'activate').find(a => a.type === 'activate' && g.objects[a.obj].zone === 'runePool' && a.abilityIndex === 951);
    assert.ok(r, 'rune recycle ability available with priority');
    g = act(g, r!);
  }
  assert.equal(Object.values(g.players[P0].pool.power).reduce((s, n) => s + (n ?? 0), 0), 2, '2 power added');
  assert.equal(mightOf(g, sv), 4, 'not +2: the power was added, not spent (card text "If you\'ve spent at least [A][A]")');
});

test('RJ#10491 While Watchful Sentry\'s Deathknell is on the chain, its controller still controls the battlefield and can play a hidden Mischievous Marai there', () => {
  const g0 = S0({ tp: P1 }); fundAll(g0, P1);
  const ws = put(g0, P0, 'Watchful Sentry', BF_A); control(g0, BF_A, P0);
  const mm = put(g0, P0, 'Mischievous Marai', { facedown: BF_A });
  let g = play(g0, P1, hand(g0, P1, 'Hidden Blade'), { targets: [[ws]] });
  for (let i = 0; i < 6 && !(zone(g, ws) === 'trash' && g.chain.some(c => /Watchful/.test(String(c.label)))); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.ok(g.chain.some(c => /Watchful/.test(String(c.label))), 'Deathknell pending');
  if (pend(g).player !== P0) g = pass(g);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.ok(canPlayNow(g, P0, mm, BF_A), 'hidden Marai playable there');
});

test('RJ#10492 A hidden Mischievous Marai cannot be played at Rockfall Path ("Units can\'t be played here"); it stays hidden', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1); tokens(g, 'Sprite'); setBattlefieldCard(g, BF_A, 'Rockfall Path');
  put(g, P0, 'Sprite', BF_A, { token: true }); control(g, BF_A, P0);
  const mm = put(g, P0, 'Mischievous Marai', { facedown: BF_A });
  g = pass(play(g, P1, hand(g, P1, 'DrawR')));
  assert.equal(pend(g).player, P0);
  assert.ok(!canPlayNow(g, P0, mm), 'not playable');
  assert.notEqual(rejects(g, { type: 'playCard', player: P0, obj: mm, destination: BF_A }), null);
  assert.equal(zone(g, mm), 'facedown');
});

test('RJ#10493 "All enemy units" effects do not choose units, so Deflect adds no cost (Firestorm)', () => {
  const recycled = (tgt: string) => {
    const g0 = S0(); fundAll(g0, P0);
    put(g0, P1, tgt, BF_A); control(g0, BF_A, P1);
    const n0 = g0.players[P0].runesInPlay.length;
    const g = play(g0, P0, hand(g0, P0, 'Firestorm'), { battlefields: [BF_A] });
    assert.ok(g.chain.some(c => /Firestorm/.test(String(c.label))));
    return n0 - g.players[P0].runesInPlay.length;
  };
  assert.equal(recycled('Deflect(3,1)'), recycled('V(3)'), 'no Deflect tax');
});

test('RJ#10494 Two Ahri, Alluring holding the same battlefield: 1 (hold) + 1 + 1 = 3 points', () => {
  const g0 = S0({ tp: P1 });
  put(g0, P0, 'Ahri, Alluring', BF_A); put(g0, P0, 'Ahri, Alluring', BF_A); control(g0, BF_A, P0);
  const g = drive(endTurn(g0, P1)).g;
  assert.equal(g.players[P0].points, 3);
});

test('RJ#10495 A unit played by Baited Hook (ignoring its cost) can still pay Accelerate and enter ready', () => {
  const g0 = S0(); fundAll(g0, P0);
  put(g0, P0, 'V(3)', 'base');
  const hook = put(g0, P0, 'Baited Hook', 'base');
  const ac = put(g0, P0, 'Accel(2)', 'deckTop');
  let g = passAll(act(g0, { type: 'activate', player: P0, obj: hook, abilityIndex: 0 }));
  let offered = false;
  g = drive(g, gg => { const d = gg.pending!; if (d.kind === 'chooseCards' && d.options!.some(o => o.id === ac)) return [ac]; if (d.kind === 'optional' && /Accelerate/i.test(d.prompt)) { offered = true; return ['yes']; } return undefined; }).g;
  assert.ok(offered, 'Accelerate offered');
  assert.ok(['base', 'battlefield'].includes(zone(g, ac)));
  assert.equal(g.objects[ac].exhausted, false, 'entered ready');
});

test('RJ#10496 Tideturner played to base cannot choose a unit in the same base ("at another location")', () => {
  const g0 = S0(); fundAll(g0, P0);
  const x = put(g0, P0, 'Irelia, Fervent', 'base');
  const tt = hand(g0, P0, 'Tideturner');
  let offeredX = false;
  const g = drive(play(g0, P0, tt), gg => { const d = gg.pending!; if (d.options?.some(o => o.id === x)) offeredX = true; return undefined; }).g;
  assert.ok(!offeredX, 'the base unit is not a legal choice');
  assert.equal(locOf(g, tt), 'base'); assert.equal(locOf(g, x), 'base');
});

test('RJ#10497 Abandoned Hall\'s "when a player plays a spell" +1 comes after Challenge resolves, too late to help', () => {
  const g0 = S0(); fundAll(g0, P0); setBattlefieldCard(g0, BF_A, 'Abandoned Hall');
  const f = put(g0, P0, 'V(3)', BF_A); control(g0, BF_A, P0);
  const e = put(g0, P1, 'V(3)', BF_B); control(g0, BF_B, P1);
  const g = drive(play(g0, P0, hand(g0, P0, 'Challenge'), { targets: [[f], [e]] }), gg => gg.pending!.kind === 'chooseTargets' && gg.pending!.options!.some(o => o.id === f) ? [f] : undefined).g;
  assert.equal(zone(g, e), 'trash');
  assert.equal(zone(g, f), 'trash', 'the +1 did not arrive before the fight');
});

test('RJ#10498 Tianna Crownguard stops gaining points, but a final-point conquer still draws instead', () => {
  const g0 = S0();
  put(g0, P1, 'Tianna Crownguard', BF_B); control(g0, BF_B, P1);
  const u = put(g0, P0, 'V(2)', 'base');
  g0.players[P0].points = 7;
  const h0 = g0.players[P0].hand.length;
  const g = drive(move(g0, P0, [u], BF_A)).g;
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, 7, 'no point');
  assert.equal(g.players[P0].hand.length, h0 + 1, 'drew 1 for the final-point conquer');
});

test('RJ#10499 The List\'s ability chooses a unit, so it cannot target an enemy Ruin Runner', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const rr = put(g, P0, 'Ruin Runner', BF_A); control(g, BF_A, P0);
  const l = hand(g, P1, 'The List');
  g = act(g, { type: 'playCard', player: P1, obj: l });
  assert.ok(pend(g).options!.some(o => o.id === 'Shurima'), 'Shurima can be named');
  g = drive(choose(g, 'Shurima')).g;
  assert.equal(zone(g, l), 'base');
  const ab = legal(g, P1, 'activate').find(a => a.type === 'activate' && a.obj === l);
  let offered = false;
  if (ab) { const h = act(g, ab); offered = !!h.pending?.options?.some(o => o.id === rr) || h.chain.some(c => c.targets.flat().includes(rr)); }
  assert.ok(!offered, 'Ruin Runner is not a legal choice');
  assert.equal(mightOf(g, rr), 5);
});

test('RJ#10500 Two Stand United in a turn: buffs give +3 Might; a unit still holds only one buff', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', 'base');
  for (let i = 0; i < 2; i++) g = drive(play(g, P0, hand(g, P0, 'Stand United'), { targets: [[u]] })).g;
  assert.equal(g.objects[u].counters.buff, 1, 'one buff counter');
  assert.equal(mightOf(g, u), 5, '2 + buff (1 +1 +1)');
});

test('RJ#10501 Not So Fast counters Mirror Image only when it chooses one of your units', () => {
  const run = (mine: boolean) => {
    const g0 = S0(); fundAll(g0, P0); fundAll(g0, P1); tokens(g0, 'Reflection');
    const theirs = put(g0, P1, 'V(3)', 'base'); const own = put(g0, P0, 'V(2)', 'base');
    const nsf = hand(g0, P1, 'Not So Fast');
    let g = play(g0, P0, hand(g0, P0, 'Mirror Image'), { targets: [[mine ? theirs : own]] });
    if (pend(g).player !== P1) g = pass(g);
    return canPlayNow(g, P1, nsf);
  };
  assert.equal(run(true), true, 'copying P1\'s unit chooses it');
  assert.equal(run(false), false, 'copying P0\'s own unit chooses no friendly unit of P1');
});

test('RJ#10502 Vi, Peacekeeper\'s attack stun chooses its target, so it cannot stun an enemy Baron Nashor', () => {
  const g0 = S0();
  const b = put(g0, P1, 'Baron Nashor', BF_A); control(g0, BF_A, P1);
  const vi = put(g0, P0, 'Vi, Peacekeeper', 'base');
  let g = move(g0, P0, [vi], BF_A);
  let offered = false;
  for (let i = 0; i < 6 && g.pending!.kind !== 'assignDamage' && g.pending!.kind !== 'mainAction'; i++) { if (g.pending!.options?.some(o => o.id === b)) offered = true; g = g.pending!.inStep ? choose(g, g.pending!.options![0].id) : pass(g); }
  assert.ok(!offered, 'Baron not choosable');
  assert.ok(!g.objects[b].stunned, 'not stunned');
});

test('RJ#10503 Weaponmaster may move an Equipment off another unit, paying its Equip cost minus [A]: [A] → free; a cost without [A] is not reduced (CR 821.1.c.3)', () => {
  const run = (gear: string) => {
    const g0 = S0(); fundAll(g0, P0);
    const other = put(g0, P0, 'V(2)', BF_A); control(g0, BF_A, P0);
    const tf = put(g0, P0, gear, 'base'); attachNow(g0, tf, other);
    const lu = hand(g0, P0, 'Lucian, Merciless');
    let g = play(g0, P0, lu);
    const afterPlay = g.players[P0].runesInPlay.length;
    g = drive(g, gg => { const d = gg.pending!; if (d.kind === 'chooseCards' || d.kind === 'chooseTargets') return d.options!.some(o => o.id === tf) ? [tf] : undefined; return undefined; }).g;
    assert.equal(g.objects[tf].attachedTo, lu, `${gear} moved to Lucian`);
    return afterPlay - g.players[P0].runesInPlay.length;
  };
  assert.equal(run('Forgefire Cape'), 0, 'Equip [A] minus [A] = free');
  assert.equal(run('Trinity Force'), 1, 'Equip [C] (no [A]) is paid in full');
});


test('RJ#10504 Two Shards of Undoing each trigger: the opponent kills two units', () => {
  const g0 = S0({ tp: P1 });
  put(g0, P0, 'Shard of Undoing', 'base'); put(g0, P0, 'Shard of Undoing', 'base');
  put(g0, P0, 'Temp(1)', 'base');
  const e1 = put(g0, P1, 'V(2)', 'base'), e2 = put(g0, P1, 'V(2)', 'base'), e3 = put(g0, P1, 'V(2)', 'base');
  const g = drive(endTurn(g0, P1)).g;
  assert.equal([e1, e2, e3].filter(e => zone(g, e) === 'trash').length, 2);
});

test('RJ#10505 Re-taking an already-scored battlefield in the same turn is not a conquer: no point, no "when I conquer" trigger', () => {
  const g0 = S0();
  const k = put(g0, P0, 'Kai\'Sa, Survivor', 'base');
  let g = drive(move(g0, P0, [k], BF_A)).g;
  assert.equal(g.players[P0].points, 1); const h1 = g.players[P0].hand.length;
  g.objects[k].exhausted = false; g.timestamp++;
  g = drive(move(g, P0, [k], 'base')).g;
  assert.equal(g.battlefields[BF_A].controller, null, 'lost control');
  g.objects[k].exhausted = false; g.timestamp++;
  g = drive(move(g, P0, [k], BF_A)).g;
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, 1, 'no second point');
  assert.equal(g.players[P0].hand.length, h1, 'no second conquer draw');
});

test('RJ#10506 Thousand-Tailed Watcher\'s play effect uses the chain (Reactions can respond), but Not So Fast can\'t counter it (it chooses no unit)', () => {
  const g0 = S0(); fundAll(g0, P0); fundAll(g0, P1);
  const e = put(g0, P1, 'V(5)', 'base');
  const nsf = hand(g0, P1, 'Not So Fast'); const dr = hand(g0, P1, 'DrawR');
  let g = play(g0, P0, hand(g0, P0, 'Thousand-Tailed Watcher'), { may: [false] });
  for (let i = 0; i < 4 && !g.chain.some(c => /Thousand/.test(String(c.label))); i++) g = pend(g).inStep ? choose(g, pend(g).options!.at(-1)!.id) : pass(g);
  assert.ok(g.chain.some(c => /Thousand/.test(String(c.label))), 'play trigger on the chain');
  if (pend(g).player !== P1) g = pass(g);
  assert.ok(canPlayNow(g, P1, dr), 'a Reaction can respond');
  assert.ok(!canPlayNow(g, P1, nsf), 'Not So Fast has nothing to counter');
  g = drive(g).g;
  assert.equal(mightOf(g, e), 2);
});

test('RJ#10507 Stalking Wolf\'s "kill a Bird" additional cost leaves no window to respond before the Wolf is played', () => {
  const g0 = S0(); fundAll(g0, P0); fundAll(g0, P1); tokens(g0, 'Bird');
  const bird = put(g0, P0, 'Bird', 'base', { token: true });
  const fr = hand(g0, P1, 'Friendship');
  const w = hand(g0, P0, 'Stalking Wolf');
  let g = act(g0, { type: 'playCard', player: P0, obj: w, destination: 'base' });
  const seen: string[] = [];
  for (let i = 0; i < 6 && pend(g).inStep; i++) { seen.push(`${pend(g).kind}:P${pend(g).player}`); g = answer(g, { cards: [[bird]], targets: [[bird]], may: [false] }); if (pend(g).inStep && seen.length > 4) break; }
  assert.ok(!seen.some(s => s.endsWith('P1')), 'P1 gets no decision during the cost');
  assert.ok(zone(g, bird) !== 'base', 'Bird killed as the cost');
  assert.ok(['base', 'battlefield'].includes(zone(g, w)), 'Wolf already played');
  void fr;
});

test('RJ#10508 Sett, Brawler: spending his buff (cost) drops him to 4, the ability then makes him 8', () => {
  const g0 = S0();
  const s = put(g0, P0, 'Sett, Brawler', 'base', { buff: true });
  assert.equal(mightOf(g0, s), 5);
  const ab = legal(g0, P0, 'activate').find(a => a.type === 'activate' && a.obj === s)!;
  let g = act(g0, ab);
  assert.equal(g.objects[s].counters.buff ?? 0, 0, 'buff spent as the cost');
  assert.equal(mightOf(g, s), 4, 'not Mighty while the ability is pending');
  g = drive(g).g;
  assert.equal(mightOf(g, s), 8);
});

test('RJ#10509 Nine-Tailed Fox (Ahri legend) triggers for each attacking enemy unit: two Gemhand Hunters both get -1', () => {
  const g0 = S0(); setLegend(g0, P1, 'Nine-Tailed Fox');
  put(g0, P1, 'V(5)', BF_A); control(g0, BF_A, P1);
  const a = put(g0, P0, 'Gemhand Hunter', 'base'), b = put(g0, P0, 'Gemhand Hunter', 'base');
  let g = move(g0, P0, [a, b], BF_A);
  for (let i = 0; i < 10 && pend(g).kind !== 'assignDamage' && pend(g).kind !== 'mainAction'; i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(mightOf(g, a), 1); assert.equal(mightOf(g, b), 1);
});

test('RJ#10511 Elder Dragon returned by Star-Crossed in response to its play trigger: the 1 damage still resolves', () => {
  const g0 = S0(); fundAll(g0, P0, 3); addRunes(g0, P0, 4, 'body'); fundAll(g0, P1);
  const e = put(g0, P1, 'V(1)', BF_A); control(g0, BF_A, P1);
  const mine = put(g0, P1, 'V(2)', 'base');
  const sc = hand(g0, P1, 'Star-Crossed');
  let g = play(g0, P0, hand(g0, P0, 'Elder Dragon'));
  for (let i = 0; i < 8 && !(g.chain.some(c => /Elder/.test(String(c.label))) && !pend(g).inStep); i++) {
    const d = pend(g);
    g = d.inStep ? choose(g, ...(d.options!.some(o => o.id === e) ? [e] : [])) : pass(g);
  }
  const ed = g.chain.find(c => /Elder/.test(String(c.label)))!.source;
  if (pend(g).player !== P1) g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: sc });
  for (let i = 0; i < 4 && pend(g).inStep; i++) { const d = pend(g); g = choose(g, d.options!.some(o => o.id === mine) ? mine : ed); }
  g = drive(g).g;
  assert.equal(zone(g, ed), 'hand', 'Elder Dragon returned');
  assert.equal(g.objects[e]?.damage === 1 || zone(g, e) === 'trash', true, 'its trigger still dealt 1');
});

test('RJ#10512 Vanguard Armory with Gemcraft Seer: each Recruit\'s Vision recycle triggers Karma, Channeler separately (3 times)', () => {
  const g0 = S0(); tokens(g0, 'Recruit');
  put(g0, P0, 'Gemcraft Seer', 'base'); put(g0, P0, 'Karma, Channeler', 'base');
  const va = put(g0, P0, 'Vanguard Armory', 'base');
  for (let i = 0; i < 5; i++) put(g0, P0, 'V(1)', 'deckTop');
  const ab = legal(g0, P0, 'activate').find(a => a.type === 'activate' && a.obj === va)!;
  const g = drive(act(g0, ab), gg => { const d = gg.pending!; if (d.kind === 'optional') return ['yes']; if (d.kind === 'chooseCards' && /Vision|recycle/i.test(d.prompt)) return d.options!.map(o => o.id).slice(0, 1); return undefined; }, 80).g;
  const n = (logText(g).match(/Trigger: Karma/g) ?? []).length;
  assert.equal(n, 3, logText(g).split('\n').filter(l => /Vision|Karma|recycle/i.test(l)).join(' / '));
});

test('RJ#10513 Teemo, Strategist Gusted in response to his defend trigger: it still reveals and recycles, but deals no damage', () => {
  const g0 = S0(); fundAll(g0, P0);
  const t = put(g0, P1, 'Teemo, Strategist', BF_A); control(g0, BF_A, P1);
  for (let i = 0; i < 5; i++) put(g0, P1, 'HidU(1)', 'deckTop');
  const a = put(g0, P0, 'V(4)', 'base');
  const gust = hand(g0, P0, 'Gust');
  let g = move(g0, P0, [a], BF_A);
  for (let i = 0; i < 6 && !g.chain.some(c => /Teemo/.test(String(c.label))); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.ok(g.chain.some(c => /Teemo/.test(String(c.label))));
  if (pend(g).player !== P0) g = pass(g);
  g = play(g, P0, gust, { targets: [[t]] });
  g = drive(g).g;
  assert.equal(zone(g, t), 'hand');
  assert.ok(/Revealed|reveals/i.test(logText(g)), 'still revealed');
  assert.equal(g.objects[a].damage ?? 0, 0, 'no damage');
});

test('RJ#10515 Dusk Rose Lab: declining its "you may" puts nothing on the chain', () => {
  const g0 = S0({ tp: P1 }); setBattlefieldCard(g0, BF_A, 'Dusk Rose Lab');
  const u = put(g0, P0, 'V(2)', BF_A); control(g0, BF_A, P0);
  let g = endTurn(g0, P1);
  let asked = false;
  for (let i = 0; i < 10 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'optional') { asked = true; g = no(g); assert.equal(g.chain.length, 0, 'nothing on the chain after declining'); continue; }
    g = d.inStep ? choose(g, d.options![0].id) : pass(g);
  }
  assert.ok(asked, 'the optional trigger was offered');
  assert.equal(locOf(g, u), BF_A);
});

test('RJ#10516 Vex, Apathetic: the opponent can\'t move the stunned unit even with Ride the Wind, but Vex\'s controller can Charm it', () => {
  // opponent's own moves are blocked
  let g = S0({ tp: P1 }); fundAll(g, P1);
  put(g, P0, 'Vex, Apathetic', BF_A); control(g, BF_A, P0);
  const u = hand(g, P1, 'V(2)');
  g = drive(play(g, P1, u)).g;
  assert.ok(g.objects[u].stunned, 'stunned');
  assert.ok(!legal(g, P1, 'move').some(a => a.type === 'move' && a.units.includes(u)), 'no standard move');
  const rtw = hand(g, P1, 'Ride the Wind');
  if (canPlayNow(g, P1, rtw)) {
    const r = drive(play(g, P1, rtw, { targets: [[u]] }), gg => gg.pending!.kind === 'chooseDestination' ? [String(BF_B)] : undefined).g;
    assert.equal(locOf(r, u), 'base', 'Ride the Wind did not move it');
  }
  // Vex's controller moves it: P1 ambushes a unit in on P0's turn, P0 Charms it
  let h = S0(); fundAll(h, P0); fundAll(h, P1);
  put(h, P0, 'Vex, Apathetic', BF_A); control(h, BF_A, P0);
  put(h, P1, 'V(1)', BF_B); control(h, BF_B, P1);
  const amb = hand(h, P1, 'Ambusher(2)');
  h = pass(play(h, P0, hand(h, P0, 'DrawR')));
  h = drive(play(h, P1, amb, { dest: BF_B })).g;
  assert.ok(h.objects[amb].stunned);
  h = drive(play(h, P0, hand(h, P0, 'Charm'), { targets: [[amb]] }), gg => gg.pending!.kind === 'chooseDestination' ? ['base'] : undefined).g;
  assert.equal(locOf(h, amb), 'base', 'Charm moved it');
});

test('RJ#10517 Baited Hook on my last unit at a battlefield: the hooked unit can still be played there (control kept while resolving)', () => {
  const g0 = S0(); fundAll(g0, P0);
  const v = put(g0, P0, 'V(3)', BF_A); control(g0, BF_A, P0);
  const hook = put(g0, P0, 'Baited Hook', 'base');
  const top = put(g0, P0, 'V(2)', 'deckTop');
  let dests: string[] = [];
  const g = drive(act(g0, { type: 'activate', player: P0, obj: hook, abilityIndex: 0 }), gg => {
    const d = gg.pending!;
    if (d.kind === 'chooseTargets' && d.options!.some(o => o.id === v)) return [v];
    if (d.kind === 'chooseCards' && d.options!.some(o => o.id === top)) return [top];
    if (d.kind === 'chooseDestination') { dests = d.options!.map(o => o.id); return d.options!.some(o => o.id === String(BF_A)) ? [String(BF_A)] : undefined; }
    return undefined;
  }).g;
  assert.equal(zone(g, v), 'trash');
  assert.ok(dests.includes(String(BF_A)), `BF-A offered (${dests})`);
  assert.equal(locOf(g, top), BF_A);
});

test('RJ#10518 Equip uses the chain: Gust the unit in response and the Equip does nothing', () => {
  const g0 = S0(); fundAll(g0, P0); fundAll(g0, P1);
  const u = put(g0, P0, 'V(2)', BF_A); control(g0, BF_A, P0);
  const tf = put(g0, P0, 'Trinity Force', 'base');
  const gust = hand(g0, P1, 'Gust');
  const ab = legal(g0, P0, 'activate').find(a => a.type === 'activate' && a.obj === tf)!;
  let g = answer(act(g0, ab), { targets: [[u]] });
  assert.ok(g.chain.length > 0, 'Equip on the chain');
  if (pend(g).player !== P1) g = pass(g);
  g = play(g, P1, gust, { targets: [[u]] });
  g = drive(g).g;
  assert.equal(zone(g, u), 'hand');
  assert.ok(!g.objects[tf].attachedTo, 'not attached');
});

test('RJ#10519 Arise! with Emperor of the Sands: Arise readies up to two Sand Soldiers before their Weaponmaster triggers resolve', () => {
  const g0 = S0(); fundAll(g0, P0); setLegend(g0, P0, 'Emperor of the Sands');
  put(g0, P0, 'Trinity Force', 'base'); put(g0, P0, 'Forgefire Cape', 'base');
  const r = drive(play(g0, P0, hand(g0, P0, 'Arise!')), gg => { const d = gg.pending!; if (d.kind === 'optional') return ['yes']; if (d.kind === 'chooseCards' || d.kind === 'chooseTargets') return d.options!.slice(0, Math.max(1, Math.min(d.max ?? 1, 2))).map(o => o.id); return undefined; }, 60);
  const g = r.g;
  const soldiers = Object.keys(g.objects).filter(id => g.cards[g.objects[id].cardId]?.name === 'Sand Soldier' && ['base', 'battlefield'].includes(g.objects[id].zone));
  assert.equal(soldiers.length, 2, 'two Sand Soldiers');
  assert.ok(soldiers.every(id => !g.objects[id].exhausted), `both readied (${r.seen.join(' | ')})`);
  // Arise's "Then do this" is a reflexive trigger (CR 387) placed with the Weaponmaster triggers; it is on top, so it resolves first.
  const lines = g.log.map(l => l.text);
  const iReady = lines.findIndex(s => /^Resolving Arise!: .*ready/i.test(s));
  const iWm = lines.findIndex(s => /^Resolving Sand Soldier: Weaponmaster/.test(s));
  assert.ok(iReady >= 0 && (iWm < 0 || iReady < iWm), `ready resolves before the Weaponmaster attaches (${lines.slice(-12).join(' | ')})`);
});

test('RJ#10520 Rally the Troops: friendly units played later this turn get a buff (max one per unit)', () => {
  let g = S0(); fundAll(g, P0);
  const before = put(g, P0, 'V(2)', 'base');
  g = drive(play(g, P0, hand(g, P0, 'Rally the Troops'))).g;
  const u = hand(g, P0, 'V(3)');
  g = drive(play(g, P0, u)).g;
  assert.equal(g.objects[u].counters.buff, 1);
  assert.equal(mightOf(g, u), 4);
  assert.ok(!(g.objects[before].counters.buff > 0), 'units already in play are not buffed');
});

test('RJ#10522 Rengar ambushed in response to the opponent\'s Flash enters first; after Flash removes their units there is no combat and the battlefield is taken via the showdown, not immediately', () => {
  const g0 = S0(); fundAll(g0, P0); fundAll(g0, P1);
  const e = put(g0, P1, 'V(3)', BF_A); control(g0, BF_A, P1);
  put(g0, P1, 'V(1)', BF_B); control(g0, BF_B, P1);
  const fl = hand(g0, P1, 'Flash'); const r = hand(g0, P0, 'Rengar, Trophy Hunter');
  let g = pass(play(g0, P0, hand(g0, P0, 'DrawR')));
  g = play(g, P1, fl, { targets: [[e]] });
  if (pend(g).player !== P0) g = pass(g);
  assert.ok(canPlayNow(g, P0, r, BF_A), 'Rengar can ambush in response');
  g = play(g, P0, r, { dest: BF_A });
  assert.equal(locOf(g, r), BF_A, 'Rengar entered first');
  assert.equal(g.players[P0].points, 0, 'no point yet');
  g = drive(g).g;
  assert.equal(locOf(g, e), 'base'); assert.equal(g.objects[e].damage ?? 0, 0, 'no combat');
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#10523 Hold scoring at the start of the turn opens no priority window', () => {
  const g0 = S0({ tp: P1 }); fundAll(g0, P0); fundAll(g0, P1);
  put(g0, P0, 'V(2)', BF_A); control(g0, BF_A, P0);
  hand(g0, P1, 'DrawR'); hand(g0, P0, 'DrawR');
  const g = endTurn(g0, P1);
  assert.equal(g.players[P0].points, 1, 'held');
  assert.equal(pend(g).kind, 'mainAction'); assert.equal(pend(g).player, P0, 'no reaction window before the Main phase');
});

test('RJ#10525 Facedown cards are revealed to all players when the game ends', () => {
  const g0 = S0({ tp: P1, victoryScore: 2 });
  put(g0, P0, 'V(1)', BF_A); control(g0, BF_A, P0);
  const fd = put(g0, P0, 'HidU(2)', { facedown: BF_A });
  g0.players[P0].points = 1;
  assert.notEqual(getView(g0, P1).state.objects[fd]?.cardId, g0.objects[fd].cardId, 'hidden during the game');
  const g = drive(endTurn(g0, P1)).g; // P0 holds for the winning point
  assert.equal(g.winner, P0);
  assert.equal(getView(g, P1).state.objects[fd]?.cardId, g.objects[fd].cardId, 'revealed to the opponent at game end');
});

test('RJ#10526 Blast Cone moving an enemy unit to an open battlefield: that player conquers it after the showdown', () => {
  const g0 = S0(); fundAll(g0, P0);
  const e = put(g0, P1, 'V(2)', 'base');
  const g = drive(play(g0, P0, hand(g0, P0, 'Blast Cone')), gg => {
    const d = gg.pending!;
    if (d.kind === 'optional') return /[Ss]tun/.test(d.prompt) ? ['no'] : ['yes'];
    if (d.kind === 'chooseTargets' && d.options!.some(o => o.id === e)) return [e];
    if (d.kind === 'chooseDestination') return [String(BF_A)];
    return undefined;
  }).g;
  assert.equal(locOf(g, e), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P1);
  assert.equal(g.players[P1].points, 1, 'P1 conquered on P0\'s turn');
});

test('RJ#10528 Tryndamere: only assigned combat damage counts as excess, but earlier spell damage lowers the lethal amount', () => {
  const run = (ray: boolean) => {
    const g0 = S0({ seed: 3 }); fundAll(g0, P0);
    const d = put(g0, P1, 'V(4)', BF_A); control(g0, BF_A, P1);
    const t = put(g0, P0, 'Tryndamere, Barbarian', 'base');
    const rh = hand(g0, P0, 'Hextech Ray');
    let g = move(g0, P0, [t], BF_A);
    if (ray) g = resolveChain(play(g, P0, rh, { targets: [[d]] }));
    g = drive(g, gg => gg.pending!.kind === 'assignDamage' ? undefined : undefined).g;
    assert.equal(zone(g, d), 'trash');
    return g.players[P0].points;
  };
  assert.equal(run(false), 1, '8 vs 4 Might: 4 excess — conquer point only');
  assert.equal(run(true), 2, 'after 3 spell damage lethal is 1: 7 excess — Tryndamere scores 1 more');
});

test('RJ#10529 Damage marked earlier in the turn counts in combat: 5-Might defender with 3 damage vs a 3-Might attacker — both die', () => {
  let { g, atk, def } = attackSetup(['V(3)'], ['V(5)'], { defOpts: [{ damage: 3 }] });
  g = drive(g).g;
  assert.equal(zone(g, def[0]), 'trash'); assert.equal(zone(g, atk[0]), 'trash');
});

test('RJ#10532 Unyielding Spirit then Flurry of Blades on top (my Elder Dragon, two enemy Ruined Rex): Flurry kills both Rex first; their Deathknells resolve before Unyielding Spirit', () => {
  const g0 = S0(); fundAll(g0, P0);
  put(g0, P0, 'Elder Dragon', 'base');
  const mine = put(g0, P0, 'V(5)', BF_B); control(g0, BF_B, P0);
  const r1 = put(g0, P1, 'Ruined Rex', BF_A), r2 = put(g0, P1, 'Ruined Rex', BF_A); control(g0, BF_A, P1);
  const us = hand(g0, P0, 'Unyielding Spirit'); const fob = hand(g0, P0, 'Flurry of Blades');
  let g = play(g0, P0, us);
  g = play(g, P0, fob);
  assert.deepEqual(g.chain.map(c => String(c.label).split(':')[0]), ['Unyielding Spirit', 'Flurry of Blades']);
  g = drive(g, gg => gg.pending!.kind === 'chooseTargets' && gg.pending!.options!.some(o => o.id === mine) ? [mine] : undefined).g;
  assert.equal(zone(g, r1), 'trash'); assert.equal(zone(g, r2), 'trash');
  assert.equal(zone(g, mine), 'trash', 'the Deathknells (4 + 4, after Flurry\'s 1) were not prevented');
});

test('RJ#10533 The Chosen Champion Teemo can be hidden from the Champion Zone (and not played the same turn)', () => {
  let g = S0();
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const cz = g.players[P0].championZone[0];
  const d = realCard('Teemo, Strategist'); g.cards = { ...g.cards, [d.id]: d }; g.objects[cz].cardId = d.id; g.timestamp++;
  const h = legal(g, P0, 'hide').find(a => a.type === 'hide' && a.obj === cz && a.battlefieldIndex === BF_A);
  assert.ok(h, 'hide from the Champion Zone is legal');
  g = act(g, h!);
  assert.equal(zone(g, cz), 'facedown');
  assert.ok(!canPlayNow(g, P0, cz), 'not playable the turn it was hidden');
});

test('RJ#10535 The Zero Drive plays only units banished with it, not units banished by Cursed Sarcophagus (linked abilities)', () => {
  const g0 = S0(); fundAll(g0, P0);
  const x = put(g0, P0, 'V(2)', 'trash');
  const zd = put(g0, P0, 'The Zero Drive', 'base');
  let g = drive(play(g0, P0, hand(g0, P0, 'Cursed Sarcophagus'))).g;
  assert.equal(zone(g, x), 'banishment', 'Sarcophagus banished it');
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === zd && a.abilityIndex === 1) ?? legal(g, P0, 'activate').filter(a => a.type === 'activate' && a.obj === zd).at(-1);
  if (ab) g = drive(act(g, ab)).g;
  assert.equal(zone(g, x), 'banishment', 'not played by The Zero Drive');
});

test('RJ#10536 Prodigal Explorer (Ezreal legend): choosing enemy units with two spells counts even if both are countered', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const l = setLegend(g, P0, 'Prodigal Explorer');
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const canDraw = (h: GameState) => legal(h, P0, 'activate').some(a => a.type === 'activate' && a.obj === l);
  assert.ok(!canDraw(g));
  for (let i = 0; i < 2; i++) {
    const ww = hand(g, P1, 'Wind Wall');
    g = pass(play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[e]] }));
    g = play(g, P1, ww);
    g = resolveChain(g);
    assert.equal(g.objects[e].damage ?? 0, 0, 'countered');
  }
  assert.ok(canDraw(g), 'legend ability usable');
});

test('RJ#10539 Pyke, Dockside Butcher played from Hidden: base cost ignored, but the optional [C] can still be paid to ready him with +2', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const py = put(g, P0, 'Pyke, Dockside Butcher', { facedown: BF_A });
  g = pass(play(g, P1, hand(g, P1, 'DrawR')));
  assert.ok(canPlayNow(g, P0, py));
  let asked = false;
  g = drive(play(g, P0, py, { dest: BF_A }), gg => { if (gg.pending!.kind === 'optional') { asked = true; return ['yes']; } return undefined; }).g;
  assert.ok(asked, 'additional cost offered');
  assert.equal(locOf(g, py), BF_A);
  assert.equal(g.objects[py].exhausted, false, 'readied');
  assert.equal(mightOf(g, py), 4, '+2');
});

test('RJ#10540 Ezreal, Prodigy reduces only the optional Repeat cost of Bellows Breath, not its base cost', () => {
  const paid = (ez: boolean, rep: boolean) => {
    let g = S0(); fundAll(g, P0); if (ez) put(g, P0, 'Ezreal, Prodigy', 'base');
    put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bellows Breath') });
    for (let i = 0; i < 6 && pend(g).inStep; i++) { const d = pend(g); g = choose(g, d.kind === 'optional' ? (rep ? 'yes' : 'no') : d.options![0].id); }
    return g.log.filter(l => /pays/.test(l.text)).map(l => l.text).join(' | ');
  };
  assert.equal(paid(true, false), paid(false, false), 'base cost unchanged');
  assert.equal(paid(false, true), 'P0 pays 2 M M');
  assert.equal(paid(true, true), 'P0 pays 1 M M', 'Repeat [1][C] reduced by [1]');
});

test('RJ#10542 Singularity on Hwei, Tideturner swaps him in response: Hwei\'s move trigger resolves first, then Singularity still kills him', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const hw = put(g, P0, 'Hwei, Brooding Painter', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  const tt = put(g, P0, 'Tideturner', { facedown: BF_B });
  for (let i = 0; i < 3; i++) put(g, P0, 'DrawR', 'deckTop'); // Hwei discards a spell (no +3)
  g = play(g, P1, hand(g, P1, 'Singularity'), { targets: [[hw]] });
  if (pend(g).player !== P0) g = pass(g);
  g = play(g, P0, tt, { dest: BF_B });
  const r = drive(g, gg => { const d = gg.pending!; if (d.kind === 'optional') return ['yes']; if (d.kind === 'chooseTargets' && d.options!.some(o => o.id === hw)) return [hw]; return undefined; });
  const L = logText(r.g);
  assert.ok(L.indexOf('Resolving Hwei') >= 0 && L.indexOf('Resolving Hwei') < L.lastIndexOf('Resolving Singularity'), 'Hwei\'s trigger before Singularity');
  assert.ok(/Hwei moves to BF-B/.test(L), 'Hwei was moved');
  assert.equal(zone(r.g, hw), 'trash', 'Singularity still hit him (no location requirement)');
});

test('RJ#10544 Diana, Lunari (showdown begins) vs Kha\'Zix, Evolving Hunter (attack): Kha\'Zix\'s trigger is on top and kills Diana before her draw resolves', () => {
  const g0 = S0(); fundAll(g0, P1); g0.players[P0].xp = 3;
  const di = put(g0, P1, 'Diana, Lunari', BF_A); control(g0, BF_A, P1);
  const kz = put(g0, P0, 'Kha\'Zix, Evolving Hunter', 'base');
  let g = move(g0, P0, [kz], BF_A);
  for (let i = 0; i < 10 && g.chain.length < 2; i++) { const d = pend(g); g = d.inStep ? (d.kind === 'optional' ? yes(g) : choose(g, d.options!.some(o => o.id === di) ? di : d.options![0].id)) : pass(g); }
  const labels = g.chain.map(c => String(c.label));
  assert.ok(labels.length >= 2 && /Diana/.test(labels[0]) && /Kha/.test(labels.at(-1)!), labels.join(' | '));
  for (let i = 0; i < 10 && g.chain.some(c => /Kha/.test(String(c.label))); i++) { const d = pend(g); g = d.inStep ? (d.kind === 'optional' ? yes(g) : choose(g, d.options!.some(o => o.id === di) ? di : d.options![0].id)) : pass(g); }
  assert.equal(zone(g, di), 'trash', 'Diana died while her trigger was still pending');
});

test('RJ#10546 Switcheroo loses one of its two units to Gust: the swap can\'t happen, the other unit keeps its Might', () => {
  const g0 = S0(); fundAll(g0, P0); fundAll(g0, P1);
  const f = put(g0, P0, 'V(2)', BF_A); const e = put(g0, P1, 'V(6)', BF_A);
  const gust = hand(g0, P1, 'Gust');
  let g = play(g0, P0, hand(g0, P0, 'Switcheroo'), { targets: [[f, e], [e]] });
  assert.deepEqual([...g.chain[0].targets.flat()].sort(), [e, f].sort(), 'both units chosen');
  if (pend(g).player !== P1) g = pass(g);
  g = play(g, P1, gust, { targets: [[f]] });
  g = drive(g, gg => gg.pending!.kind === 'assignDamage' ? undefined : undefined, 6).g;
  assert.equal(zone(g, f), 'hand');
  assert.equal(mightOf(g, e), 6, 'no reduced Might');
});

test('RJ#10548 Bard, Mercurial played while an enemy Vex, Apathetic is at a battlefield: Vex stuns him wherever he was played, so he can\'t move; other units can', () => {
  const g0 = S0(); fundAll(g0, P0);
  put(g0, P1, 'Vex, Apathetic', BF_A); control(g0, BF_A, P1);
  const other = put(g0, P0, 'V(2)', 'base');
  const bard = hand(g0, P0, 'Bard, Mercurial');
  const g = drive(play(g0, P0, bard, { dest: 'base' }), gg => {
    const d = gg.pending!;
    if (d.kind === 'optional') return ['yes'];
    if (d.kind === 'chooseTargets' || d.kind === 'chooseCards') return d.options!.filter(o => o.id === other || o.id === bard).map(o => o.id);
    if (d.kind === 'chooseBattlefield' || d.kind === 'chooseDestination') return [String(BF_B)];
    return undefined;
  }).g;
  assert.ok(g.objects[bard].stunned, 'Bard stunned');
  assert.equal(locOf(g, bard), 'base', 'Bard did not move');
  assert.equal(locOf(g, other), BF_B, 'the other unit moved to the open battlefield');
});

test('RJ#10550 A spell played once with Repeat counts as one card played for Battering Ram', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const ram = hand(g, P0, 'Battering Ram');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bellows Breath') });
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const d = pend(g); g = choose(g, d.kind === 'optional' ? 'yes' : d.options![0].id); }
  g = drive(g).g;
  assert.equal(playCostOf(g, P0, ram)?.energy, 4, '5 - 1 card played');
});

test('RJ#10551 Vi, Peacekeeper ambushed into an attack on Vex, Apathetic: Vex stuns Vi, but Vi\'s attack trigger still stuns Vex', () => {
  const g0 = S0(); fundAll(g0, P0);
  const vex = put(g0, P1, 'Vex, Apathetic', BF_A); control(g0, BF_A, P1);
  const a = put(g0, P0, 'V(1)', 'base');
  const vi = hand(g0, P0, 'Vi, Peacekeeper');
  let g = move(g0, P0, [a], BF_A);
  g = play(g, P0, vi, { dest: BF_A });
  for (let i = 0; i < 30; i++) { const d = pend(g); if (d.kind === 'mainAction' || d.kind === 'assignDamage' || (g.chain.length === 0 && g.objects[vex].stunned && d.kind === 'showdownAction')) break; g = d.inStep ? choose(g, d.options!.some(o => o.id === vex) ? vex : d.options![0].id) : pass(g); }
  assert.ok(g.objects[vi].stunned, 'Vex stunned Vi');
  assert.ok(g.objects[vex].stunned, 'Vi stunned Vex');
});

test('RJ#10552 Defending Kayn moved away and back with two Ride the Winds: he has moved twice and takes no damage; the defender keeps control', () => {
  const g0 = S0({ tp: P1 }); fundAll(g0, P0);
  const k = put(g0, P0, 'Kayn, Unleashed', BF_A); control(g0, BF_A, P0);
  const a = put(g0, P1, 'V(8)', 'base');
  const r1 = hand(g0, P0, 'Ride the Wind'), r2 = hand(g0, P0, 'Ride the Wind');
  let g = move(g0, P1, [a], BF_A);
  const rtw = (h: GameState, card: ObjId, to: 'base' | number) => {
    for (let i = 0; i < 4 && pend(h).player !== P0; i++) h = pass(h);
    h = play(h, P0, card, { targets: [[k]] });
    for (let i = 0; i < 8 && h.chain.length; i++) h = pend(h).kind === 'chooseDestination' ? choose(h, String(to)) : pend(h).inStep ? choose(h, pend(h).options![0].id) : pass(h);
    return h;
  };
  g = rtw(g, r1, 'base'); assert.equal(locOf(g, k), 'base');
  g = rtw(g, r2, BF_A); assert.equal(locOf(g, k), BF_A);
  g = drive(g).g;
  assert.equal(zone(g, k), 'battlefield', 'Kayn took no damage');
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#10553 Two Karthus, Eternal: a Ruined Rex killed by Sacrifice gives three separate Deathknell triggers', () => {
  const g0 = S0(); fundAll(g0, P0);
  put(g0, P0, 'Karthus, Eternal', 'base'); put(g0, P0, 'Karthus, Eternal', 'base');
  const rex = put(g0, P0, 'Ruined Rex', 'base');
  for (let i = 0; i < 3; i++) put(g0, P1, 'V(9)', 'base');
  let g = act(g0, { type: 'playCard', player: P0, obj: hand(g0, P0, 'Sacrifice') });
  g = drive(g, gg => gg.pending!.kind === 'chooseTargets' ? [gg.pending!.options![0].id] : undefined).g;
  assert.equal(zone(g, rex), 'trash');
  assert.equal((logText(g).match(/Resolving Ruined Rex/g) ?? []).length, 3);
});

test('RJ#10554 Mirror Image can copy a Sprite token (a unit); the Reflection has Temporary', () => {
  const g0 = S0(); fundAll(g0, P0); tokens(g0, 'Reflection', 'Sprite');
  const sp = put(g0, P0, 'Sprite', 'base', { token: true });
  const before = new Set(Object.keys(g0.objects));
  const g = drive(play(g0, P0, hand(g0, P0, 'Mirror Image'), { targets: [[sp]] })).g;
  const r = g.players[P0].base.find(id => !before.has(id) && g.objects[id].isToken);
  assert.ok(r, 'Reflection created');
  assert.equal(mightOf(g, r!), 3);
  assert.ok(hasKeyword(g, r!, 'Temporary'));
});

test('RJ#10556 Rengar ambushing in as the lone Defender with Wuju Bladesman as legend gets +2 Might', () => {
  const g0 = S0(); fundAll(g0, P1); setLegend(g0, P1, 'Wuju Bladesman, Starter');
  const a = put(g0, P0, 'V(2)', 'base');
  const r = hand(g0, P1, 'Rengar, Trophy Hunter');
  let g = pass(move(g0, P0, [a], BF_A));
  g = resolveChain(play(g, P1, r, { dest: BF_A }));
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = choose(g, pend(g).options![0].id);
  assert.equal(g.objects[r].combatRole, 'defender');
  assert.equal(mightOf(g, r), 8, '6 + 2 while defending alone');
});

test('RJ#10558 Blood Rush with Repeat choosing Jae Medarda both times: Jae\'s "when you choose me with a spell" draws twice', () => {
  const g0 = S0(); fundAll(g0, P0);
  const jae = put(g0, P0, 'Jae Medarda', 'base');
  const h0 = g0.players[P0].hand.length;
  let g = act(g0, { type: 'playCard', player: P0, obj: hand(g0, P0, 'Blood Rush') });
  g = drive(g, gg => { const d = gg.pending!; if (d.kind === 'optional' && /Repeat/i.test(d.prompt)) return ['yes']; if (d.kind === 'chooseTargets' && d.options!.some(o => o.id === jae)) return [jae]; return undefined; }).g;
  assert.equal(g.players[P0].hand.length, h0 + 2, 'drew twice');
});

test('RJ#10559 Sacred Shears: the equipped unit has "Deathknell — Draw 1"; an equipped Karthus dying draws 2', () => {
  const g0 = S0({ tp: P1 }); fundAll(g0, P1);
  const k = put(g0, P0, 'Karthus, Eternal', BF_A); control(g0, BF_A, P0);
  attachNow(g0, put(g0, P0, 'Sacred Shears', 'base'), k);
  const h0 = g0.players[P0].hand.length;
  const g = drive(play(g0, P1, hand(g0, P1, 'Hidden Blade'), { targets: [[k]] })).g;
  assert.equal(zone(g, k), 'trash');
  assert.equal(g.players[P0].hand.length, h0 + 2 + 2, 'Hidden Blade\'s 2 + Shears Deathknell twice');
});

test('RJ#10560 Hand of Noxus (Darius legend): its [Legion] Add [1] works only after you have played another card this turn', () => {
  let g = S0(); fundAll(g, P0);
  const l = setLegend(g, P0, 'Hand of Noxus');
  const usable = (h: GameState) => legal(h, P0, 'activate').some(a => a.type === 'activate' && a.obj === l);
  assert.ok(!usable(g), 'no card played yet');
  g = drive(play(g, P0, hand(g, P0, 'DrawR'))).g;
  assert.ok(usable(g), 'after playing a card');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === l)!);
  assert.equal(g.players[P0].pool.energy, 1);
});

test('RJ#10561 Playing a card from Hidden counts for Legion; hiding a card does not', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const l = setLegend(g, P0, 'Hand of Noxus');
  const usable = (h: GameState) => legal(h, P0, 'activate').some(a => a.type === 'activate' && a.obj === l);
  const c = hand(g, P0, 'HidZap');
  const hd = legal(g, P0, 'hide').find(a => a.type === 'hide' && a.obj === c)!;
  g = act(g, hd);
  assert.ok(!usable(g), 'hiding is not playing');
  const fd = put(g, P0, 'HidZap', { facedown: BF_A });
  const e = put(g, P1, 'V(5)', BF_A);
  g = drive(play(g, P0, fd, { targets: [[e]] })).g;
  assert.ok(usable(g), 'played from Hidden: Legion satisfied');
});

test('RJ#10564 After playing a Reaction you keep priority and may play another before passing', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const a = hand(g, P0, 'DrawR'), b = hand(g, P0, 'DrawR');
  g = pass(play(g, P1, hand(g, P1, 'DrawR')));
  g = play(g, P0, a);
  assert.equal(pend(g).player, P0, 'P0 still has priority');
  assert.ok(canPlayNow(g, P0, b));
  g = play(g, P0, b);
  assert.equal(g.chain.length, 3);
  assert.equal(g.chain.at(-1)!.source, b, 'last in resolves first');
});

test('RJ#10565 Hidden card vs my unit leaving its battlefield: playable in response to a spell that moves it, but a Standard Move gives no window', () => {
  // spell move: respond while it is on the chain
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const fd = put(g, P0, 'HidZap', { facedown: BF_A });
  g = play(g, P0, hand(g, P0, 'MoveR'), { targets: [[u]] });
  assert.ok(g.chain.length > 0 && canPlayNow(g, P0, fd), 'hidden card playable while the move spell is pending');
  // standard move: no window, the hidden card is trashed once control is lost
  let h = S0();
  const v = put(h, P0, 'V(2)', BF_A); control(h, BF_A, P0);
  const fd2 = put(h, P0, 'HidZap', { facedown: BF_A });
  h = drive(move(h, P0, [v], 'base')).g;
  assert.equal(zone(h, fd2), 'trash');
});

test('RJ#10566 Relentless Pursuit resolves without a window between the move and the attach (Gust can\'t be slotted in)', () => {
  const g0 = S0(); fundAll(g0, P0); fundAll(g0, P1);
  const u = put(g0, P0, 'V(2)', 'base');
  const tf = put(g0, P0, 'Trinity Force', 'base');
  hand(g0, P1, 'Gust');
  const step = (h: GameState) => { const d = pend(h); return d.kind === 'chooseDestination' ? choose(h, String(BF_A)) : d.kind === 'optional' ? yes(h) : choose(h, d.options!.some(o => o.id === u) ? u : d.options!.some(o => o.id === tf) ? tf : d.options![0].id); };
  let g = act(g0, { type: 'playCard', player: P0, obj: hand(g0, P0, 'Relentless Pursuit') });
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = step(g);
  assert.equal(g.chain.length, 1);
  g = pass(pass(g));
  const seen: string[] = [];
  for (let i = 0; i < 10 && pend(g).inStep; i++) { seen.push(`${pend(g).kind}:P${pend(g).player}`); g = step(g); }
  assert.ok(seen.every(s => s.endsWith('P0')), `only P0's in-resolution choices (${seen})`);
  assert.equal(locOf(g, u), BF_A);
  assert.equal(g.objects[tf].attachedTo, u, 'attached in the same resolution');
});

test('RJ#10567 A stunned Teemo, Strategist still deals his defend-trigger damage (stun only removes combat Might)', () => {
  const g0 = S0();
  const t = put(g0, P1, 'Teemo, Strategist', BF_A, { stunned: true }); control(g0, BF_A, P1);
  for (let i = 0; i < 5; i++) put(g0, P1, 'HidU(1)', 'deckTop');
  const a = put(g0, P0, 'V(3)', 'base');
  const g = drive(move(g0, P0, [a], BF_A)).g;
  assert.equal(zone(g, a), 'trash', 'Teemo dealt 5');
  assert.equal(zone(g, t), 'battlefield');
});

test('RJ#10568 Weaponmaster trigger can be answered by Gust; returned to hand, the attach does nothing', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const tf = put(g, P0, 'Forgefire Cape', 'base');
  const lu = hand(g, P0, 'Lucian, Merciless'); const gust = hand(g, P1, 'Gust');
  g = play(g, P0, lu, { dest: BF_A });
  for (let i = 0; i < 4 && !g.chain.some(c => /Weaponmaster/.test(String(c.label))); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.ok(g.chain.some(c => /Weaponmaster/.test(String(c.label))), 'Weaponmaster trigger on the chain');
  if (pend(g).player !== P1) g = pass(g);
  g = drive(play(g, P1, gust, { targets: [[lu]] })).g;
  assert.equal(zone(g, lu), 'hand');
  assert.ok(!g.objects[tf].attachedTo, 'nothing attached');
});

test('RJ#10570 Rek\'Sai, Breacher grants Accelerate to a unit played from the Champion Zone; it enters ready only if Accelerate is paid', () => {
  const run = (pay: boolean) => {
    const g = S0(); fundAll(g, P0);
    put(g, P0, 'Rek\'Sai, Breacher', 'base');
    const cz = g.players[P0].championZone[0];
    const d = realCard('Rumble, Hotheaded'); g.cards = { ...g.cards, [d.id]: d }; g.objects[cz].cardId = d.id; g.timestamp++;
    let asked = false;
    const r = drive(play(g, P0, cz, { dest: 'base' }), gg => { if (gg.pending!.kind === 'optional' && /Accelerate/i.test(gg.pending!.prompt)) { asked = true; return [pay ? 'yes' : 'no']; } return undefined; }).g;
    assert.ok(asked, 'Accelerate offered');
    return r.objects[cz].exhausted;
  };
  assert.equal(run(true), false, 'paid: ready');
  assert.equal(run(false), true, 'not paid: exhausted');
});

test('RJ#10571 "When I move" triggers resolve before the showdown begins, so attack/defend triggers come afterwards', () => {
  const g0 = S0();
  put(g0, P1, 'Overzealous Fan', BF_A); control(g0, BF_A, P1);
  const h = put(g0, P0, 'Stellacorn Herder', 'base');
  const r = drive(move(g0, P0, [h], BF_A), gg => gg.pending!.kind === 'optional' ? ['no'] : undefined);
  const L = logText(r.g);
  const iMove = L.indexOf('Resolving Stellacorn'), iDef = r.seen.findIndex(s => /Overzealous|Kill Overzealous/i.test(s));
  assert.ok(iMove >= 0, 'move trigger resolved');
  const iMoveSeen = r.seen.findIndex(s => /chainResponse/.test(s));
  assert.ok(iDef > iMoveSeen, `defend trigger offered only after the move trigger (${r.seen.join(' | ')})`);
  assert.ok(L.indexOf('Combat at') > iMove, 'the combat showdown starts after the move trigger resolved');
});

test('RJ#10572 Bellows Breath + Repeat with Rabadon\'s Deathcrown: each execution deals 1 + 3 bonus (8 total to a unit hit twice)', () => {
  const g0 = S0(); fundAll(g0, P0);
  const w = put(g0, P0, 'V(1)', 'base'); attachNow(g0, put(g0, P0, 'Rabadon\'s Deathcrown', 'base'), w);
  const e = put(g0, P1, 'V(12)', BF_A); control(g0, BF_A, P1);
  let g = act(g0, { type: 'playCard', player: P0, obj: hand(g0, P0, 'Bellows Breath') });
  g = drive(g, gg => { const d = gg.pending!; if (d.kind === 'optional') return ['yes']; if (d.kind === 'chooseTargets' || d.kind === 'chooseCards') return d.options!.some(o => o.id === e) ? [e] : []; if (d.kind === 'chooseBattlefield' || d.kind === 'chooseDestination') return [String(BF_A)]; return undefined; }).g;
  assert.equal(g.objects[e].damage, 8);
});

test('RJ#10573 Beast Below\'s play trigger chooses its units when it goes on the chain; Cull the Weak chooses on resolution', () => {
  const g0 = S0(); fundAll(g0, P0);
  const f = put(g0, P0, 'V(1)', 'base'); const e = put(g0, P1, 'V(2)', 'base');
  let g = play(g0, P0, hand(g0, P0, 'Beast Below'));
  for (let i = 0; i < 6 && !g.chain.some(c => /Beast/.test(String(c.label))); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  const item = g.chain.find(c => /Beast/.test(String(c.label)))!;
  assert.deepEqual([...item.targets.flat()].sort(), [e, f].sort(), 'targets locked in on the chain');
  // Cull the Weak: no choice while it is on the chain
  const h0 = S0(); fundAll(h0, P0); put(h0, P0, 'V(1)', 'base'); put(h0, P1, 'V(2)', 'base');
  const h = act(h0, { type: 'playCard', player: P0, obj: hand(h0, P0, 'Cull the Weak') });
  assert.equal(h.chain[0].targets.flat().length, 0, 'Cull the Weak has no targets');
});

test('RJ#10574 Lady of Luminosity checks the spell\'s cost (4), not the Repeat payment: Rocket Barrage + Repeat draws nothing', () => {
  const g0 = S0(); fundAll(g0, P0, 6); setLegend(g0, P0, 'Lady of Luminosity, Starter');
  const e = put(g0, P1, 'V(9)', 'base');
  const h0 = g0.players[P0].hand.length;
  let g = act(g0, { type: 'playCard', player: P0, obj: hand(g0, P0, 'Rocket Barrage') });
  g = drive(g, gg => { const d = gg.pending!; if (d.kind === 'optional') return ['yes']; if (d.kind === 'chooseMode') return [d.options![0].id]; if (d.kind === 'chooseTargets') return d.options!.some(o => o.id === e) ? [e] : undefined; return undefined; }).g;
  assert.equal(g.objects[e].damage, 8, 'Repeat paid (4 + 4)');
  assert.equal(g.players[P0].hand.length, h0, 'no draw');
});

test('RJ#10575 Darius, Trifarian played as the third card (via Void Burrower) gets no "second card" bonus', () => {
  let g = S0(); fundAll(g, P0); setLegend(g, P0, 'Void Burrower');
  for (let i = 0; i < 2; i++) g = drive(play(g, P0, hand(g, P0, 'DrawR'))).g;
  const u = put(g, P0, 'V(2)', 'base');
  const d = put(g, P0, 'Darius, Trifarian', 'deckTop');
  g = drive(move(g, P0, [u], BF_A), gg => gg.pending!.kind === 'chooseCards' && gg.pending!.options!.some(o => o.id === d) ? [d] : undefined).g;
  assert.ok(['base', 'battlefield'].includes(zone(g, d)), 'Darius played');
  assert.equal(mightOf(g, d), 5, 'no +2');
});

test('RJ#10576 Star-Crossed returns Akshan in response to his play trigger: the "until I leave the board" control has already ended, so the gear is not kept', () => {
  const g0 = S0(); fundAll(g0, P0); fundAll(g0, P1);
  const gear = put(g0, P1, 'Baited Hook', 'base');
  const mine = put(g0, P1, 'V(1)', 'base');
  const sc = hand(g0, P1, 'Star-Crossed');
  const ak = hand(g0, P0, 'Akshan, Mischievous');
  let g = act(g0, { type: 'playCard', player: P0, obj: ak, destination: 'base' });
  const trig = () => g.chain.some(c => /enemy gear/.test(String(c.label)));
  for (let i = 0; i < 8 && !(trig() && !pend(g).inStep); i++) { const d = pend(g); g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : d.options!.some(o => o.id === gear) ? gear : d.options![0].id) : pass(g); }
  assert.ok(trig(), 'play trigger on the chain: ' + g.chain.map(c => c.label));
  if (pend(g).player !== P1) g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: sc });
  for (let i = 0; i < 4 && pend(g).inStep; i++) { const d = pend(g); g = choose(g, d.options!.some(o => o.id === mine) ? mine : ak); }
  g = drive(g, gg => gg.pending!.options?.some(o => o.id === gear) ? [gear] : undefined).g;
  assert.equal(zone(g, ak), 'hand');
  assert.equal(g.objects[gear].controller, P1, 'P1 still controls the gear');
});

test('RJ#10577 Thousand-Tailed Watcher takes a 2-Might unit to 1 (a -1); Wuju Bladesman\'s +2 then makes it 3', () => {
  const g0 = S0(); fundAll(g0, P0); setLegend(g0, P1, 'Wuju Bladesman, Starter');
  const d = put(g0, P1, 'V(2)', BF_A); control(g0, BF_A, P1);
  let g = drive(play(g0, P0, hand(g0, P0, 'Thousand-Tailed Watcher'), { may: [false] }), gg => gg.pending!.kind === 'optional' ? ['no'] : undefined).g;
  assert.equal(mightOf(g, d), 1);
  g = move(g, P0, [put(g, P0, 'V(5)', 'base')], BF_A);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, pend(g).options![0].id);
  assert.equal(g.objects[d].combatRole, 'defender');
  assert.equal(mightOf(g, d), 3);
});

test('RJ#10578 Attacker/Defender designations end when the combat ends', () => {
  let { g, def } = attackSetup(['V(1)'], ['V(5)']);
  g = drive(g).g;
  assert.equal(zone(g, def[0]), 'battlefield');
  assert.ok(!g.objects[def[0]].combatRole, 'no longer a defender');
});

test('RJ#10579 Blade Dancer readies Irelia, Fervent when En Garde chooses her mid-showdown', () => {
  const g0 = S0({ tp: P1 }); fundAll(g0, P0);
  const ir = put(g0, P0, 'Irelia, Fervent', BF_A, { ready: false }); control(g0, BF_A, P0);
  setLegend(g0, P0, 'Blade Dancer');
  const eg = hand(g0, P0, 'En Garde');
  let g = move(g0, P1, [put(g0, P1, 'V(1)', 'base')], BF_A);
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  g = play(g, P0, eg, { targets: [[ir]] });
  g = drive(g, gg => { const d = gg.pending!; if (d.kind === 'optional') return ['yes']; return undefined; }, 12).g;
  assert.equal(g.objects[ir].exhausted, false, 'readied by Blade Dancer');
});

test('RJ#10580 Shield is already active when Lucian, Gunslinger\'s attack trigger deals damage', () => {
  const g0 = S0();
  const d = put(g0, P1, 'Shield(1,1)', BF_A); control(g0, BF_A, P1);
  const lu = put(g0, P0, 'Lucian, Gunslinger', 'base');
  let g = move(g0, P0, [lu], BF_A);
  assert.equal(mightOf(g, d), 2, 'Shield +1 while defending');
  for (let i = 0; i < 8 && g.objects[d].damage === 0 && pend(g).kind !== 'assignDamage'; i++) g = pend(g).inStep ? choose(g, pend(g).options!.some(o => o.id === d) ? d : pend(g).options![0].id) : pass(g);
  assert.equal(g.objects[d].damage, 1, 'Lucian dealt 1');
  assert.equal(zone(g, d), 'battlefield', 'not lethal against 2 Might');
});

test('RJ#10581 Charm an enemy into my battlefield, then Ambush Vi, Peacekeeper: the enemy is the attacker, Vi is a defender, so her "When I attack" stun does not trigger', () => {
  const g0 = S0(); fundAll(g0, P0);
  put(g0, P0, 'V(3)', BF_A); control(g0, BF_A, P0);
  const e = put(g0, P1, 'V(2)', 'base');
  const vi = hand(g0, P0, 'Vi, Peacekeeper');
  let g = play(g0, P0, hand(g0, P0, 'Charm'), { targets: [[e]] });
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? answer(g, { locations: [BF_A] }) : pass(g);
  assert.equal(g.showdown?.attacker, P1);
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, vi, { dest: BF_A });
  for (let i = 0; i < 12; i++) { const d = pend(g); if (d.kind === 'assignDamage' || d.kind === 'mainAction') break; g = d.inStep ? choose(g, d.options![0].id) : pass(g); }
  assert.equal(g.objects[vi].combatRole, 'defender');
  assert.ok(!g.objects[e]?.stunned, 'no attack trigger, no stun');
});

test('RJ#10583 Amateur Recital (held by me) cannot choose an enemy Baron Nashor', () => {
  const g0 = S0({ tp: P1 }); setBattlefieldCard(g0, BF_A, 'Amateur Recital');
  put(g0, P0, 'V(2)', BF_A); control(g0, BF_A, P0);
  const b = put(g0, P1, 'Baron Nashor', BF_B); control(g0, BF_B, P1);
  let offered = false;
  const g = drive(endTurn(g0, P1), gg => { if (gg.pending!.options?.some(o => o.id === b)) offered = true; return undefined; }).g;
  assert.ok(!offered, 'Baron not choosable');
  assert.equal(locOf(g, b), BF_B);
});

test('RJ#10584 Showstopper moves one unit; no other unit can join that attack (no Standard Move during the showdown)', () => {
  const g0 = S0(); fundAll(g0, P0);
  put(g0, P1, 'V(5)', BF_A); control(g0, BF_A, P1);
  const u = put(g0, P0, 'V(2)', 'base'); const other = put(g0, P0, 'V(3)', 'base');
  let g = play(g0, P0, hand(g0, P0, 'Showstopper, Sett'), { targets: [[u]] });
  for (let i = 0; i < 8 && g.chain.length; i++) g = pend(g).inStep ? answer(g, { locations: [BF_A], battlefields: [BF_A] }) : pass(g);
  assert.equal(locOf(g, u), BF_A);
  assert.ok(g.showdown?.isCombat);
  assert.ok(!legal(g, P0, 'move').some(a => a.type === 'move' && a.units.includes(other)), 'the other unit cannot join');
});

test('RJ#10585 Pridestalker + Kinkou Initiate: order Kinkou\'s trigger first so Pridestalker\'s +1 (on Kai\'Sa, 4→5) resolves before it and it draws', () => {
  const g0 = S0(); fundAll(g0, P0); setLegend(g0, P0, 'Pridestalker');
  const ks = put(g0, P0, 'Kai\'Sa, Survivor', 'base');
  const h0 = g0.players[P0].hand.length;
  const g = drive(play(g0, P0, hand(g0, P0, 'Kinkou Initiate')), gg => {
    const d = gg.pending!;
    if (d.kind === 'orderTriggers') { const k = d.options!.find(o => /Kinkou/.test(o.label)); return k ? [k.id] : undefined; }
    if (d.kind === 'chooseTargets' && d.options!.some(o => o.id === ks)) return [ks];
    return undefined;
  }).g;
  assert.equal(mightOf(g, ks), 5);
  assert.equal(g.players[P0].hand.length, h0 + 1, 'drew 1');
});

test('RJ#10587 Baited Hook whose unit is Star-Crossed away in response: nothing was killed, so no unit can be played', () => {
  const g0 = S0(); fundAll(g0, P0); fundAll(g0, P1);
  const v = put(g0, P0, 'V(3)', 'base');
  const mine = put(g0, P1, 'V(1)', 'base');
  const hook = put(g0, P0, 'Baited Hook', 'base');
  const top = put(g0, P0, 'V(1)', 'deckTop');
  const sc = hand(g0, P1, 'Star-Crossed');
  let g = act(g0, { type: 'activate', player: P0, obj: hook, abilityIndex: 0 });
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, v);
  g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: sc });
  for (let i = 0; i < 4 && pend(g).inStep; i++) { const d = pend(g); g = choose(g, d.options!.some(o => o.id === mine) ? mine : v); }
  let offered = false;
  g = drive(g, gg => { if (gg.pending!.options?.some(o => o.id === top) && gg.pending!.kind === 'chooseCards' && /play/i.test(gg.pending!.prompt)) offered = true; return undefined; }).g;
  assert.equal(zone(g, v), 'hand');
  assert.ok(!offered && !['base', 'battlefield'].includes(zone(g, top)), 'no unit played from the deck');
});

test('RJ#10588 Thousand-Tailed Watcher applies once on resolution: later bonuses stack on the reduced value; units arriving later are unaffected', () => {
  const g0 = S0(); fundAll(g0, P0);
  const e = put(g0, P1, 'V(5)', 'base');
  let g = drive(play(g0, P0, hand(g0, P0, 'Thousand-Tailed Watcher'), { may: [false] }), gg => gg.pending!.kind === 'optional' ? ['no'] : undefined).g;
  assert.equal(mightOf(g, e), 2);
  mod(g, e, { might: 2 });
  assert.equal(mightOf(g, e), 4, 'later +2 on top of the reduced value');
  const late = put(g, P1, 'V(5)', 'base');
  assert.equal(mightOf(g, late), 5, 'units arriving later are unaffected');
});

test('RJ#10590 A stunned attacker of a conquering group is not recalled (recall only happens if defenders remain)', () => {
  let { g, atk, def } = attackSetup(['V(4)', 'V(5)'], ['V(3)'], { atkOpts: [{}, { stunned: true }] });
  g = drive(g).g;
  assert.equal(zone(g, def[0]), 'trash');
  assert.equal(locOf(g, atk[1]), BF_A, 'stunned attacker stays');
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#10593 Arcane Shift in combat at Forbidding Waste: the lone 5-Might defender has 3 Might, so 3 damage kills it (even with the friendly unit replayed to base)', () => {
  const g0 = S0(); fundAll(g0, P0); setBattlefieldCard(g0, BF_A, 'Forbidding Waste');
  const e = put(g0, P1, 'V(5)', BF_A); control(g0, BF_A, P1);
  const a = put(g0, P0, 'V(2)', 'base');
  const as = hand(g0, P0, 'Arcane Shift');
  let g = move(g0, P0, [a], BF_A);
  for (let i = 0; i < 8 && !canPlayNow(g, P0, as); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, e), 3, 'defending alone: -2');
  g = play(g, P0, as, { targets: [[a], [e]] });
  g = drive(g, gg => { const o = optionIds(gg); return o.includes('base') ? ['base'] : undefined; }).g;
  assert.equal(zone(g, e), 'trash', 'the defender died');
});

test('RJ#10594 Baron Nashor dies: the Baron Pit battlefield token stays on the board, and units can still move there', () => {
  let g = S0();
  setRunes(g, P0, 0); addRunes(g, P0, 7, 'chaos'); addRunes(g, P0, 8, 'fury');
  tokens(g, 'Baron Pit');
  const bn = hand(g, P0, 'Baron Nashor');
  const other = put(g, P0, 'V(2)', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: bn }), gg => { const o = gg.pending!.options?.find(x => /Baron/.test(x.label)); return o ? [o.id] : undefined; }).g;
  const pit = g.battlefields.findIndex(b => g.cards[g.objects[b.objId].cardId].name === 'Baron Pit');
  assert.ok(pit >= 0 && locOf(g, bn) === pit, 'Baron entered the Baron Pit');
  fundAll(g, P0);
  g = play(g, P0, hand(g, P0, 'Cull the Weak'));
  g = drive(g, gg => gg.pending!.options?.some(o => o.id === bn) ? [bn] : undefined).g;
  assert.equal(zone(g, bn), 'trash', 'Baron died');
  assert.ok(g.battlefields.some(b => g.cards[g.objects[b.objId].cardId].name === 'Baron Pit'), 'Baron Pit still on the board');
  const pit2 = g.battlefields.findIndex(b => g.cards[g.objects[b.objId].cardId].name === 'Baron Pit');
  assert.ok(legal(g, P0, 'move').some(a => a.type === 'move' && a.units.includes(other) && a.to === pit2), 'units can still move there');
});

test('RJ#10596 Frozen Fortress + Imperial Decree: the Decree has expired by the next Beginning Phase and can\'t be cast in response (Action), so units just take 1', () => {
  let g = S0(); fundAll(g, P0, 6); fundAll(g, P1, 6); setBattlefieldCard(g, BF_A, 'Frozen Fortress');
  const u = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const mine = put(g, P0, 'V(3)', BF_B); control(g, BF_B, P0);
  void mine;
  const d2 = hand(g, P0, 'Imperial Decree');
  g = passAll(play(g, P0, hand(g, P0, 'Imperial Decree')));
  g = endTurn(g, P0);
  let sawWindow = false;
  for (let i = 0; i < 40; i++) {
    const d = g.pending; if (!d || d.kind === 'mainAction') break;
    if (g.chain.some(c => /Frozen Fortress/.test(JSON.stringify(c))) && d.player === P0 && !d.inStep) { sawWindow = true; assert.ok(!canPlayNow(g, P0, d2), 'Imperial Decree (Action) cannot be cast on the Beginning-Phase chain'); }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : act(g, { type: 'pass', player: d.player });
  }
  assert.ok(sawWindow, 'Frozen Fortress trigger went on the chain');
  assert.equal(zone(g, u), 'battlefield', 'not killed by the expired Decree');
  assert.equal(g.objects[u].damage, 1);
});

test('RJ#10598 Unlicensed Armory (no Reaction): only in your open Main Phase — not during a showdown/combat, and not without a card to discard', () => {
  const ua = (g: GameState, id: ObjId) => legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === id);
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const arm = put(g, P0, 'Unlicensed Armory', 'base');
  const a = put(g, P0, 'V(3)', 'base');
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  assert.ok(!ua(g, arm), 'no card in hand to discard');
  hand(g, P0, 'V(1)');
  assert.ok(ua(g, arm), 'open Main Phase: may activate');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.showdown, 'in the combat showdown');
  assert.equal(pend(g).player, P0);
  assert.ok(!ua(g, arm), 'not during the combat showdown');
});

test('RJ#10599 Frozen Fortress kills a 1-Might unit of the battlefield\'s own controller at the start of the turn', () => {
  let g = S0(); setBattlefieldCard(g, BF_A, 'Frozen Fortress');
  const u = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  g = nextTurn(g);
  assert.equal(g.activePlayer, P1);
  assert.equal(zone(g, u), 'trash');
});

test('RJ#10600 Two Tanks of different Might: the attacker chooses which Tank to assign lethal damage to first', () => {
  let { g, def } = attackSetup(['V(4)'], ['Tank(5)', 'Tank(2)', 'V(1)']);
  for (let i = 0; i < 20 && pend(g).kind !== 'assignDamage'; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(pend(g).kind, 'assignDamage');
  const [big, small, v] = def;
  const ok = (a: Record<string, number>) => validateAction(g, { type: 'assignDamage', player: P0, assignment: a });
  assert.equal(ok({ [small]: 2, [big]: 2 }), null, 'smaller Tank first');
  assert.equal(ok({ [big]: 4 }), null, 'bigger Tank first');
  assert.notEqual(ok({ [small]: 2, [v]: 2 }), null, 'non-Tank only after every Tank has lethal');
});

test('RJ#10601 Ruined Rex attacks Shen (Shield 2) and is killed by Hidden Blade mid-showdown: Shen is still a Defender at 5 Might, so the 4-damage Deathknell does not kill him', () => {
  let { g, atk, def } = attackSetup(['Ruined Rex'], ['ogn-241-298'], { tp: P0 });
  fundAll(g, P1);
  const hb = hand(g, P1, 'Hidden Blade');
  for (let i = 0; i < 8 && !canPlayNow(g, P1, hb); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, def[0]), 5, 'Shen defending: Shield 2');
  g = play(g, P1, hb, { targets: [[atk[0]]] });
  let dealt = -1;
  g = drive(g, gg => { const o = optionIds(gg); return o.includes(def[0]) ? [def[0]] : undefined; }).g;
  for (const l of g.log) if (/Ruined Rex/.test(l.text) && /Deathknell|Deal 4/i.test(l.text)) dealt = 1;
  assert.equal(zone(g, atk[0]), 'trash', 'Rex died');
  assert.ok(dealt > 0, 'Rex\'s Deathknell resolved');
  assert.ok(g.log.some(l => /deals? 4/i.test(l.text)), `4 damage dealt (${logText(g).slice(-600)})`);
  assert.equal(zone(g, def[0]), 'battlefield', 'Shen survived (4 < 5)');
});

test('RJ#10603 Ivern, Friend to All loses the tag he gained as he was played once he goes to the trash', () => {
  let g = S0(); fundAll(g, P0, 12);
  const iv = hand(g, P0, 'unl-177-219');
  g = drive(play(g, P0, iv), gg => gg.pending!.options?.some(o => o.id === 'Poro') ? ['Poro'] : undefined).g;
  assert.ok(chars(g, iv).tags.includes('Poro'), 'Ivern gained the Poro tag');
  g = drive(play(g, P0, hand(g, P0, 'Cull the Weak')), gg => gg.pending!.options?.some(o => o.id === iv) ? [iv] : undefined).g;
  assert.equal(zone(g, iv), 'trash');
  assert.ok(!chars(g, iv).tags.includes('Poro'), 'tag gone in the trash');
});

test('RJ#10604 Atakhan: killing my only unit at a battlefield as the additional cost, I can still play Atakhan to that battlefield (control kept)', () => {
  let g = S0(); fundAll(g, P0, 12);
  const u = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const at = hand(g, P0, 'Atakhan');
  assert.ok(playDests(g, P0, at).includes(BF_A), 'BF-A is a legal destination');
  g = act(g, { type: 'playCard', player: P0, obj: at, destination: BF_A } as never);
  g = drive(g, gg => gg.pending!.kind === 'optional' ? ['yes'] : gg.pending!.options?.some(o => o.id === u) ? [u] : undefined).g;
  assert.equal(zone(g, u), 'trash', 'killed as the cost');
  assert.equal(locOf(g, at), BF_A, 'Atakhan entered BF-A');
  assert.equal(g.battlefields[BF_A].controller, P0, 'control kept');
});

test('RJ#10606 Jhin, Meticulous Killer: [2] paid for Hard Bargain is not spent "to play a spell": a 2-cost spell + 2 for Hard Bargain does not enable the [C] cost', () => {
  const jhinCost = (g: GameState, j: ObjId) => playOptions(g, P0).filter(o => o.obj === j).length;
  // control: one 4-energy spell enables the alternative cost
  let c = S0(); fundAll(c, P0, 12);
  const j0 = hand(c, P0, 'Jhin, Meticulous Killer');
  const before = jhinCost(c, j0);
  const e0 = put(c, P1, 'V(9)', BF_A); control(c, BF_A, P1);
  c = drive(play(c, P0, hand(c, P0, 'Siphoning Strike'), { targets: [[e0]] })).g;
  const enabled = jhinCost(c, j0);
  assert.equal(enabled, before + 1, `4 spent on one spell enables the [C] cost (${before} → ${enabled})`);
  // 2-cost spell + 2 paid to Hard Bargain
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1);
  const j = hand(g, P0, 'Jhin, Meticulous Killer');
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const hb = hand(g, P1, 'Hard Bargain');
  g = play(g, P0, hand(g, P0, 'KillA'), { targets: [[e]] });
  if (pend(g).player === P0) g = pass(g);
  g = play(g, P1, hb, { may: [false] });
  g = drive(g, gg => gg.pending!.player === P0 && gg.pending!.kind === 'optional' ? ['yes'] : gg.pending!.player === P1 && gg.pending!.kind === 'optional' ? ['no'] : undefined).g;
  assert.equal(zone(g, e), 'trash', 'paid for Hard Bargain: KillA resolved');
  assert.equal(jhinCost(g, j), before, 'Jhin\'s [C] cost not enabled');
});

test('RJ#10609 Vex, Cheerless in combat reduces the total cost including Deflect: KillA (2) on an enemy Deflect unit costs [1] energy and no power', () => {
  const paid = (deflect: boolean, vex: boolean) => {
    const g0 = S0(); fundAll(g0, P0);
    const t = put(g0, P1, deflect ? 'Deflect(2,1)' : 'V(2)', BF_A); control(g0, BF_A, P1);
    const a = [put(g0, P0, vex ? 'Vex, Cheerless' : 'V(5)', 'base')];
    const k = hand(g0, P0, 'KillA');
    let g = move(g0, P0, a, BF_A);
    for (let i = 0; i < 8 && !canPlayNow(g, P0, k); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
    const n = g.log.length;
    g = play(g, P0, k, { targets: [[t]] });
    assert.ok(g.chain.some(c => /KillA/.test(String(c.label))), 'KillA on the chain');
    return g.log.slice(n).filter(l => /^P0 pays/.test(l.text)).map(l => l.text).join('; ');
  };
  const base = paid(false, false), dfl = paid(true, false), vexDfl = paid(true, true);
  assert.deepEqual([base, dfl, vexDfl], ['P0 pays 2', 'P0 pays 2 A', 'P0 pays 1'], 'costs: 2 / 2+[A] Deflect / Vex: 1 energy, Deflect offset');
});

test('RJ#10610 Vex, Cheerless in combat: the opponent\'s hidden spell (base cost 0) costs [1][A]', () => {
  const g0 = S0({ tp: P0 }); fundAll(g0, P1);
  const d = put(g0, P1, 'V(2)', BF_A); control(g0, BF_A, P1);
  const hb = put(g0, P1, 'HiddenBladeLike', { facedown: BF_A });
  const vex = put(g0, P0, 'Vex, Cheerless', 'base');
  let g = move(g0, P0, [vex], BF_A);
  void d;
  for (let i = 0; i < 8 && pend(g).player !== P1; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.showdown?.isCombat && pend(g).player === P1);
  const n = g.log.length;
  g = play(g, P1, hb, { targets: [[vex]] });
  assert.ok(g.chain.some(c => /HiddenBlade/.test(String(c.label))), 'played from Hidden');
  assert.deepEqual(g.log.slice(n).filter(l => /^P1 pays/.test(l.text)).map(l => l.text), ['P1 pays 1 A']);
});

test('RJ#10611 Tideturner vs an enemy Vex, Apathetic: turn player\'s Tideturner is stunned first and can\'t swap; non-turn player\'s swap resolves first, then the stun', () => {
  // A: turn player (P0) plays Tideturner from hand to base; P1's Vex trigger goes on top (CR 383.3.d.1)
  {
    let g = S0(); fundAll(g, P0);
    put(g, P1, 'Vex, Apathetic', BF_A); control(g, BF_A, P1);
    const far = put(g, P0, 'V(2)', BF_B); control(g, BF_B, P0);
    const tt = hand(g, P0, 'Tideturner');
    g = act(g, { type: 'playCard', player: P0, obj: tt, destination: 'base' } as never);
    g = drive(g, gg => gg.pending!.kind === 'optional' ? ['yes'] : gg.pending!.options?.some(o => o.id === far) ? [far] : undefined).g;
    assert.ok(g.objects[tt].stunned, 'Tideturner stunned');
    assert.equal(locOf(g, tt), 'base', 'Tideturner can\'t move this turn');
    // RJ: "partial resolution could apply to the second, unrestricted unit": the engine still moves it (resolve as much as possible)
    assert.equal(locOf(g, far), 'base');
  }
  // B: non-turn player (P0) plays hidden Tideturner on P1's turn; its trigger is on top: swap, then stun
  {
    let g = S0({ tp: P1 }); fundAll(g, P0);
    put(g, P1, 'Vex, Apathetic', BF_B); control(g, BF_B, P1);
    control(g, BF_A, P0); put(g, P0, 'V(1)', BF_A);
    const home = put(g, P0, 'V(2)', 'base');
    const tt = put(g, P0, 'Tideturner', { facedown: BF_A });
    g = play(g, P1, hand(g, P1, 'DrawR'));
    if (pend(g).player !== P0) g = pass(g);
    g = act(g, { type: 'playCard', player: P0, obj: tt, destination: BF_A } as never);
    g = drive(g, gg => gg.pending!.kind === 'optional' ? ['yes'] : gg.pending!.options?.some(o => o.id === home) ? [home] : undefined).g;
    assert.equal(locOf(g, tt), 'base', 'swapped first');
    assert.equal(locOf(g, home), BF_A);
    assert.ok(g.objects[tt].stunned, 'then stunned');
  }
});

test('RJ#10612 Glasc Mixologist dying as an attacker: its Deathknell can\'t play the unit to the enemy battlefield (never controlled it)', () => {
  let { g, atk } = attackSetup(['Glasc Mixologist'], ['V(6)']);
  const v = put(g, P0, 'V(2)', 'trash');
  let dests: string[] | null = null;
  g = drive(g, gg => {
    const d = gg.pending!;
    if (d.kind === 'chooseCards' && d.options!.some(o => o.id === v)) return [v];
    if (d.kind === 'chooseDestination') { dests = d.options!.map(o => o.id); return [dests.includes('base') ? 'base' : dests[0]]; }
    return undefined;
  }, 60).g;
  assert.equal(zone(g, atk[0]), 'trash');
  assert.ok(['base', 'battlefield'].includes(zone(g, v)), 'Deathknell played the unit');
  assert.notEqual(locOf(g, v), BF_A, 'not to the enemy battlefield');
  if (dests) assert.ok(!(dests as string[]).includes(String(BF_A)), `BF-A not offered (${dests})`);
});

test('RJ#10613 Jhin, Meticulous Killer: 4 spent on a spell that Defy counters still enables his [C] cost', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1);
  const j = hand(g, P0, 'Jhin, Meticulous Killer');
  const n0 = playOptions(g, P0).filter(o => o.obj === j).length;
  const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const ss = hand(g, P0, 'Siphoning Strike');
  g = play(g, P0, ss, { targets: [[e]] });
  if (pend(g).player === P0) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Defy'), { targets: [[ss]] });
  g = drive(g).g;
  assert.equal(g.objects[e].damage, 0, 'countered');
  assert.equal(playOptions(g, P0).filter(o => o.obj === j).length, n0 + 1, 'Jhin\'s [C] cost available');
});

test('RJ#10614 At 7 points, killing the opponent\'s Draven, Audacious in combat: his "choose an opponent, they score 1" gives me the 8th point and I win (not a Hold/Conquer final point)', () => {
  let g = S0();
  g.players[P0].points = 7;
  put(g, P1, 'Draven, Audacious', BF_A); control(g, BF_A, P1);
  put(g, P0, 'Draven, Audacious', BF_B); control(g, BF_B, P0); // BF-B not scored this turn: a conquer could not be the final point
  const a = put(g, P0, 'V(9)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 60 && g.winner == null && g.pending && g.pending.kind !== 'mainAction'; i++) g = pend(g).inStep || pend(g).kind === 'assignDamage' ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(g.winner, P0, `P0 wins (log: ${g.log.slice(-6).map(l => l.text).join(' | ')})`);
});

test('RJ#10615 Zhonya\'s Hourglass in base, two of my defenders die to combat damage: I choose which one it saves (CR 373)', () => {
  let g = S0({ tp: P1 });
  const z = put(g, P0, "Zhonya's Hourglass", 'base');
  const a = put(g, P0, 'V(1)', BF_A), b = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const atk = put(g, P1, 'V(5)', 'base');
  g = move(g, P1, [atk], BF_A);
  let asked = false;
  for (let i = 0; i < 40; i++) {
    const d = g.pending!; if (d.kind === 'mainAction') break;
    if (d.kind === 'assignDamage') { g = act(g, legal(g, d.player)[0]); continue; }
    if (d.player === P0 && d.inStep && d.options!.some(o => o.id === b || o.objIds?.includes(b))) { asked = true; g = choose(g, d.options!.find(o => o.id === b || o.objIds?.includes(b))!.id); continue; }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.equal(zone(g, z), 'trash');
  assert.deepEqual([zone(g, a), zone(g, b)].sort(), ['base', 'trash'], 'exactly one saved');
  assert.ok(asked, 'P0 is asked which unit Zhonya\'s saves');
  assert.equal(zone(g, b), 'base');
});

test('RJ#10616 Rengar, Pouncing (Reaction, no Ambush) can\'t be played to an open battlefield where the opponent started a showdown (only to my base)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  const r = hand(g, P0, 'Rengar, Pouncing');
  const u = put(g, P1, 'V(2)', 'base');
  g = move(g, P1, [u], BF_A);
  for (let i = 0; i < 6 && pend(g).player !== P0; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.showdown && !g.showdown.isCombat, 'non-combat showdown at the open battlefield');
  assert.equal(pend(g).player, P0);
  const ds = playDests(g, P0, r);
  assert.ok(!ds.includes(BF_A), `not to BF-A (${ds})`);
  assert.ok(ds.includes('base'), 'base is fine (Reaction timing)');
});

test('RJ#10618 Vanguard Armory: playing it gives no reaction window (resolves immediately); its [T] ability goes on the chain and can be responded to', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1); tokens(g, 'Recruit');
  const va = hand(g, P0, 'Vanguard Armory');
  hand(g, P1, 'DrawR');
  g = play(g, P0, va);
  assert.equal(g.chain.length, 0, 'no chain item for the gear');
  assert.equal(zone(g, va), 'base');
  assert.equal(pend(g).kind, 'mainAction');
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === va)!;
  g = act(g, ab);
  assert.ok(g.chain.length > 0, 'ability on the chain');
  if (pend(g).player === P0) g = pass(g);
  assert.equal(pend(g).player, P1);
  assert.ok(legal(g, P1, 'playCard').length > 0, 'P1 may react');
});

test('RJ#10619 Mask of Foresight does not choose Irelia, Fervent attacking alone: Mask\'s +1 only, Irelia\'s "choose or ready me" does not trigger', () => {
  let g = S0();
  put(g, P0, 'Mask of Foresight', 'base');
  const ir = put(g, P0, 'Irelia, Fervent', 'base');
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [ir], BF_A);
  for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, ir), 5, '4 + 1 (Mask)');
  assert.ok(!/Trigger: Irelia/.test(logText(g)), 'Irelia did not trigger');
});

test('RJ#10620 A buffed unit saved by Zhonya\'s Hourglass keeps its buff (it never left the board)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const z = put(g, P0, "Zhonya's Hourglass", 'base');
  const u = put(g, P0, 'V(2)', BF_A, { buff: true }); control(g, BF_A, P0);
  g = play(g, P1, hand(g, P1, 'KillA'), { targets: [[u]] });
  g = drive(g).g;
  assert.equal(zone(g, z), 'trash');
  assert.equal(locOf(g, u), 'base', 'saved and recalled');
  assert.ok(g.objects[u].counters.buff > 0, 'buff kept');
  assert.equal(mightOf(g, u), 3);
});

test('RJ#10622 Death from Below may be replayed from the trash repeatedly in a turn (each kill of a 3-Might-or-less unit, paying [A] each time)', () => {
  let g = S0(); fundAll(g, P0, 12);
  const es = [put(g, P1, 'V(1)', BF_A), put(g, P1, 'V(2)', BF_A), put(g, P1, 'V(3)', BF_A)]; control(g, BF_A, P1);
  const dfb = hand(g, P0, 'Death from Below');
  g = play(g, P0, dfb, { targets: [[es[0]]] });
  g = drive(g, gg => { const d = gg.pending!; if (d.kind === 'optional') return ['yes']; const t = es.find(e => d.options?.some(o => o.id === e) && gg.objects[e].zone === 'battlefield'); return t ? [t] : undefined; }, 80).g;
  assert.deepEqual(es.map(e => zone(g, e)), ['trash', 'trash', 'trash'], 'played three times');
  assert.equal(zone(g, dfb), 'trash');
});

test('RJ#10623 Mighty = current Might 5 or more, counting buffs/modifiers (Fiora, Victorious 4: not Mighty; buffed to 5: Mighty)', () => {
  const g = S0();
  const f = put(g, P0, 'Fiora, Victorious', 'base');
  assert.ok(!hasKeyword(g, f, 'Ganking'), '4 Might: not Mighty');
  const f2 = put(g, P0, 'Fiora, Victorious', 'base', { buff: true });
  assert.equal(mightOf(g, f2), 5);
  assert.ok(hasKeyword(g, f2, 'Ganking'), 'buffed to 5: Mighty');
  const big = put(g, P0, 'Fiora, Victorious', 'base'); mod(g, big, { might: 3 });
  assert.ok(hasKeyword(g, big, 'Ganking'), '7 Might: Mighty');
});

test('RJ#10625 Star-Crossed in response to Mindsplitter\'s play trigger (not to the unit itself): Mindsplitter returns to hand, the trigger still resolves', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1);
  const ms = hand(g, P0, 'Mindsplitter');
  const mine = put(g, P1, 'V(2)', 'base');
  const sc = hand(g, P1, 'Star-Crossed');
  const other = hand(g, P1, 'V(1)');
  g = act(g, { type: 'playCard', player: P0, obj: ms, destination: 'base' } as never);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  assert.equal(zone(g, ms), 'base', 'Mindsplitter is on the board (no reaction to the unit)');
  assert.ok(g.chain.length > 0, 'its play trigger is on the chain');
  if (pend(g).player === P0) g = pass(g);
  g = play(g, P1, sc, { targets: [[mine], [ms]] });
  g = drive(g, gg => gg.pending!.player === P0 && gg.pending!.options?.some(o => o.id === other) ? [other] : undefined).g;
  assert.equal(zone(g, ms), 'hand', 'Mindsplitter returned');
  assert.equal(zone(g, other), 'trash', 'the trigger still resolved: P1 discarded');
});

test('RJ#10626 Janna, Savior in response to Elder Dragon\'s play trigger: she heals first, then the 1 damage still kills the unit (Elder Dragon passive)', () => {
  let g = S0(); fundAll(g, P0, 20); fundAll(g, P1);
  const e = put(g, P1, 'V(6)', BF_A); control(g, BF_A, P1);
  const ed = hand(g, P0, 'Elder Dragon');
  const jn = hand(g, P1, 'Janna, Savior');
  g = act(g, { type: 'playCard', player: P0, obj: ed, destination: 'base' } as never);
  for (let i = 0; i < 6 && pend(g).inStep && pend(g).player === P0; i++) { const d = pend(g); g = choose(g, ...(d.options!.some(o => o.id === e) ? [e] : [d.options![0].id])); }
  assert.ok(g.chain.length > 0, 'Elder Dragon trigger on the chain');
  if (pend(g).player === P0) g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: jn, destination: BF_A } as never);
  g = drive(g).g;
  assert.ok(g.log.some(l => /Resolving Janna/.test(l.text)), 'Janna\'s trigger resolved');
  assert.equal(zone(g, e), 'trash', 'killed by the 1 damage');
});

test('RJ#10627 Vi, Peacekeeper returned to hand by Star-Crossed in response to her attack trigger: the stun ("an enemy unit here") does nothing', () => {
  let g = S0(); fundAll(g, P1);
  const d1 = put(g, P1, 'V(3)', BF_A), d2 = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const vi = put(g, P0, 'Vi, Peacekeeper', 'base');
  const sc = hand(g, P1, 'Star-Crossed');
  g = move(g, P0, [vi], BF_A);
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const d = pend(g); g = choose(g, d.options!.some(o => o.id === d1) ? d1 : d.options![0].id); }
  assert.ok(chainLabels(g).some(l => /Vi/.test(l)), `Vi's attack trigger on the chain (${chainLabels(g)})`);
  for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, sc, { targets: [[d2], [vi]] });
  g = drive(g).g;
  assert.equal(zone(g, vi), 'hand');
  assert.ok(!g.objects[d1].stunned, 'no stun');
});

test('RJ#10630 Switcheroo at Forbidding Waste: lone defender 4 (-2 → 2) vs attacker 4 — swapped to defender 4, attacker 2', () => {
  const g0 = S0({ tp: P0 }); fundAll(g0, P1); setBattlefieldCard(g0, BF_A, 'Forbidding Waste');
  const d = put(g0, P1, 'V(4)', BF_A); control(g0, BF_A, P1);
  const a = put(g0, P0, 'V(4)', 'base');
  const sw = hand(g0, P1, 'Switcheroo');
  let g = move(g0, P0, [a], BF_A);
  for (let i = 0; i < 8 && !canPlayNow(g, P1, sw); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, d), 2);
  g = play(g, P1, sw, { targets: [[d, a], [a]] });
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, d), 4, 'defender now 4');
  assert.equal(mightOf(g, a), 2, 'attacker now 2');
});

test('RJ#10631 Sigil of the Storm: a Seal can\'t satisfy the conquer recycle — a rune is recycled even with a Seal ready', () => {
  let g = S0();
  setBattlefieldCard(g, BF_A, 'Sigil of the Storm');
  const seal = put(g, P0, 'Seal of Rage', 'base');
  const u = put(g, P0, 'V(1)', 'base');
  const n0 = g.players[P0].runesInPlay.length;
  g = drive(move(g, P0, [u], BF_A), gg => { const o = gg.pending!.options?.find(x => x.id === seal); assert.ok(!o, 'the Seal is not offered'); return undefined; }).g;
  assert.equal(g.players[P0].runesInPlay.length, n0 - 1, 'one rune recycled');
  assert.ok(!g.objects[seal].exhausted, 'Seal untouched');
});

test('RJ#10632 Crescent Strike (Action) can\'t respond to Void Assault; Void Assault fully resolves (both moves) before the combat showdown starts', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const f = put(g, P0, 'V(3)', 'base');
  const e = put(g, P1, 'V(2)', 'base');
  const cs = hand(g, P1, 'Crescent Strike');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Void Assault') });
  for (let i = 0; i < 8 && pend(g).inStep; i++) g = answer(g, { targets: [[f], [e]], locations: [BF_A, BF_A] });
  assert.ok(g.chain.length > 0);
  if (pend(g).player === P0) g = pass(g);
  assert.equal(pend(g).player, P1);
  assert.ok(!canPlayNow(g, P1, cs), 'Action spell can\'t be played on the chain');
  g = pass(g);
  assert.equal(locOf(g, f), BF_A); assert.equal(locOf(g, e), BF_A);
  assert.ok(g.showdown?.isCombat, 'combat showdown after the spell');
});

test('RJ#10633 Enemy unit with Eye of the Herald moves onto Kha\'Zix, Mutating Horror: the Recruit is played before combat, so the attacker isn\'t alone — no +2', () => {
  let g = S0({ tp: P1 }); tokens(g, 'Recruit');
  const kz = put(g, P0, 'Kha\'Zix, Mutating Horror', BF_A); control(g, BF_A, P0);
  const u = put(g, P1, 'V(3)', 'base');
  const eye = put(g, P1, 'Eye of the Herald', 'base'); attachNow(g, eye, u);
  g = move(g, P1, [u], BF_A);
  g = drive(g).g;
  assert.ok(g.log.some(l => /Recruit/.test(l.text)), 'Recruit played');
  assert.ok(!g.log.some(l => /Trigger: Kha'Zix/.test(l.text) || /Resolving Kha'Zix/.test(l.text)), 'Kha\'Zix did not trigger');
  // control: without the Eye the attacker is alone and Kha'Zix triggers
  let c = S0({ tp: P1 });
  put(c, P0, 'Kha\'Zix, Mutating Horror', BF_A); control(c, BF_A, P0);
  c = drive(move(c, P1, [put(c, P1, 'V(3)', 'base')], BF_A)).g;
  assert.ok(c.log.some(l => /Trigger: Kha'Zix/.test(l.text)), 'control: Kha\'Zix triggers');
});

test('RJ#10634 Ruined Rex dies in combat and its Deathknell kills the last enemy unit: no units remain on either side, No Result — nobody conquers', () => {
  let { g, atk, def } = attackSetup(['Ruined Rex'], ['V(3)'], { atkOpts: [{ damage: 3 }] });
  addPrevent(g, def[0], 6); // Rex's combat damage is prevented
  g = drive(g, gg => { const o = optionIds(gg); return o.includes(def[0]) ? [def[0]] : undefined; }, 60).g;
  assert.equal(zone(g, atk[0]), 'trash', 'Rex died (3 marked + 3)');
  assert.equal(zone(g, def[0]), 'trash', 'Deathknell killed the last defender');
  assert.equal(g.players[P0].points, 0, 'no conquer');
  assert.notEqual(g.battlefields[BF_A].controller, P0);
});

test('RJ#10635 Smite ("would die → banish instead") vs Zhonya\'s Hourglass: the affected unit\'s controller orders the replacements; applying Zhonya\'s first saves it', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const z = put(g, P0, "Zhonya's Hourglass", 'base');
  const u = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  g = play(g, P1, hand(g, P1, 'Smite'), { targets: [[u]] });
  const seen: string[] = [];
  g = drive(g, gg => { const d = gg.pending!; if (d.player === P0) { seen.push(`${d.kind}: ${d.prompt} [${d.options!.map(o => o.label).join('; ')}]`); const o = d.options!.find(x => /Zhonya/i.test(x.label)); return o ? [o.id] : undefined; } return undefined; }).g;
  assert.equal(zone(g, u), 'base', `saved by Zhonya's (prompts: ${seen.join(' | ')})`);
  assert.ok(seen.length > 0, `P0 was asked to order the replacements (${seen})`);
  assert.equal(zone(g, z), 'trash');
});

test('RJ#10636 Two attack triggers choosing the same Deflect unit: Deflect is paid (or declined) separately for each; a declined one leaves the chain', () => {
  let { g, def } = attackSetup(['Vi, Peacekeeper', 'Vi, Peacekeeper'], ['Deflect(2,1)']);
  const deflectAsks: string[] = [];
  let k = 0;
  g = drive(g, gg => {
    const d = gg.pending!;
    if (d.options?.some(o => o.id === def[0])) return [def[0]];
    if (d.player === P0 && /Deflect/i.test(d.prompt + d.options!.map(o => o.label).join())) { deflectAsks.push(d.prompt); return [k++ === 0 ? (d.options!.find(o => o.id === 'yes')?.id ?? d.options![0].id) : (d.options!.find(o => o.id === 'no')?.id ?? d.options!.at(-1)!.id)]; }
    return undefined;
  }, 60).g;
  assert.equal(deflectAsks.length, 2, `asked for Deflect once per trigger (${deflectAsks})`);
  assert.equal(g.log.filter(l => /^Resolving Vi/.test(l.text)).length, 1, 'only the paid trigger resolved');
});

test('RJ#10638 Soraka, Wanderer dying simultaneously (Unchecked Power) still saves the smaller friendly units at her battlefield; she herself dies', () => {
  let g = S0(); fundAll(g, P0, 14);
  const s = put(g, P0, 'Soraka, Wanderer', BF_A); control(g, BF_A, P0);
  const a = put(g, P0, 'V(2)', BF_A), b = put(g, P0, 'V(3)', BF_A), big = put(g, P0, 'V(5)', BF_A);
  g = drive(play(g, P0, hand(g, P0, 'Unchecked Power'))).g;
  assert.equal(zone(g, s), 'trash', 'Soraka died');
  assert.deepEqual([zone(g, a), zone(g, b)], ['base', 'base'], 'smaller units saved and recalled');
  assert.ok(g.objects[a].exhausted && g.objects[a].damage === 0);
  assert.equal(zone(g, big), 'trash', 'not less Might than her: dies');
});

test('RJ#10639 "Channel N runes" with no state given: they enter ready (K\'Sante\'s hold channel)', () => {
  let g = S0({ tp: P1 });
  put(g, P0, 'K\'Sante, Courageous', BF_A); control(g, BF_A, P0);
  const n0 = g.players[P0].runesInPlay.length;
  g = nextTurn(g);
  assert.equal(g.activePlayer, P0);
  assert.ok(g.log.some(l => /K'Sante/.test(l.text)), `hold trigger resolved (${logText(g).slice(-700)})`);
  assert.equal(g.players[P0].runesInPlay.length, n0 + 3, '1 from K\'Sante + 2 in the Channel Phase');
  assert.equal(readyRunes(g, P0), g.players[P0].runesInPlay.length, 'all ready');
});

test('RJ#10640 Flurry of Blades earlier in the turn, then Dazzling Aurora plays Elder Dragon at end of turn: the enemy units\' marked 1 damage becomes lethal', () => {
  let g = S0(); fundAll(g, P0);
  const e1 = put(g, P1, 'V(3)', BF_A), e2 = put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  put(g, P0, 'Dazzling Aurora', 'base');
  put(g, P0, 'Elder Dragon', 'deckTop');
  g = drive(play(g, P0, hand(g, P0, 'Flurry of Blades'))).g;
  assert.deepEqual([g.objects[e1].damage, g.objects[e2].damage], [1, 1]);
  g = endTurn(g, P0);
  for (let i = 0; i < 40 && !(pend(g).kind === 'mainAction' && pend(g).player === P1); i++) {
    const d = pend(g);
    if (d.inStep && d.player === P0 && d.kind === 'chooseTargets' && (d.min ?? 1) === 0) { g = act(g, { type: 'choose', player: P0, optionIds: [] }); continue; }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.ok(g.log.some(l => /Elder Dragon/.test(l.text)), 'Elder Dragon played');
  assert.deepEqual([zone(g, e1), zone(g, e2)], ['trash', 'trash'], 'both damaged enemy units die');
});

test('RJ#10642 Downwell returns everything, but the opponent\'s Treasure Trove "leaves the board" trigger keeps the chain going: they keep control and may play their hidden unit there', () => {
  const run = (trove: boolean) => {
    let g = S0(); fundAll(g, P0, 14); fundAll(g, P1);
    put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
    const hid = put(g, P1, 'HidU(1)', { facedown: BF_A });
    if (trove) put(g, P1, 'Treasure Trove', 'base');
    g = play(g, P0, hand(g, P0, 'Downwell'));
    let could = false;
    for (let i = 0; i < 20; i++) {
      const d = g.pending; if (!d || d.kind === 'mainAction') break;
      if (d.player === P1 && !d.inStep && zone(g, hid) === 'facedown' && !chainLabels(g).some(l => /Downwell/.test(l)) && canPlayNow(g, P1, hid)) { could = true; g = act(g, { type: 'playCard', player: P1, obj: hid, destination: BF_A } as never); continue; }
      g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
    }
    return { could, hidZone: zone(g, hid), loc: locOf(g, hid), ctl: g.battlefields[BF_A].controller, log: logText(g).slice(-900) };
  };
  const t = run(true);
  assert.ok(t.could, 'hidden unit playable while the Trove trigger is on the chain');
  assert.equal(t.loc, BF_A, t.log); assert.equal(t.ctl, P1, 'control kept');
  const n = run(false);
  assert.ok(!n.could, 'without a trigger: no window');
  assert.equal(n.hidZone, 'trash', 'hidden card trashed after losing control');
});

test('RJ#10643 Deathgrip on my buffed unit saved by The Boss (Sett legend): no kill, so no Might bonus to the other unit — the draw still happens', () => {
  let g = S0(); fundAll(g, P0, 4);
  setLegend(g, P0, 'The Boss');
  const u = put(g, P0, 'V(3)', BF_A, { buff: true }); control(g, BF_A, P0);
  const o = put(g, P0, 'V(1)', 'base');
  const dg = hand(g, P0, 'Deathgrip');
  const h0 = g.players[P0].hand.length - 1;
  g = act(g, { type: 'playCard', player: P0, obj: dg });
  g = drive(g, gg => { const d = gg.pending!; if (d.kind === 'optional') return ['yes']; const x = d.options?.find(z => z.id === u) ?? d.options?.find(z => z.id === o); return x ? [x.id] : undefined; }).g;
  assert.equal(locOf(g, u), 'base', 'recalled instead of dying');
  assert.equal(mightOf(g, o), 1, 'no Might bonus');
  assert.equal(g.players[P0].hand.length, h0 + 1, 'drew 1');
});

test('RJ#10644 Warwick, Hunter\'s attack trigger goes on the chain even with no damaged enemies; Flurry of Blades in response damages them and they die on resolution', () => {
  let g = S0(); fundAll(g, P0);
  const e1 = put(g, P1, 'V(3)', BF_A), e2 = put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  const w = put(g, P0, 'Warwick, Hunter', 'base');
  g = move(g, P0, [w], BF_A);
  assert.ok(chainLabels(g).some(l => /Warwick/.test(l)), `trigger on the chain with no damaged units (${chainLabels(g)})`);
  if (pend(g).player !== P0) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Flurry of Blades'));
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.deepEqual([zone(g, e1), zone(g, e2)], ['trash', 'trash']);
});

test('RJ#10645 Vi, Peacekeeper attacking two defenders stuns only one (one target); combat damage is pooled', () => {
  let { g, def } = attackSetup(['Vi, Peacekeeper', 'V(2)'], ['V(3)', 'V(2)']);
  for (let i = 0; i < 10 && (g.chain.length || pend(g).inStep); i++) { const d = pend(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.options!.some(o => o.id === def[0]) ? def[0] : d.options![0].id] }) : pass(g); }
  assert.ok(g.log.some(l => /Resolving Vi/.test(l.text)), 'Vi\'s trigger resolved');
  assert.deepEqual([!!g.objects[def[0]].stunned, !!g.objects[def[1]].stunned], [true, false], 'only the chosen defender is stunned');
  g = drive(g, undefined, 60).g;
  assert.deepEqual([zone(g, def[0]), zone(g, def[1])], ['trash', 'trash'], '7 pooled Might kills 3 + 2');
});

test('RJ#10646 Abandoned Hall: a spell countered by Defy is not considered played for "when a player plays a spell" (CR 426.1.b) — no +1', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1); setBattlefieldCard(g, BF_A, 'Abandoned Hall');
  const f = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const sp = hand(g, P0, 'DrawR');
  g = act(g, { type: 'playCard', player: P0, obj: sp });
  for (let i = 0; i < 8 && pend(g).player !== P1; i++) { const d = pend(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : d.options!.some(o => o.id === f) ? f : d.options![0].id] }) : pass(g); }
  g = play(g, P1, hand(g, P1, 'Defy'), { targets: [[sp]] });
  g = drive(g, gg => gg.pending!.kind === 'optional' ? ['yes'] : gg.pending!.options?.some(o => o.id === f) ? [f] : undefined).g;
  assert.ok(g.log.some(l => /Defy/.test(l.text)));
  assert.equal(zone(g, sp), 'trash', 'countered');
  assert.equal(mightOf(g, f), 3, `no +1 (${logText(g).slice(-500)})`);
  // control: not countered → +1
  let c = S0(); fundAll(c, P0); setBattlefieldCard(c, BF_A, 'Abandoned Hall');
  const f2 = put(c, P0, 'V(3)', BF_A); control(c, BF_A, P0);
  c = drive(act(c, { type: 'playCard', player: P0, obj: hand(c, P0, 'DrawR') }), gg => gg.pending!.kind === 'optional' ? ['yes'] : gg.pending!.options?.some(o => o.id === f2) ? [f2] : undefined).g;
  assert.equal(mightOf(c, f2), 4, 'control: +1');
});

test('RJ#10647 Windsinger played from Hidden can only return a unit at its own battlefield (CR 811.1.d.3)', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const here = put(g, P1, 'V(2)', BF_A);
  const there = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  const ws = put(g, P0, 'Windsinger', { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P0, obj: ws, destination: BF_A } as never);
  let opts: string[] = [];
  g = drive(g, gg => { const d = gg.pending!; if (d.kind === 'optional') return ['yes']; if (d.kind === 'chooseTargets') { opts = d.options!.map(o => o.id); return opts.includes(here) ? [here] : undefined; } return undefined; }).g;
  assert.ok(!opts.includes(there), `unit at another battlefield not offered (${opts})`);
  assert.equal(zone(g, here), 'hand');
  assert.equal(locOf(g, there), BF_B);
});

test('RJ#10648 Call to Glory\'s additional cost may spend the buff of any unit I control, e.g. one in my base, for another unit at a battlefield', () => {
  let g = S0(); setRunes(g, P0, 0);
  const b = put(g, P0, 'V(2)', 'base', { buff: true });
  const t = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const cg = hand(g, P0, 'Call to Glory');
  g = act(g, { type: 'playCard', player: P0, obj: cg });
  g = drive(g, gg => { const d = gg.pending!; if (d.kind === 'optional') return ['yes']; if (/buff/i.test(d.prompt) && d.options!.some(o => o.id === b)) return [b]; if (d.options!.some(o => o.id === t)) return [t]; return undefined; }).g;
  assert.ok(!(g.objects[b].counters.buff > 0), 'base unit\'s buff spent');
  assert.equal(mightOf(g, t), 5, '+3 with no runes paid');
});

test('RJ#10649 Returning a unit from a battlefield to hand is not a move: Stellacorn Herder Gusted does not trigger "When I move"', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const sh = put(g, P0, 'Stellacorn Herder', BF_A); control(g, BF_A, P0);
  const h0 = g.players[P0].hand.length;
  g = drive(play(g, P1, hand(g, P1, 'Gust'), { targets: [[sh]] })).g;
  assert.equal(zone(g, sh), 'hand');
  assert.equal(g.players[P0].hand.length, h0 + 1, 'only the Herder itself was added (no draw)');
  assert.ok(!/Trigger: Stellacorn/.test(logText(g)));
});

test('RJ#10651 Sacrifice\'s kill cost on a buffed Mighty unit replaced by The Boss: the unit is recalled, the cost counts as paid (CR 203.2), Sacrifice still draws 2 and channels', () => {
  let g = S0(); fundAll(g, P0, 8);
  setLegend(g, P0, 'The Boss');
  const m = put(g, P0, 'V(4)', BF_A, { buff: true }); control(g, BF_A, P0);
  const sac = hand(g, P0, 'Sacrifice');
  const h0 = g.players[P0].hand.length - 1;
  const r0 = g.players[P0].runesInPlay.length;
  g = act(g, { type: 'playCard', player: P0, obj: sac });
  g = drive(g, gg => { const d = gg.pending!; if (d.kind === 'optional') return ['yes']; return d.options?.some(o => o.id === m) ? [m] : undefined; }).g;
  assert.equal(locOf(g, m), 'base', `saved and recalled (${logText(g).slice(-600)})`);
  assert.equal(g.players[P0].hand.length, h0 + 2, 'drew 2');
  assert.ok(g.players[P0].runesInPlay.length >= r0, `channelled (${r0} → ${g.players[P0].runesInPlay.length})`);
  assert.ok(g.log.some(l => /channels 1 rune/i.test(l.text)), 'channelled 1 rune');
});

test('RJ#10652 Frigid Jewel\'s second-draw trigger can be answered by Gust on its chosen 3-Might unit: Gust resolves first, the +2 does nothing', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  g = nextTurn(nextTurn(g));
  assert.equal(g.activePlayer, P0);
  const u = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'Frigid Jewel', 'base');
  const gust = hand(g, P1, 'Gust');
  g = play(g, P0, hand(g, P0, 'DrawR'));
  let gusted = false;
  for (let i = 0; i < 20; i++) {
    const d = g.pending; if (!d || d.kind === 'mainAction') break;
    if (!gusted && d.player === P1 && !d.inStep && chainLabels(g).some(l => /Frigid Jewel/.test(l))) { g = play(g, P1, gust, { targets: [[u]] }); gusted = true; continue; }
    g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.options!.some(o => o.id === u) ? u : d.options![0].id] }) : pass(g);
  }
  assert.ok(gusted, 'Gust played in response to the Frigid Jewel trigger');
  assert.equal(zone(g, u), 'hand');
});

test('RJ#10653 Drag Under costs [2] less only when played from somewhere other than the hand (e.g. the trash via Endless Riches)', () => {
  const g = S0(); fundAll(g, P0, 8);
  put(g, P0, 'Endless Riches', 'base');
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const h = hand(g, P0, 'Drag Under'); const t = put(g, P0, 'Drag Under', 'trash');
  const cost = (id: ObjId) => playOptions(g, P0).filter(o => o.obj === id).map(o => playCost(g, P0, o)!.energy);
  assert.deepEqual(cost(h), [5], 'from hand: full cost');
  assert.deepEqual(cost(t), [3], 'from the trash: 2 less');
});

test('RJ#10654 Bloodharbor Ripper (Pyke legend) returns my only unit at Ripper\'s Bay: control is lost and my hidden card there is trashed', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1); setBattlefieldCard(g, BF_A, 'Ripper\'s Bay'); tokens(g, 'Gold');
  const l = setLegend(g, P1, 'Bloodharbor Ripper');
  const u = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const hid = put(g, P1, 'HidU(1)', { facedown: BF_A });
  const ab = legal(g, P1, 'activate').find(a => a.type === 'activate' && a.obj === l)!;
  assert.ok(ab, 'legend ability available');
  g = drive(act(g, ab), gg => gg.pending!.kind === 'optional' ? ['no'] : gg.pending!.options?.some(o => o.id === u) ? [u] : undefined).g;
  assert.equal(zone(g, u), 'hand');
  assert.equal(g.battlefields[BF_A].controller, null, 'control lost');
  assert.equal(zone(g, hid), 'trash', 'hidden card trashed');
});

test('RJ#10655 Thrill of the Hunt on my only unit at my battlefield (opponent\'s turn), replayed there: control never lapses, so no conquer and no point', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const f = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  g = play(g, P1, hand(g, P1, 'DrawR'));
  if (pend(g).player !== P0) g = pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Thrill of the Hunt') });
  g = drive(g, gg => { const o = optionIds(gg); return o.includes(f) ? [f] : o.includes(String(BF_A)) ? [String(BF_A)] : undefined; }).g;
  const f2 = Object.values(g.objects).find(o => o.cardId === g.objects[f]?.cardId && o.zone === 'battlefield' && o.controller === P0);
  assert.ok(f2 && locOf(g, f2.id) === BF_A, 'replayed to the same battlefield');
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, 0, 'no conquer point');
});

test('RJ#10656 Flurry of Feathers while attacking an enemy battlefield: the Birds can\'t be played to that battlefield (not controlled)', () => {
  const g0 = S0(); fundAll(g0, P0); tokens(g0, 'Bird');
  put(g0, P1, 'V(9)', BF_A); control(g0, BF_A, P1);
  const a = put(g0, P0, 'V(2)', 'base');
  const ff = hand(g0, P0, 'Flurry of Feathers');
  let g = move(g0, P0, [a], BF_A);
  for (let i = 0; i < 8 && !canPlayNow(g, P0, ff); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.showdown?.isCombat);
  const before = new Set(Object.keys(g.objects));
  g = act(g, { type: 'playCard', player: P0, obj: ff });
  let dests: string[] = [];
  for (let i = 0; i < 12 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (d.inStep) {
      if (d.kind === 'chooseMode') { g = choose(g, d.options!.find(o => /Bird/.test(o.label))!.id); continue; }
      if (d.kind === 'chooseDestination') { dests = d.options!.map(o => o.id); g = choose(g, dests.includes('base') ? 'base' : dests[0]); continue; }
      g = act(g, legal(g, d.player)[0]); continue;
    }
    g = pass(g);
  }
  const birds = Object.keys(g.objects).filter(id => !before.has(id) && g.objects[id].isToken);
  assert.equal(birds.length, 4, 'four Birds');
  assert.ok(birds.every(b => locOf(g, b) !== BF_A), `none at the attacked battlefield (dests offered: ${dests})`);
});

test('RJ#10657 Skyfall of Areion only affects the equipped unit\'s own triggers: holding The Candlelit Sanctum does not trigger its "When you conquer here"', () => {
  let g = S0({ tp: P1 }); setBattlefieldCard(g, BF_A, 'The Candlelit Sanctum');
  const u = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  attachNow(g, put(g, P0, 'Skyfall of Areion', 'base'), u);
  g = endTurn(g, P1);
  const seen: string[] = [];
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.pending.player === P0); i++) { const d = g.pending; seen.push(d.prompt); g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g); }
  assert.ok(g.log.some(l => /holds/.test(l.text)), `held (${logText(g).slice(-500)})`);
  assert.ok(!g.log.some(l => /^(Trigger|Resolving).*Candlelit/.test(l.text)) && !seen.some(s => /Candlelit|top two|recycle/i.test(s)), `no Sanctum trigger (${logText(g).slice(-500)})`);
});

test('RJ#10658 0-Might Scuttle Crab needs 1 lethal damage: a 5-Might attacker can\'t kill both a 5-Might defender and the Crab; the Crab survives and keeps the battlefield', () => {
  let { g, atk, def } = attackSetup(['V(5)'], ['V(5)', 'Scuttle Crab']);
  for (let i = 0; i < 20 && pend(g).kind !== 'assignDamage'; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  const [big, crab] = def;
  const ok = (a: Record<string, number>) => validateAction(g, { type: 'assignDamage', player: pend(g).player, assignment: a });
  assert.equal(pend(g).player, P0);
  assert.equal(ok({ [big]: 5 }), null);
  assert.equal(ok({ [crab]: 1, [big]: 4 }), null, 'Crab first: 1 is lethal');
  assert.notEqual(ok({ [big]: 5, [crab]: 1 }), null, 'only 5 damage to assign');
  g = act(g, { type: 'assignDamage', player: P0, assignment: { [big]: 5 } });
  g = drive(g, undefined, 60).g;
  assert.equal(zone(g, big), 'trash'); assert.equal(zone(g, atk[0]), 'trash');
  assert.equal(locOf(g, crab), BF_A, 'Crab survives');
  assert.equal(g.battlefields[BF_A].controller, P1);
});

test('RJ#10659 Hidden Wages of Pain answered by a hidden Tideturner: Tideturner\'s trigger resolves first; Wages still resolves — on its target if still legal, skipping the damage if the swap moved it away ("here")', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1); tokens(g, 'Gold');
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(5)', BF_A);
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  const wp = put(g, P0, 'Wages of Pain', { facedown: BF_A });
  const tt = put(g, P1, 'Tideturner', { facedown: BF_B });
  g = act(g, { type: 'playCard', player: P0, obj: wp });
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, e);
  if (pend(g).player !== P1) g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: tt, destination: BF_B } as never);
  g = drive(g, gg => gg.pending!.kind === 'optional' ? ['yes'] : gg.pending!.options?.some(o => o.id === e) ? [e] : undefined).g;
  const lines = g.log.map(l => l.text);
  assert.ok(lines.findIndex(l => /^Resolving Tideturner/.test(l)) < lines.findIndex(l => /^Resolving Wages of Pain/.test(l)), 'Tideturner first, Wages still resolves');
  assert.equal(locOf(g, e), BF_B, 'target swapped to the other battlefield');
  assert.equal(g.objects[e].damage, 0, 'no longer "here": the damage is skipped (CR 811.1.d, as RJ#210)');
  assert.ok(lines.some(l => /Gold/.test(l)), 'the rest of Wages still resolves (Gold token)');
});

test('RJ#10660 Attacker passes focus; the defender plays a Reaction with focus: after it resolves the attacker has focus again (showdown continues)', () => {
  let { g } = attackSetup(['V(3)'], ['V(3)']);
  fundAll(g, P1);
  for (let i = 0; i < 6 && pend(g).kind !== 'showdownAction'; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(pend(g).player, P0, 'attacker has focus');
  g = pass(g);
  assert.equal(pend(g).player, P1);
  g = play(g, P1, hand(g, P1, 'DrawR'));
  g = resolveChain(g);
  assert.ok(g.showdown, 'showdown continues');
  assert.equal(pend(g).kind, 'showdownAction');
  assert.equal(pend(g).player, P0, 'focus back to the attacker');
});

test('RJ#10661 Opponent moves Hwei and Vex, Apathetic together; a hidden Teemo played in response to Hwei\'s move trigger is stunned (Vex is already at the battlefield)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const tm = put(g, P0, 'Teemo, Scout', { facedown: BF_A });
  const hw = put(g, P1, 'Hwei, Brooding Painter', 'base'), vx = put(g, P1, 'Vex, Apathetic', 'base');
  for (let i = 0; i < 3; i++) put(g, P1, 'V(1)', 'deckTop');
  g = move(g, P1, [hw, vx], BF_A);
  for (let i = 0; i < 6 && !(pend(g).player === P0 && !pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(chainLabels(g).some(l => /Hwei/.test(l)), `Hwei's move trigger on the chain (${chainLabels(g)})`);
  g = act(g, { type: 'playCard', player: P0, obj: tm, destination: BF_A } as never);
  for (let i = 0; i < 20 && !g.log.some(l => /Resolving Vex/.test(l.text)) && g.pending && g.pending.kind !== 'mainAction'; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.log.some(l => /Resolving Vex/.test(l.text)), 'Vex triggered on Teemo');
  assert.ok(g.objects[tm].stunned, 'Teemo stunned');
});

test('RJ#10662 Mutated Mouser defending: Shield is passive (no window before it applies); Switcheroo swaps its 3 Might (1 + Shield 2) with the attacker\'s', () => {
  let g = S0(); fundAll(g, P0);
  const m = put(g, P1, 'Mutated Mouser', BF_A); control(g, BF_A, P1);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  const a = put(g, P0, 'V(6)', 'base');
  const sw2 = hand(g, P0, 'Switcheroo');
  g = move(g, P0, [a], BF_A);
  assert.equal(mightOf(g, m), 3, 'Shield already applied as it becomes a defender');
  for (let i = 0; i < 8 && !canPlayNow(g, P0, sw2); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = play(g, P0, sw2, { targets: [[a, m], [m]] });
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, a), 3); assert.equal(mightOf(g, m), 6);
});

test('RJ#10664 At the start of the combat showdown the attacker has focus: the defender can\'t play a Reaction until the attacker acts or passes', () => {
  let { g } = attackSetup(['V(3)'], ['V(3)']);
  fundAll(g, P1);
  const r = hand(g, P1, 'DrawR');
  for (let i = 0; i < 6 && pend(g).kind !== 'showdownAction'; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(pend(g).player, P0);
  assert.ok(!canPlayNow(g, P1, r), 'defender has no priority yet');
  g = pass(g);
  assert.ok(canPlayNow(g, P1, r), 'after the attacker passes focus');
});

test('RJ#10665 Rengar, Trophy Hunter may Ambush (Reaction) to a different battlefield with enemy units in response to a spell on my unit elsewhere; he enters first, the spell then resolves', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const mine = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  const r = hand(g, P0, 'Rengar, Trophy Hunter');
  g = play(g, P1, hand(g, P1, 'KillA'), { targets: [[mine]] });
  if (pend(g).player !== P0) g = pass(g);
  assert.ok(canPlayNow(g, P0, r, BF_B), 'Ambush to BF-B (enemy units, none of mine)');
  g = play(g, P0, r, { dest: BF_B });
  g = resolveChain(g);
  assert.equal(locOf(g, r), BF_B);
  assert.equal(zone(g, mine), 'trash', 'the spell still resolved on its target');
});

test('RJ#10666 Lillia, Fae Fawn moves from her battlefield to base: her trigger keeps the chain going, the Sprite arrives, control is kept and the hidden card there stays', () => {
  let g = S0(); tokens(g, 'Sprite');
  const li = put(g, P0, 'Lillia, Fae Fawn', BF_A); control(g, BF_A, P0);
  const hid = put(g, P0, 'HidU(1)', { facedown: BF_A });
  g = drive(move(g, P0, [li], 'base')).g;
  assert.equal(locOf(g, li), 'base');
  assert.ok(g.players[P0].base.length >= 1);
  assert.ok(Object.values(g.objects).some(o => o.isToken && o.zone === 'battlefield' && o.battlefieldIndex === BF_A), 'Sprite at BF-A');
  assert.equal(g.battlefields[BF_A].controller, P0, 'control kept');
  assert.equal(zone(g, hid), 'facedown', 'hidden card stays');
});

test('RJ#10667 A Sand Soldier with Sacred Shears returned to hand by Windsinger doesn\'t die: no Deathknell draw (the token just ceases to exist)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1); tokens(g, 'Recruit');
  const ss = put(g, P0, 'Recruit', BF_A); // a unit token (Sand Soldier token def isn't in data/cards.json) control(g, BF_A, P0);
  attachNow(g, put(g, P0, 'Sacred Shears', 'base'), ss);
  const h0 = g.players[P0].hand.length;
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Windsinger'), destination: 'base' } as never);
  g = drive(g, gg => gg.pending!.kind === 'optional' ? ['yes'] : gg.pending!.options?.some(o => o.id === ss) ? [ss] : undefined).g;
  assert.ok(!['battlefield', 'base'].includes(zone(g, ss)), 'Sand Soldier left the board');
  assert.equal(g.players[P0].hand.length, h0, 'no draw');
});

test('RJ#10668 Fizz, Trickster ignores only the Energy cost: the Power cost is still paid, and a Repeat cost may be paid on top', () => {
  const run = (repeat: boolean) => {
    let g = S0(); fundAll(g, P0, 10);
    const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
    const bb = put(g, P0, 'Bellows Breath', 'trash');
    const n = g.log.length;
    g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Fizz, Trickster'), destination: 'base' } as never), gg => {
      const d = gg.pending!;
      if (d.kind === 'optional') return [/Repeat/i.test(d.prompt) ? (repeat ? 'yes' : 'no') : 'yes'];
      if (d.options?.some(o => o.id === bb)) return [bb];
      if (d.options?.some(o => o.id === e)) return [e];
      return undefined;
    }).g;
    return { pays: g.log.slice(n).filter(l => /^P0 pays/.test(l.text)).map(l => l.text), dmg: g.objects[e].damage };
  };
  const a = run(false), b = run(true);
  assert.equal(a.pays.length, 2, `Fizz + Bellows' power (${a.pays})`);
  assert.ok(/^P0 pays [A-Z]$/.test(a.pays[1]), `only 1 power for Bellows Breath (${a.pays})`);
  assert.equal(a.dmg, 1);
  assert.equal(b.dmg, 2, `Repeat executed (${b.pays})`);
});

test('RJ#10669 Rengar, Pouncing (Reaction) played during my combat showdown to the battlefield I\'m attacking becomes an Attacker (Assault 2 applies)', () => {
  const g0 = S0(); fundAll(g0, P0);
  put(g0, P1, 'V(9)', BF_A); control(g0, BF_A, P1);
  const a = put(g0, P0, 'V(2)', 'base');
  const r = hand(g0, P0, 'Rengar, Pouncing');
  let g = move(g0, P0, [a], BF_A);
  for (let i = 0; i < 8 && !canPlayNow(g, P0, r, BF_A); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.showdown?.isCombat);
  assert.ok(playDests(g, P0, r).includes(BF_A), 'the attacked battlefield is a legal destination');
  g = play(g, P0, r, { dest: BF_A });
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(locOf(g, r), BF_A);
  assert.equal(g.objects[r].combatRole, 'attacker');
  assert.equal(mightOf(g, r), 5, '3 + Assault 2');
});

test('RJ#10671 Thousand-Tailed Watcher\'s play trigger can be answered only while on the chain; once it resolved the opponent has no window', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(5)', 'base');
  const r = hand(g, P0, 'DrawR');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Thousand-Tailed Watcher'), destination: 'base' } as never);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, { type: 'choose', player: pend(g).player, optionIds: [pend(g).kind === 'optional' ? 'no' : pend(g).options![0].id] });
  assert.ok(g.chain.length > 0, 'trigger on the chain');
  if (pend(g).player === P1) g = pass(g);
  assert.ok(canPlayNow(g, P0, r), 'may respond while it is on the chain');
  g = pass(g);
  assert.equal(g.chain.length, 0);
  assert.equal(pend(g).kind, 'mainAction'); assert.equal(pend(g).player, P1);
  assert.ok(!canPlayNow(g, P0, r), 'no window after it resolved');
});

test('RJ#10672 Ride the Wind moving my unit onto Abandoned Hall: the Hall\'s +1 comes after the spell resolves, so the moved unit can get it', () => {
  let g = S0(); fundAll(g, P0); setBattlefieldCard(g, BF_A, 'Abandoned Hall');
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const d = put(g, P0, 'V(3)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Ride the Wind') });
  g = drive(g, gg => { const x = gg.pending!; if (x.kind === 'optional') return ['yes']; if (x.options?.some(o => o.id === d)) return [d]; if (x.options?.some(o => o.id === String(BF_A))) return [String(BF_A)]; return undefined; }).g;
  assert.equal(locOf(g, d), BF_A);
  assert.equal(mightOf(g, d), 4, 'Hall +1 on the moved unit');
});

test('RJ#10673 Damage stays marked when the unit moves to base (Flash): a 5-Might unit with 3 damage still has 3 damage', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const hw = put(g, P1, 'V(5)', BF_A, { damage: 3 }); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Flash') });
  g = drive(g, gg => gg.pending!.options?.some(o => o.id === hw) ? [hw] : undefined).g;
  assert.equal(locOf(g, hw), 'base');
  assert.equal(g.objects[hw].damage, 3);
});

test('RJ#10674 Kai\'Sa contests an enemy battlefield; Hextech Ray on her answered by Flash to base: Ray (unit at a battlefield) does nothing, no damage', () => {
  const g0 = S0({ tp: P0 }); fundAll(g0, P0); fundAll(g0, P1);
  put(g0, P1, 'V(4)', BF_A); control(g0, BF_A, P1);
  const ks = put(g0, P0, 'Kai\'Sa, Survivor', 'base');
  const ray = hand(g0, P1, 'Hextech Ray');
  let g = move(g0, P0, [ks], BF_A);
  for (let i = 0; i < 8 && !(pend(g).player === P1 && !pend(g).inStep && canPlayNow(g, P1, ray)); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = play(g, P1, ray, { targets: [[ks]] });
  if (pend(g).player !== P0) g = pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Flash') });
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, ks);
  g = drive(g, undefined, 40).g;
  assert.equal(locOf(g, ks), 'base');
  assert.equal(g.objects[ks].damage, 0, 'no damage dealt');
});

test('RJ#10675 Attacking with a 2-Might unit; opponent Gusts it; I Ambush Vi, Peacekeeper in response: she becomes an Attacker, her stun resolves before Gust', () => {
  const g0 = S0(); fundAll(g0, P0); fundAll(g0, P1);
  const e = put(g0, P1, 'V(4)', BF_A); control(g0, BF_A, P1);
  const a = put(g0, P0, 'V(2)', 'base');
  const vi = hand(g0, P0, 'Vi, Peacekeeper');
  const gust = hand(g0, P1, 'Gust');
  let g = move(g0, P0, [a], BF_A);
  for (let i = 0; i < 8 && !(pend(g).player === P1 && canPlayNow(g, P1, gust)); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = play(g, P1, gust, { targets: [[a]] });
  if (pend(g).player !== P0) g = pass(g);
  assert.ok(canPlayNow(g, P0, vi, BF_A), 'Vi may be ambushed in response to Gust');
  g = play(g, P0, vi, { dest: BF_A });
  for (let i = 0; i < 20 && chainLabels(g).some(l => /Gust/.test(l)); i++) { const d = pend(g); g = d.inStep ? choose(g, d.options!.some(o => o.id === e) ? e : d.options![0].id) : pass(g); }
  const lines = g.log.map(l => l.text);
  const iVi = lines.findIndex(l => /^Resolving Vi/.test(l)), iGust = lines.findIndex(l => /^Resolving Gust/.test(l));
  assert.ok(iVi >= 0 && iVi < iGust, 'Vi\'s attack trigger resolves before Gust');
  assert.ok(g.objects[e].stunned, 'enemy stunned');
  assert.equal(zone(g, a), 'hand', 'Gust still returns the 2-Might unit');
  assert.equal(g.objects[vi].combatRole, 'attacker');
});

test('RJ#10677 Beast Below played while the opponent\'s Vex, Apathetic is at a battlefield: Vex stuns it (and it can\'t move) even though Beast Below returns Vex', () => {
  let g = S0(); fundAll(g, P0, 12);
  const vx = put(g, P1, 'Vex, Apathetic', BF_A); control(g, BF_A, P1);
  const mine = put(g, P0, 'V(1)', 'base');
  const bb = hand(g, P0, 'Beast Below');
  g = act(g, { type: 'playCard', player: P0, obj: bb, destination: 'base' } as never);
  g = drive(g, gg => { const d = gg.pending!; if (d.options?.some(o => o.id === vx)) return [vx]; if (d.options?.some(o => o.id === mine)) return [mine]; return undefined; }).g;
  assert.equal(zone(g, vx), 'hand', 'Vex returned');
  assert.ok(g.objects[bb].stunned, 'Beast Below stunned');
  assert.ok(!legal(g, P0, 'move').some(a => a.type === 'move' && a.units.includes(bb)), 'can\'t move this turn');
});

test('RJ#10678 A hidden Zhonya\'s Hourglass may be played with no unit dying (Reaction timing from Hidden); the gear ends in my base and saves a later death', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const z = put(g, P0, "Zhonya's Hourglass", { facedown: BF_A });
  g = play(g, P1, hand(g, P1, 'DrawR'));
  if (pend(g).player !== P0) g = pass(g);
  assert.ok(canPlayNow(g, P0, z), 'playable in response to an unrelated spell');
  g = act(g, { type: 'playCard', player: P0, obj: z } as never);
  g = drive(g).g;
  assert.equal(zone(g, z), 'base', 'gear goes to base');
  g = drive(play(g, P1, hand(g, P1, 'KillA'), { targets: [[u]] })).g;
  assert.equal(locOf(g, u), 'base', 'saved later');
  assert.equal(zone(g, z), 'trash');
});

test('RJ#10679 Brynhir Thundersong Star-Crossed in response to his play trigger: the trigger still resolves — opponents can\'t play cards this turn', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1);
  const br = hand(g, P0, 'Brynhir Thundersong');
  const theirs = put(g, P1, 'V(2)', 'base');
  const sc = hand(g, P1, 'Star-Crossed'); const later = hand(g, P1, 'DrawR');
  g = act(g, { type: 'playCard', player: P0, obj: br, destination: 'base' } as never);
  assert.ok(chainLabels(g).some(l => /Brynhir/.test(l)));
  if (pend(g).player !== P1) g = pass(g);
  g = play(g, P1, sc, { targets: [[theirs], [br]] });
  g = resolveChain(g);
  assert.equal(zone(g, br), 'hand', 'Brynhir returned');
  g = play(g, P0, hand(g, P0, 'DrawR'));
  if (pend(g).player !== P1) g = pass(g);
  assert.ok(!canPlayNow(g, P1, later), 'P1 can\'t play cards this turn');
});

test('RJ#10521 Thrill of the Hunt replaying Brynhir Thundersong in response to the opponent\'s Dazzling Aurora trigger: not a counter, but they can\'t play the revealed unit', () => {
  let g = S0(); fundAll(g, P1);
  put(g, P0, 'Dazzling Aurora', 'base');
  const top = put(g, P0, 'V(4)', 'deckTop');
  const br = put(g, P1, 'Brynhir Thundersong', 'base');
  const th = hand(g, P1, 'Thrill of the Hunt');
  g = endTurn(g, P0);
  let done = false;
  for (let i = 0; i < 40 && !(pend(g).kind === 'mainAction' && pend(g).player === P1); i++) {
    const d = pend(g);
    if (!done && d.player === P1 && !d.inStep && chainLabels(g).some(l => /Dazzling Aurora/.test(l))) { g = act(g, { type: 'playCard', player: P1, obj: th }); done = true; continue; }
    if (d.inStep && d.player === P1) { const o = optionIds(g); g = choose(g, o.includes(br) ? br : o.includes('base') ? 'base' : o[0]); continue; }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.ok(done, 'Thrill played in response to the Aurora trigger');
  assert.ok(g.log.some(l => /Resolving Dazzling Aurora/.test(l.text)), 'the Aurora trigger still resolved (not countered)');
  assert.ok(!['base', 'battlefield'].includes(zone(g, top)), `revealed unit not played (${zone(g, top)})`);
});

test('RJ#10681 Gust in response to Mirror Image: the Reflection is still played (0 Might, not a copy) and has Temporary', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1); tokens(g, 'Reflection');
  const t = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const before = new Set(Object.keys(g.objects));
  g = play(g, P0, hand(g, P0, 'Mirror Image'), { targets: [[t]] });
  if (pend(g).player !== P1) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[t]] });
  g = drive(g).g;
  assert.equal(zone(g, t), 'hand');
  const r = Object.keys(g.objects).filter(id => !before.has(id) && g.objects[id].isToken && g.objects[id].zone === 'base');
  assert.equal(r.length, 1, 'Reflection played');
  assert.equal(mightOf(g, r[0]), 0, 'not a copy');
  assert.ok(hasKeyword(g, r[0], 'Temporary'), 'has Temporary');
});

test('RJ#10682 Svellsongur (Quick-Draw via Jax, Unmatched) attached to Ahri, Alluring on the opponent\'s turn: holding scores 1 + 1 + 1 (copied text) = 3', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'Jax, Unmatched', 'base');
  const ah = put(g, P0, 'Ahri, Alluring', BF_A); control(g, BF_A, P0);
  const sv = hand(g, P0, 'Svellsongur');
  g = play(g, P1, hand(g, P1, 'DrawR'));
  if (pend(g).player !== P0) g = pass(g);
  assert.ok(canPlayNow(g, P0, sv), 'Quick-Draw: Reaction timing');
  g = act(g, { type: 'playCard', player: P0, obj: sv });
  g = drive(g, gg => gg.pending!.options?.some(o => o.id === ah) ? [ah] : gg.pending!.kind === 'optional' ? ['yes'] : undefined).g;
  assert.equal(g.objects[sv].attachedTo, ah, 'attached to Ahri');
  const p0 = g.players[P0].points;
  g = drive(endTurn(g, P1)).g;
  assert.equal(g.players[P0].points - p0, 3);
});

test('RJ#10684 Falling Star choosing the same Deflect unit for both instances pays Deflect twice', () => {
  const pays = (card: string) => {
    let g = S0(); fundAll(g, P0, 10);
    const t = put(g, P1, card, BF_A); control(g, BF_A, P1);
    const n = g.log.length;
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Falling Star') });
    g = answer(g, { targets: [[t], [t]] }, P0);
    assert.ok(g.chain.length > 0);
    return g.log.slice(n).filter(l => /^P0 pays/.test(l.text)).map(l => l.text).join(' ');
  };
  const plain = pays('V(9)'), dfl = pays('Deflect(9,1)');
  const power = (s: string) => (s.match(/\b[A-Z]\b/g) ?? []).length;
  assert.equal(power(dfl) - power(plain), 2, `Deflect paid twice (${plain} vs ${dfl})`);
});

test('RJ#10686 Elder Dragon entering makes MY earlier damage lethal on enemy units at once; damage the opponent dealt to their own unit does not count', () => {
  let g = S0(); fundAll(g, P0, 24); fundAll(g, P1);
  const mineHit = put(g, P1, 'V(4)', 'base');
  const selfHit = put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bellows Breath') });
  g = drive(g, gg => { const d = gg.pending!; if (d.kind === 'optional') return ['no']; if (d.options?.some(o => o.id === mineHit)) return [mineHit]; return undefined; }).g;
  assert.equal(g.objects[mineHit].damage, 1, 'my 1 damage');
  g = play(g, P0, hand(g, P0, 'DrawR'));
  if (pend(g).player !== P1) g = pass(g);
  g = drive(play(g, P1, hand(g, P1, 'Flurry of Blades'))).g;
  assert.equal(g.objects[selfHit].damage, 1, 'their own 1 damage');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Elder Dragon'), destination: 'base' } as never);
  for (let i = 0; i < 12 && pend(g).inStep && pend(g).player === P0; i++) g = act(g, { type: 'choose', player: P0, optionIds: [] });
  assert.equal(zone(g, mineHit), 'trash', 'my damage became lethal as Elder Dragon entered');
  g = drive(g).g;
  assert.equal(zone(g, selfHit), 'battlefield', 'damage dealt by the opponent is not "your damage"');
});

test('RJ#10687 Thrill of the Hunt on Akshan in response to the opponent\'s Dazzling Aurora trigger, stealing the Aurora: the trigger still resolves for its controller', () => {
  let g = S0(); fundAll(g, P1, 10);
  const au = put(g, P0, 'Dazzling Aurora', 'base');
  const top = put(g, P0, 'V(4)', 'deckTop');
  const ak = put(g, P1, 'Akshan, Mischievous', BF_B); control(g, BF_B, P1);
  const th = hand(g, P1, 'Thrill of the Hunt');
  g = endTurn(g, P0);
  let done = false;
  for (let i = 0; i < 50 && !(pend(g).kind === 'mainAction' && pend(g).player === P1); i++) {
    const d = pend(g);
    if (!done && d.player === P1 && !d.inStep && chainLabels(g).some(l => /Dazzling Aurora/.test(l))) { g = act(g, { type: 'playCard', player: P1, obj: th }); done = true; continue; }
    if (d.inStep && d.player === P1) { const o = optionIds(g); g = choose(g, d.kind === 'optional' ? 'yes' : o.includes(ak) ? ak : o.includes(au) ? au : o.includes(String(BF_B)) ? String(BF_B) : o[0]); continue; }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.ok(done);
  assert.equal(g.objects[au].controller, P1, 'Aurora stolen');
  assert.ok(['base', 'battlefield'].includes(zone(g, top)) && g.objects[top].controller === P0, 'P0 still played the revealed unit');
});

test('RJ#10688 Attacking, I kill a defender with a spell: Immortal Phoenix can be played from my trash, but not to the battlefield I\'m attacking', () => {
  const g0 = S0(); fundAll(g0, P0, 10);
  const d1 = put(g0, P1, 'V(2)', BF_A); put(g0, P1, 'V(2)', BF_A); control(g0, BF_A, P1);
  const ph = put(g0, P0, 'Immortal Phoenix', 'trash');
  const a = put(g0, P0, 'V(3)', 'base');
  const k = hand(g0, P0, 'KillA');
  let g = move(g0, P0, [a], BF_A);
  for (let i = 0; i < 8 && !canPlayNow(g, P0, k); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = play(g, P0, k, { targets: [[d1]] });
  let dests: string[] | null = null;
  for (let i = 0; i < 16 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (d.inStep && d.kind === 'optional') { g = yes(g); continue; }
    if (d.inStep && d.kind === 'chooseDestination') { dests = d.options!.map(o => o.id); g = choose(g, dests.includes('base') ? 'base' : dests[0]); continue; }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.equal(zone(g, d1), 'trash');
  assert.notEqual(locOf(g, ph), BF_A, 'not to the attacked battlefield');
  assert.equal(locOf(g, ph), 'base', `played to base (dests ${dests})`);
  if (dests) assert.ok(!(dests as string[]).includes(String(BF_A)));
});

test('RJ#10689 Hidden Sprite Call in response to the old Sprite\'s Temporary trigger keeps the battlefield: the new Sprite holds it for a point', () => {
  const g0 = S0({ tp: P1 }); fundAll(g0, P0); tokens(g0, 'Sprite');
  put(g0, P0, 'Sprite', BF_A, { token: true }); control(g0, BF_A, P0);
  const sc = put(g0, P0, 'Sprite Call', { facedown: BF_A });
  let g = endTurn(g0, P1);
  assert.ok(g.chain.length > 0, 'Temporary trigger on the chain');
  g = play(g, P0, sc);
  g = drive(g).g;
  assert.equal(g.battlefields[BF_A].controller, P0, 'battlefield kept');
  assert.equal(g.players[P0].points, 1, 'hold point');
});

test('RJ#10691 Overzealous Fan\'s defend trigger: the "kill me" is decided and paid as it goes on the chain; then the attacker may respond with an Ambush unit', () => {
  const g0 = S0(); fundAll(g0, P0);
  const fan = put(g0, P1, 'Overzealous Fan', BF_A); control(g0, BF_A, P1);
  const a = put(g0, P0, 'V(3)', 'base');
  const amb = hand(g0, P0, 'Ambusher(2)');
  let g = move(g0, P0, [a], BF_A);
  assert.equal(pend(g).kind, 'optional'); assert.equal(pend(g).player, P1);
  g = yes(g);
  assert.equal(zone(g, fan), 'trash', 'Fan killed as the trigger is finalized');
  assert.ok(chainLabels(g).some(l => /Overzealous/.test(l)), 'trigger on the chain');
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(canPlayNow(g, P0, amb, BF_A), 'Ambush in response');
  g = play(g, P0, amb, { dest: BF_A });
  g = resolveChain(g);
  assert.equal(locOf(g, a), 'base', 'attacker moved to base');
  assert.equal(locOf(g, amb), BF_A);
});

test('RJ#10692 Attacker passes; defender plays an Action in the showdown; once it resolves the attacker has focus and may play an Action', () => {
  let { g, atk } = attackSetup(['V(3)'], ['V(3)']);
  fundAll(g, P0); fundAll(g, P1);
  const k = hand(g, P0, 'KillA');
  for (let i = 0; i < 6 && pend(g).kind !== 'showdownAction'; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = pass(g);
  assert.equal(pend(g).player, P1);
  g = play(g, P1, hand(g, P1, 'StunA'), { targets: [[atk[0]]] });
  g = resolveChain(g);
  assert.equal(pend(g).kind, 'showdownAction'); assert.equal(pend(g).player, P0);
  assert.ok(canPlayNow(g, P0, k), 'attacker may play an Action');
});

test('RJ#10693 Opponent attacks my battlefield: during the showdown I play a hidden Tideturner from my other battlefield and swap it with my defender', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  const tt = put(g, P0, 'Tideturner', { facedown: BF_B });
  const a = put(g, P1, 'V(5)', 'base');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 8 && !(pend(g).player === P0 && !pend(g).inStep && canPlayNow(g, P0, tt)); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.showdown?.isCombat);
  g = act(g, { type: 'playCard', player: P0, obj: tt, destination: BF_B } as never);
  for (let i = 0; i < 8 && (g.chain.length || pend(g).inStep); i++) { const d = pend(g); g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : d.options!.some(o => o.id === u) ? u : d.options![0].id) : pass(g); }
  assert.equal(locOf(g, tt), BF_A, 'Tideturner now at the attacked battlefield');
  assert.equal(locOf(g, u), BF_B);
});

test('RJ#10694 Diana, No Longer Human: a spell countered by Defy is not considered played (CR 426.1.b), so no +2', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const di = put(g, P0, 'Diana, No Longer Human', 'base');
  const sp = hand(g, P0, 'DrawR');
  g = act(g, { type: 'playCard', player: P0, obj: sp });
  for (let i = 0; i < 6 && pend(g).player !== P1; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = play(g, P1, hand(g, P1, 'Defy'), { targets: [[sp]] });
  g = drive(g).g;
  assert.equal(zone(g, sp), 'trash');
  assert.equal(mightOf(g, di), 3, `no +2 (${logText(g).slice(-400)})`);
});

test('RJ#10695 Clash of Giants between two enemy units: the units deal the damage, not me — my Elder Dragon\'s "any amount of your damage" does not apply', () => {
  let g = S0(); fundAll(g, P0, 12);
  put(g, P0, 'Elder Dragon', 'base');
  const a = put(g, P1, 'V(3)', BF_A), b = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Clash of Giants'), { targets: [[a, b]] });
  g = drive(g, gg => { const d = gg.pending!; const o = d.options?.map(x => x.id) ?? []; return o.includes(a) && o.includes(b) ? [a, b].slice(0, Math.max(1, d.max ?? 2)) : undefined; }).g;
  assert.equal(zone(g, a), 'trash', '9 damage kills the 3');
  assert.equal(g.objects[b].damage, 3);
  assert.equal(zone(g, b), 'battlefield', 'the 9-Might unit survives 3 damage (not "your damage")');
});

test('RJ#10696 A unit played by Glasc Mixologist\'s Deathknell enters exhausted (played units enter exhausted unless stated)', () => {
  const g0 = S0(); fundAll(g0, P0, 7);
  put(g0, P0, 'Glasc Mixologist', BF_A); control(g0, BF_A, P0);
  const v = put(g0, P0, 'V(2)', 'trash');
  let g = passAll(play(g0, P0, hand(g0, P0, 'Unchecked Power')));
  g = drive(g, gg => { const d = gg.pending!; if (d.kind === 'chooseCards' && d.options!.some(o => o.id === v)) return [v]; if (d.kind === 'chooseDestination') return ['base']; return undefined; }).g;
  assert.equal(zone(g, v), 'base');
  assert.equal(g.objects[v].exhausted, true);
});

test('RJ#10697 Ezreal, Dashing attacks Teemo, Strategist: the defend trigger (on top) resolves first; if it kills Ezreal, his attack trigger does nothing', () => {
  const g0 = S0();
  const t = put(g0, P1, 'Teemo, Strategist', BF_A); control(g0, BF_A, P1);
  clearDeckTop(g0, P1, 5, 'HidU(1)');
  const ez = put(g0, P0, 'Ezreal, Dashing', 'base');
  let g = move(g0, P0, [ez], BF_A);
  g = drive(g, gg => gg.pending!.options?.some(o => o.id === t) ? [t] : gg.pending!.options?.some(o => o.id === ez) ? [ez] : undefined).g;
  const lines = g.log.map(l => l.text);
  const iT = lines.findIndex(l => /^Resolving Teemo/.test(l)), iE = lines.findIndex(l => /^Resolving Ezreal/.test(l));
  assert.ok(iT >= 0 && (iE < 0 || iT < iE), 'Teemo\'s trigger resolves first');
  assert.equal(zone(g, ez), 'trash', 'Ezreal killed');
  assert.equal(g.objects[t].damage, 0, 'Ezreal\'s trigger dealt nothing');
  assert.equal(zone(g, t), 'battlefield');
});

test('RJ#10698 Renata Glasc, Industrialist + Deceiver: the Reflection token enters ready (Deceiver already says "ready"; Renata is redundant)', () => {
  const g0 = S0(); fundAll(g0, P0); setLegend(g0, P0, 'Deceiver'); tokens(g0, 'Reflection');
  put(g0, P0, 'Renata Glasc, Industrialist', 'base');
  const x = put(g0, P0, 'V(3)', 'base'); hand(g0, P0, 'V(1)');
  const before = new Set(Object.keys(g0.objects));
  const { g } = drive(move(g0, P0, [x], BF_A));
  const r = Object.keys(g.objects).filter(id => !before.has(id) && g.objects[id].isToken && g.objects[id].zone === 'battlefield');
  assert.equal(r.length, 1, 'Reflection played');
  assert.equal(g.objects[r[0]].exhausted, false, 'ready');
});

test('RJ#10700 Bone Skewer makes the opponent play a unit to a battlefield: to an empty one → a showdown, not combat; to one with my units → combat, their unit is the attacker (CR 466.2.c.1)', () => {
  const run = (occupied: boolean) => {
    let g = S0(); fundAll(g, P0);
    if (occupied) { put(g, P0, 'V(5)', BF_A); control(g, BF_A, P0); }
    const u = hand(g, P1, 'V(2)');
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bone Skewer') });
    for (let i = 0; i < 12 && (g.chain.length || pend(g).inStep); i++) {
      const d = pend(g);
      if (d.inStep) { const o = optionIds(g); g = choose(g, d.kind === 'optional' ? 'yes' : o.includes(u) ? u : o.includes(String(BF_A)) ? String(BF_A) : o.includes(g.battlefields[BF_A].objId) ? g.battlefields[BF_A].objId : o[0]); continue; }
      g = pass(g);
    }
    return { g, u };
  };
  const e = run(false);
  assert.equal(locOf(e.g, e.u), BF_A, 'played to BF-A');
  assert.ok(e.g.objects[e.u].stunned);
  assert.ok(!e.g.showdown?.isCombat, 'empty battlefield: no combat');
  const o = run(true);
  assert.equal(locOf(o.g, o.u), BF_A);
  assert.ok(o.g.showdown?.isCombat, 'combat');
  assert.equal(o.g.showdown?.attacker, P1, 'the player whose unit arrived is the attacker');
});

test('RJ#10702 Rengar, Trophy Hunter\'s Ambush (Reaction timing) can\'t play him to base — only to qualifying battlefields', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const r = hand(g, P0, 'Rengar, Trophy Hunter');
  g = play(g, P1, hand(g, P1, 'DrawR'));
  if (pend(g).player !== P0) g = pass(g);
  const ds = playDests(g, P0, r);
  assert.ok(ds.includes(BF_A), 'Ambush to the battlefield with enemy units');
  assert.ok(!ds.includes('base'), `not to base (${ds})`);
});

test('RJ#10703 Rek\'Sai, Swarm Queen Star-Crossed in response to her attack trigger: it still resolves, but the revealed unit can\'t be played "here" (she is gone)', () => {
  let g = S0(); fundAll(g, P1);
  const d = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const rk = put(g, P0, 'Rek\'Sai, Swarm Queen', 'base');
  const t1 = put(g, P0, 'V(2)', 'deckTop'), t2 = put(g, P0, 'V(2)', 'deckTop');
  const sc = hand(g, P1, 'Star-Crossed');
  g = move(g, P0, [rk], BF_A);
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = yes(g);
  assert.ok(chainLabels(g).some(l => /Rek'Sai/.test(l)), `attack trigger on the chain (${chainLabels(g)})`);
  for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, sc, { targets: [[d], [rk]] });
  g = drive(g, gg => { const x = gg.pending!; if (x.kind === 'optional') return ['yes']; const o = x.options!.map(z => z.id); if (o.includes(t1)) return [t1]; if (o.includes(t2)) return [t2]; return undefined; }).g;
  assert.equal(zone(g, rk), 'hand');
  assert.ok(g.log.some(l => /Resolving Rek'Sai/.test(l.text)), 'the trigger resolved');
  assert.ok(![t1, t2].some(t => locOf(g, t) === BF_A), 'no revealed unit played to BF-A');
});

test('RJ#10704 Weaponmaster attaching Blade of the Ruined King: the "kill a friendly unit" part of its Equip cost must still be paid', () => {
  let g = S0(); fundAll(g, P0, 12);
  const fodder = put(g, P0, 'V(1)', 'base');
  const blade = put(g, P0, 'Blade of the Ruined King', 'base');
  const lu = hand(g, P0, 'Lucian, Merciless');
  g = play(g, P0, lu);
  g = drive(g, gg => { const d = gg.pending!; if (d.kind === 'optional') return ['yes']; if (d.options?.some(o => o.id === blade)) return [blade]; if (d.options?.some(o => o.id === fodder)) return [fodder]; return undefined; }).g;
  assert.equal(g.objects[blade].attachedTo, lu, 'Blade attached');
  assert.equal(zone(g, fodder), 'trash', 'a friendly unit was killed for the cost');
});

test('RJ#10707 Mask of Foresight: Rengar ambushed in as a second defender at Star Spring, which then sends my other unit to base — Rengar never defended alone, no +1', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); setBattlefieldCard(g, BF_A, 'Star Spring');
  put(g, P0, 'Mask of Foresight', 'base');
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const r = hand(g, P0, 'Rengar, Trophy Hunter');
  const a = put(g, P1, 'V(9)', 'base');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 10 && !(pend(g).player === P0 && !pend(g).inStep && canPlayNow(g, P0, r, BF_A)); i++) g = pend(g).inStep ? act(g, { type: 'choose', player: pend(g).player, optionIds: [pend(g).kind === 'optional' ? 'yes' : pend(g).options![0].id] }) : pass(g);
  g = play(g, P0, r, { dest: BF_A });
  for (let i = 0; i < 12 && (g.chain.length || pend(g).inStep); i++) { const d = pend(g); g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : d.options!.some(o => o.id === u) ? u : d.options![0].id) : pass(g); }
  assert.equal(locOf(g, u), 'base', 'Star Spring moved the other unit away');
  assert.equal(locOf(g, r), BF_A);
  assert.equal(mightOf(g, r), 6, 'no Mask +1 for Rengar');
});

test('RJ#10708 Nidalee, Cat Form attacks and fails to kill the defender: she is recalled, didn\'t win the combat, no draw', () => {
  let { g, atk } = attackSetup(['Nidalee, Cat Form'], ['V(6)'], { defOpts: [{ stunned: true }] });
  const h0 = g.players[P0].hand.length;
  g = drive(g, undefined, 60).g;
  assert.equal(locOf(g, atk[0]), 'base', 'recalled');
  assert.equal(g.players[P0].hand.length, h0, 'no draw');
});

test('RJ#10709 Attacking with an Eye of the Herald unit: its Recruit (played before combat) is also an attacker, so Nine-Tailed Fox triggers for it too (1-Might Recruit stays at the minimum of 1)', () => {
  let g = S0(); tokens(g, 'Recruit'); setLegend(g, P1, 'Nine-Tailed Fox');
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const u = put(g, P0, 'V(4)', 'base');
  attachNow(g, put(g, P0, 'Eye of the Herald', 'base'), u);
  const before = new Set(Object.keys(g.objects));
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 12 && pend(g).kind !== 'assignDamage' && pend(g).kind !== 'mainAction'; i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  const rec = Object.keys(g.objects).find(id => !before.has(id) && g.objects[id].isToken)!;
  assert.ok(rec, 'Recruit played');
  assert.equal(g.objects[rec].combatRole, 'attacker');
  assert.equal(g.log.filter(l => /^Trigger: Nine-Tailed Fox/.test(l.text)).length, 2, 'Fox triggered for both attackers');
  assert.equal(mightOf(g, u), 3); assert.equal(mightOf(g, rec), 1);
});

test('RJ#10710 Gust whose target was pumped above 3 in response does nothing but still resolves and counts as played (Diana, No Longer Human +2)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const di = put(g, P0, 'Diana, No Longer Human', 'base');
  const t = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Gust'), { targets: [[t]] });
  for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'PumpR'), { targets: [[t]] });
  g = drive(g).g;
  assert.equal(locOf(g, t), BF_A, 'Gust did nothing');
  assert.equal(zone(g, g.players[P0].trash.find(id => g.cards[g.objects[id].cardId].name === 'Gust')!), 'trash', 'Gust resolved to the trash');
  assert.equal(mightOf(g, di), 5, 'counted as played');
});

test('RJ#10711 Lilting Lullaby counters Time Warp: no extra turn, and its controller can\'t play spells this turn', () => {
  let g = S0(); fundAll(g, P0, 16); fundAll(g, P1);
  const tw = hand(g, P0, 'Time Warp'); const later = hand(g, P0, 'DrawR');
  g = play(g, P0, tw);
  if (pend(g).player !== P1) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Lilting Lullaby'), { targets: [[tw]] });
  g = resolveChain(g);
  assert.equal(zone(g, tw), 'trash', 'countered (not banished)');
  assert.ok(!canPlayNow(g, P0, later), 'P0 can\'t play spells this turn');
  g = nextTurn(g);
  assert.equal(g.activePlayer, P1, 'no extra turn');
});

test('RJ#10712 Rockfall Path ("units can\'t be played here") does not stop a Ganking unit from moving there from another battlefield', () => {
  const g = S0(); setBattlefieldCard(g, BF_A, 'Rockfall Path');
  const gk = put(g, P0, 'Ganker(2)', BF_B); control(g, BF_B, P0);
  assert.ok(moveDests(g, P0, gk).includes(BF_A), `may gank to Rockfall Path (${moveDests(g, P0, gk)})`);
});

test('RJ#10713 "Play a token here" at Rockfall Path does nothing: Eye of the Herald\'s Recruit isn\'t played there', () => {
  let g = S0(); tokens(g, 'Recruit'); setBattlefieldCard(g, BF_A, 'Rockfall Path');
  const u = put(g, P0, 'V(3)', 'base');
  attachNow(g, put(g, P0, 'Eye of the Herald', 'base'), u);
  const before = new Set(Object.keys(g.objects));
  g = drive(move(g, P0, [u], BF_A)).g;
  assert.equal(locOf(g, u), BF_A);
  const toks = Object.keys(g.objects).filter(id => !before.has(id) && g.objects[id].isToken && ['battlefield', 'base'].includes(g.objects[id].zone));
  assert.deepEqual(toks.map(id => locOf(g, id)), [], 'no Recruit');
});

test('RJ#10714 Thousand-Tailed Watcher vs a 1-Might unit at Trifarian War Camp (2): the snapshotted reduction is -1, so it stays at 1; leaving the camp it drops to 0', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1, 12); fundAll(g, P0); setBattlefieldCard(g, BF_A, 'Trifarian War Camp');
  const u = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  assert.equal(mightOf(g, u), 2);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Thousand-Tailed Watcher'), destination: 'base' } as never), gg => gg.pending!.kind === 'optional' ? ['no'] : undefined).g;
  assert.equal(mightOf(g, u), 1, 'stays at the minimum of 1');
  g = play(g, P1, hand(g, P1, 'DrawR'));
  if (pend(g).player !== P0) g = pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Flash') });
  g = drive(g, gg => gg.pending!.options?.some(o => o.id === u) ? [u] : undefined).g;
  assert.equal(locOf(g, u), 'base');
  assert.equal(mightOf(g, u), 0, 'without the camp\'s +1: 1 - 1 = 0');
});

test('RJ#10715 Ferrous Forerunner\'s Deathknell plays two Mechs: Pridestalker triggers twice (+1 each), both may go to the same unit for +2', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1); setLegend(g, P0, 'Pridestalker');
  const ff = put(g, P0, 'Ferrous Forerunner', BF_A); control(g, BF_A, P0);
  const t = put(g, P0, 'V(2)', 'base');
  g = play(g, P1, hand(g, P1, 'KillA'), { targets: [[ff]] });
  g = drive(g, gg => gg.pending!.options?.some(o => o.id === t) ? [t] : undefined).g;
  assert.equal(g.log.filter(l => /^Trigger: Pridestalker/.test(l.text)).length, 2, 'two triggers');
  assert.equal(mightOf(g, t), 4, '+1 +1 on the same unit');
});

test('RJ#10716 A Gold token played by Bloodharbor Ripper (Pyke legend) is not a card: Battering Ram\'s cost is not reduced', () => {
  let g = S0(); fundAll(g, P0); tokens(g, 'Gold');
  const l = setLegend(g, P0, 'Bloodharbor Ripper');
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const br = hand(g, P0, 'Battering Ram');
  const c0 = playCostOf(g, P0, br)!.energy;
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === l)!;
  g = drive(act(g, ab), gg => gg.pending!.options?.some(o => o.id === u) ? [u] : gg.pending!.kind === 'optional' ? ['no'] : undefined).g;
  assert.ok(g.log.some(l2 => /Gold/.test(l2.text)), 'Gold token played');
  assert.equal(playCostOf(g, P0, br)!.energy, c0, 'no reduction');
});

test('RJ#10719 Pridestalker (Rengar legend) is a triggered ability: it goes on the chain and can be responded to', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1); setLegend(g, P0, 'Pridestalker');
  put(g, P0, 'V(2)', 'base');
  const r = hand(g, P1, 'DrawR');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'V(1)'), destination: 'base' } as never);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  assert.ok(chainLabels(g).some(l => /Pridestalker/.test(l)), `on the chain (${chainLabels(g)})`);
  if (pend(g).player !== P1) g = pass(g);
  assert.ok(canPlayNow(g, P1, r), 'opponent may respond');
});

test('RJ#10720 My Bone Skewer makes the opponent play Thousand-Tailed Watcher: its "enemy units -3" is from its controller\'s view, so my units get -3', () => {
  let g = S0(); fundAll(g, P0);
  const mine = put(g, P0, 'V(5)', BF_B); control(g, BF_B, P0);
  const theirs = put(g, P1, 'V(5)', 'base');
  const w = hand(g, P1, 'Thousand-Tailed Watcher');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bone Skewer') });
  g = drive(g, gg => { const d = gg.pending!; const o = optionIds(gg); if (d.kind === 'optional') return [d.player === P1 ? 'no' : 'yes']; if (o.includes(w)) return [w]; if (o.includes(String(BF_A))) return [String(BF_A)]; if (o.includes(g.battlefields[BF_A].objId)) return [g.battlefields[BF_A].objId]; return undefined; }).g;
  assert.equal(locOf(g, w), BF_A, 'Watcher played by its owner');
  assert.equal(mightOf(g, mine), 2, 'my unit -3');
  assert.equal(mightOf(g, theirs), 5, 'their unit unaffected');
});

test('RJ#10722 Moonfall\'s -2 applies only to enemy units there as it resolves; a unit arriving later is unaffected', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(5)', BF_A);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Moonfall') });
  g = drive(g, gg => { const d = gg.pending!; const o = optionIds(gg); if (d.kind === 'optional') return ['no']; if (o.includes(String(BF_A))) return [String(BF_A)]; if (o.includes(g.battlefields[BF_A].objId)) return [g.battlefields[BF_A].objId]; if (d.kind === 'chooseTargets' && (d.min ?? 1) === 0) return []; return undefined; }).g;
  assert.equal(mightOf(g, e), 3);
  const late = put(g, P1, 'V(5)', BF_A);
  assert.equal(mightOf(g, late), 5, 'later arrival unaffected');
});

test('RJ#10724 Defending player ambushes Vi, Peacekeeper into the combat: she is a Defender, her "When I attack" stun never triggers', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  put(g, P0, 'Rift Herald', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'V(3)', 'base');
  const vi = hand(g, P0, 'Vi, Peacekeeper');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 10 && !(pend(g).player === P0 && !pend(g).inStep && canPlayNow(g, P0, vi, BF_A)); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = play(g, P0, vi, { dest: BF_A });
  for (let i = 0; i < 10 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(g.objects[vi].combatRole, 'defender');
  assert.ok(!g.log.some(l => /^Trigger: Vi/.test(l.text)), 'no attack trigger');
  assert.ok(!g.objects[a].stunned);
});

test('RJ#10726 Opponent attacks my battlefield; in the showdown I Ride the Wind my unit away and Moonfall their unit to my other battlefield: they don\'t conquer the original one', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12);
  const u = put(g, P0, 'V(4)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(6)', BF_B); control(g, BF_B, P0);
  const a = put(g, P1, 'V(2)', 'base');
  const rw = hand(g, P0, 'Ride the Wind'), mf = hand(g, P0, 'Moonfall');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 10 && !(pend(g).player === P0 && pend(g).kind === 'showdownAction'); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  const pickBf = (gg: GameState, bf: number) => { const o = optionIds(gg); return o.includes(String(bf)) ? String(bf) : o.includes(gg.battlefields[bf].objId) ? gg.battlefields[bf].objId : undefined; };
  g = act(g, { type: 'playCard', player: P0, obj: rw });
  for (let i = 0; i < 10 && (g.chain.length || pend(g).inStep); i++) { const d = pend(g); g = d.inStep ? choose(g, d.options!.some(o => o.id === u) ? u : pickBf(g, BF_B) ?? d.options![0].id) : pass(g); }
  assert.equal(locOf(g, u), BF_B);
  for (let i = 0; i < 4 && !(pend(g).player === P0 && pend(g).kind === 'showdownAction'); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: mf });
  for (let i = 0; i < 10 && (g.chain.length || pend(g).inStep); i++) { const d = pend(g); g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : d.options!.some(o => o.id === a) ? a : pickBf(g, BF_B) ?? d.options![0].id) : pass(g); }
  assert.equal(locOf(g, a), BF_B, 'their unit moved away');
  g = drive(g, undefined, 60).g;
  assert.equal(g.players[P1].points, 0, 'no conquer of BF-A');
  assert.notEqual(g.battlefields[BF_A].controller, P1);
});

test('RJ#10729 Not So Fast can\'t counter Mindsplitter\'s play trigger: it chooses a card in hand, not a friendly unit or gear', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1);
  hand(g, P1, 'V(2)');
  const nsf = hand(g, P1, 'Not So Fast');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Mindsplitter'), destination: 'base' } as never);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  assert.ok(chainLabels(g).some(l => /Mindsplitter/.test(l)));
  if (pend(g).player !== P1) g = pass(g);
  const ok = (() => { try { const x = act(g, { type: 'playCard', player: P1, obj: nsf }); return x.pending?.kind === 'chooseTargets' ? optionIds(x).length > 0 : (x.chain.at(-1)?.targets?.flat().length ?? 0) > 0; } catch { return false; } })();
  assert.ok(!ok, 'no legal target for Not So Fast');
});

test('RJ#10730 Virtuoso (Jhin legend): a 4-cost spell countered by Defy is not played (CR 426.1.b) and can\'t be banished — it goes to the trash', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1); setLegend(g, P0, 'Virtuoso');
  const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const ss = hand(g, P0, 'Siphoning Strike');
  g = play(g, P0, ss, { targets: [[e]] });
  for (let i = 0; i < 6 && pend(g).player !== P1; i++) g = pend(g).inStep ? act(g, { type: 'choose', player: pend(g).player, optionIds: [pend(g).kind === 'optional' ? 'yes' : pend(g).options![0].id] }) : pass(g);
  g = play(g, P1, hand(g, P1, 'Defy'), { targets: [[ss]] });
  g = drive(g, gg => gg.pending!.kind === 'optional' ? ['yes'] : undefined).g;
  assert.equal(g.objects[e].damage, 0, 'countered');
  assert.equal(zone(g, ss), 'trash', 'not banished by Virtuoso');
});

test('RJ#10732 Angler Beast uses current Might: a 2-Might unit pumped to 3 stays; a 3-Might unit reduced to 2 is returned', () => {
  let g = S0(); fundAll(g, P0, 12);
  const up = put(g, P1, 'V(2)', BF_A); mod(g, up, { might: 1 });
  const down = put(g, P1, 'V(3)', BF_A); mod(g, down, { might: -1 }); control(g, BF_A, P1);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Angler Beast'), destination: 'base' } as never)).g;
  assert.equal(locOf(g, up), BF_A, 'now 3: stays');
  assert.equal(zone(g, down), 'hand', 'now 2: returned');
});

test('RJ#10733 Overzealous Fan moved into an ongoing combat by my Moonfall becomes a Defender: its "When I defend" triggers', () => {
  const g0 = S0(); fundAll(g0, P0);
  put(g0, P1, 'V(3)', BF_A); control(g0, BF_A, P1);
  const fan = put(g0, P1, 'Overzealous Fan', 'base');
  const a = put(g0, P0, 'V(5)', 'base');
  const mf = hand(g0, P0, 'Moonfall');
  let g = move(g0, P0, [a], BF_A);
  for (let i = 0; i < 8 && !canPlayNow(g, P0, mf); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: mf });
  let asked = false;
  for (let i = 0; i < 16 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g); const o = optionIds(g);
    if (d.inStep && d.player === P1 && d.kind === 'optional') { asked = /Overzealous|kill me/i.test(d.prompt) || asked; g = yes(g); continue; }
    if (d.inStep) { g = choose(g, o.includes(fan) ? fan : o.includes(String(BF_A)) ? String(BF_A) : o.includes(g.battlefields[BF_A].objId) ? g.battlefields[BF_A].objId : o.includes(a) ? a : o[0]); continue; }
    g = pass(g);
  }
  assert.ok(asked || g.log.some(l => /Trigger: Overzealous Fan/.test(l.text)), 'Fan\'s defend trigger');
  assert.equal(zone(g, fan), 'trash', 'Fan killed for its cost');
  assert.equal(locOf(g, a), 'base', 'attacker moved to base');
});

test('RJ#10737 Units can leave the Baron Pit like any battlefield (Baron Nashor may move back to base)', () => {
  let g = S0();
  setRunes(g, P0, 0); addRunes(g, P0, 7, 'chaos'); addRunes(g, P0, 8, 'fury');
  tokens(g, 'Baron Pit');
  const bn = hand(g, P0, 'Baron Nashor');
  g = drive(act(g, { type: 'playCard', player: P0, obj: bn }), gg => { const o = gg.pending!.options?.find(x => /Baron/.test(x.label)); return o ? [o.id] : undefined; }).g;
  const pit = g.battlefields.findIndex(b => g.cards[g.objects[b.objId].cardId].name === 'Baron Pit');
  assert.equal(locOf(g, bn), pit);
  g.objects[bn].exhausted = false;
  assert.ok(moveDests(g, P0, bn).includes('base'), `may move to base (${moveDests(g, P0, bn)})`);
});

test('RJ#10740 A Discipline-buffed unit saved by Guardian Angel keeps the +2 this turn (it never left the board)', () => {
  let g = S0(); fundAll(g, P0, 12);
  const u = put(g, P0, 'V(2)', BF_A, { damage: 2 }); control(g, BF_A, P0);
  const ga = put(g, P0, 'Guardian Angel', 'base'); attachNow(g, ga, u);
  const m0 = mightOf(g, u);
  g = drive(play(g, P0, hand(g, P0, 'Discipline'), { targets: [[u]] })).g;
  assert.equal(mightOf(g, u), m0! + 2, 'buffed');
  g = drive(play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[u]] })).g;
  assert.equal(zone(g, ga), 'trash', 'Guardian Angel killed instead');
  assert.equal(locOf(g, u), 'base', 'saved and recalled');
  assert.equal(g.objects[u].damage, 0, 'healed');
  assert.equal(mightOf(g, u), 2 + 2, 'keeps the Discipline +2 (Guardian Angel bonus gone)');
});

test('RJ#10741 Vilemaw (8) defending: an 8-Might attacker deals combat damage, a 7-Might attacker deals none', () => {
  const run = (atkCard: string) => {
    let { g, atk, def } = attackSetup([atkCard], ['Vilemaw']);
    g = drive(g, undefined, 60).g;
    return { g, a: atk[0], v: def[0] };
  };
  const r8 = run('V(8)');
  assert.equal(zone(r8.g, r8.v), 'trash', '8 Might is not less than Vilemaw\'s: it deals 8, Vilemaw dies');
  const r7 = run('V(7)');
  assert.equal(zone(r7.g, r7.v), 'battlefield', 'Vilemaw survives');
  assert.equal(r7.g.objects[r7.v].damage, 0, 'the 7-Might attacker dealt no combat damage');
  assert.equal(zone(r7.g, r7.a), 'trash');
});

test('RJ#10744 Thrill of the Hunt on Akshan holding a stolen Long Sword: he leaves the board, so control of the gear reverts to its owner and it is no longer attached', () => {
  let g = S0(); fundAll(g, P0, 12);
  const ls = put(g, P1, 'Long Sword', 'base');
  const ak = hand(g, P0, 'Akshan');
  g = act(g, { type: 'playCard', player: P0, obj: ak, destination: 'base' } as never);
  g = drive(g, gg => { const d = gg.pending!; return d.kind === 'optional' ? ['yes'] : d.options!.some(o => o.id === ls) ? [ls] : undefined; }).g;
  assert.equal(g.objects[ls].controller, P0); assert.equal(g.objects[ls].attachedTo, ak);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Thrill of the Hunt') } as never);
  g = drive(g, gg => { const d = gg.pending!; return d.kind === 'optional' ? ['no'] : d.options!.some(o => o.id === ak) ? [ak] : d.options!.some(o => o.id === String(BF_A)) ? [String(BF_A)] : undefined; }).g;
  assert.equal(locOf(g, ak), BF_A, 'Akshan replayed');
  assert.equal(g.objects[ls].controller, P1, 'control reverts (Akshan left the board)');
  assert.notEqual(g.objects[ls].attachedTo, ak, 'not attached to the new Akshan');
});

test('RJ#10746 Guardian Angel: Equip (pay [C], choose a unit you control) attaches it; when the unit would die, Guardian Angel is killed instead (it does not stay attached)', () => {
  let g = S0(); fundAll(g, P0, 12);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const ga = put(g, P0, 'Guardian Angel', 'base');
  const eq = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === ga);
  assert.ok(eq, 'Equip can be activated');
  g = drive(act(g, eq!), gg => gg.pending!.options?.some(o => o.id === u) ? [u] : undefined).g;
  assert.equal(g.objects[ga].attachedTo, u, 'attached');
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === ga), 'Equip can\'t be activated while attached');
  g = drive(play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[u]] })).g;
  assert.equal(zone(g, u), 'base', 'unit saved');
  assert.equal(zone(g, ga), 'trash', 'Guardian Angel killed instead (card text)');
});

test('RJ#10753 Thrill of the Hunt in response to Unchecked Power: the unit is replayed to a battlefield and is still dealt 12', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const u = put(g, P0, 'V(5)', BF_A); control(g, BF_A, P0);
  const th = hand(g, P0, 'Thrill of the Hunt');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Unchecked Power') } as never);
  for (let i = 0; i < 6 && pend(g).player !== P0; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(canPlayNow(g, P0, th), 'Reaction: may respond');
  g = act(g, { type: 'playCard', player: P0, obj: th } as never);
  let replayed = false;
  g = drive(g, gg => { const d = gg.pending!; if (d.kind === 'optional') return ['no']; if (d.options!.some(o => o.id === u)) return [u]; if (d.options!.some(o => o.id === String(BF_B))) { replayed = true; return [String(BF_B)]; } return undefined; }).g;
  assert.ok(replayed, 'replayed to a battlefield of my choice');
  assert.equal(zone(g, u), 'trash', 'still dealt 12 at its new battlefield');
});

test('RJ#10754 Defy can\'t counter Blind Fury (printed [4] + 2 power: more than [A]); with no other spell on the chain it can\'t be played', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1);
  put(g, P1, 'V(1)', 'deckTop');
  const df = hand(g, P1, 'Defy');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Blind Fury') } as never);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  assert.equal(g.chain.length, 1);
  if (pend(g).player !== P1) g = pass(g);
  assert.equal(canPlayNow(g, P1, df), false);
});

test('RJ#10756 Lonely Poro died alone: a friendly unit arriving at its battlefield in response to the Deathknell doesn\'t stop the draw (checked at death)', () => {
  let g = S0(); fundAll(g, P0, 12);
  const poro = put(g, P0, 'Lonely Poro', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', 'deckTop');
  g = play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[poro]] });
  for (let i = 0; i < 8 && !chainLabels(g).some(l => /Lonely Poro/.test(l)); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(zone(g, poro), 'trash');
  assert.ok(chainLabels(g).some(l => /Lonely Poro/.test(l)), 'Deathknell on the chain');
  put(g, P0, 'V(3)', BF_A); // a friendly unit arrives in response (e.g. Rengar, Trophy Hunter's Ambush)
  const h0 = g.players[P0].hand.length;
  g = drive(g).g;
  assert.equal(g.players[P0].hand.length, h0 + 1, 'drew 1');
});

test('RJ#10758 Windsinger played from hand to base: its play trigger may return a unit (3 Might or less) at any battlefield', () => {
  let g = S0(); fundAll(g, P0, 12);
  const there = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  const ws = hand(g, P0, 'Windsinger');
  g = act(g, { type: 'playCard', player: P0, obj: ws, destination: 'base' } as never);
  g = drive(g, gg => { const d = gg.pending!; if (d.kind === 'optional') return ['yes']; if (d.options!.some(o => o.id === there)) return [there]; return undefined; }).g;
  assert.equal(locOf(g, ws), 'base');
  assert.equal(zone(g, there), 'hand', 'returned');
});

test('RJ#10760 Rift Herald\'s Deathknell ignores only the Energy cost: the Power cost must still be paid (no runes → the unit can\'t be played)', () => {
  const run = (power: number) => {
    const g0 = S0(); fundAll(g0, P1);
    const rh = put(g0, P0, 'Rift Herald', BF_A); control(g0, BF_A, P0);
    const ed = hand(g0, P0, 'Elder Dragon');
    setRunes(g0, P0, 0); if (power) addRunes(g0, P0, power, 'body');
    const g = drive(play(S0tp(g0, P1), P1, hand(g0, P1, 'Hidden Blade'), { targets: [[rh]] }), gg => gg.pending!.kind === 'chooseCards' && gg.pending!.options!.some(o => o.id === ed) ? [ed] : undefined).g;
    assert.equal(zone(g, rh), 'trash');
    return { g, ed };
  };
  const ok = run(4);
  assert.equal(zone(ok.g, ok.ed), 'base', 'played, paying its Power');
  assert.ok(ok.g.players[P0].runesInPlay.length < 4 || readyRunes(ok.g, P0) < 4, 'power runes were used');
  const none = run(0);
  assert.equal(zone(none.g, none.ed), 'hand', 'Power cost unpayable: not played');
});

test('RJ#10761 Charm an enemy Sharkling into my battlefield with Mutated Mouser: Sharkling\'s controller attacks (Assault 4 active), Mouser defends (Shield 2 active)', () => {
  const g0 = S0(); fundAll(g0, P0);
  const m = put(g0, P0, 'Mutated Mouser', BF_A); control(g0, BF_A, P0);
  const s = put(g0, P1, 'Sharkling', 'base');
  let g = play(g0, P0, hand(g0, P0, 'Charm'), { targets: [[s]] });
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? answer(g, { locations: [BF_A] }) : pass(g);
  assert.equal(locOf(g, s), BF_A);
  assert.equal(g.showdown?.attacker, P1, 'the Charmed unit\'s controller is the Attacker');
  assert.equal(g.objects[s].combatRole, 'attacker');
  assert.equal(g.objects[m].combatRole, 'defender');
  assert.equal(mightOf(g, s), 1 + 4, 'Assault 4 active');
  assert.equal(mightOf(g, m), 1 + 2, 'Shield 2 active');
});

test('RJ#10762 My Moonfall moves an enemy Vi, Peacekeeper into my battlefield: her controller is the Attacker, so her "When I attack" stun triggers', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(6)', BF_A); control(g, BF_A, P0);
  const vi = put(g, P1, 'unl-176-219', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Moonfall') } as never);
  g = drive(g, gg => { const d = gg.pending!; const o = optionIds(gg); if (d.kind === 'optional') return ['yes']; if (o.includes(vi)) return [vi]; if (o.includes(String(BF_A))) return [String(BF_A)]; if (o.includes(gg.battlefields[BF_A].objId)) return [gg.battlefields[BF_A].objId]; if (o.includes(u)) return [u]; return undefined; }, 60).g;
  assert.ok(g.log.some(l => /Trigger: Vi/.test(l.text)), 'Vi\'s attack trigger fired');
  assert.ok(g.objects[u].stunned || g.log.some(l => /stun/i.test(l.text) && /V\(6\)/.test(l.text)), 'my unit stunned');
});

test('RJ#10769 Star-Crossed needs both a friendly and an enemy unit: with no friendly unit it can\'t be played', () => {
  const g = S0(); fundAll(g, P0, 12);
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const sc = hand(g, P0, 'Star-Crossed');
  assert.equal(canPlayNow(g, P0, sc), false, 'no friendly unit');
  put(g, P0, 'V(1)', 'base');
  assert.equal(canPlayNow(g, P0, sc), true, 'playable once I have a unit');
});

test('RJ#10771 Fizz\'s trigger chooses its trash spell when it goes on the chain: Disposal Order recycling that spell in response means nothing is played (no new choice)', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1);
  put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  const ray = put(g, P0, 'Hextech Ray', 'trash');
  const dis = put(g, P0, 'Discipline', 'trash');
  const pickP0: Pick = gg => { const d = gg.pending!; if (d.kind === 'optional') return ['yes']; const o = optionIds(gg); return o.includes(ray) ? [ray] : o.includes(dis) ? [dis] : undefined; };
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Fizz'), destination: 'base' } as never);
  for (let i = 0; i < 10 && !(chainLabels(g).some(l => /Fizz/.test(l)) && pend(g).player === P1 && !pend(g).inStep); i++) {
    const d = pend(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: pickP0(g) ?? [d.options![0].id] }) : pass(g);
  }
  assert.ok(chainLabels(g).some(l => /Fizz/.test(l)), 'Fizz trigger on the chain');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Disposal Order') } as never);
  g = drive(g, gg => { const d = gg.pending!; if (d.player === P1) { const r = d.options?.find(o => /recycle|trash/i.test(o.label)); if (r) return [r.id]; if (optionIds(gg).includes(ray)) return [ray]; } return pickP0(gg); }).g;
  assert.equal(zone(g, ray), 'mainDeck', 'Ray recycled by Disposal Order');
  assert.equal(zone(g, dis), 'trash', 'Fizz does not choose another spell');
});

test('RJ#10773 Keeper\'s Verdict in the showdown on the attacking Rengar: he goes to his owner\'s Main Deck, no combat, the attacker doesn\'t conquer', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); fundAll(g, P1);
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const r = put(g, P1, 'unl-024-219', 'base');
  const kv = hand(g, P0, 'Keeper\'s Verdict');
  g = move(g, P1, [r], BF_A);
  for (let i = 0; i < 10 && !(pend(g).player === P0 && !pend(g).inStep && canPlayNow(g, P0, kv)); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(canPlayNow(g, P0, kv), 'Action: playable in the showdown');
  g = act(g, { type: 'playCard', player: P0, obj: kv } as never);
  g = drive(g, gg => optionIds(gg).includes(r) ? [r] : undefined, 60).g;
  assert.equal(zone(g, r), 'mainDeck');
  assert.equal(g.battlefields[BF_A].controller, P0, 'I keep the battlefield');
  assert.equal(g.players[P1].points, 0);
});

test('RJ#10776 Four Akshans trade a Long Sword back and forth; the last one (opponent\'s) dies: control goes to the newest remaining effect — my second Akshan', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const ls = put(g, P0, 'Long Sword', 'base');
  const playAk = (gg: GameState, p: typeof P0) => {
    gg = S0tp(gg, p); fundAll(gg, p, 12);
    const ak = hand(gg, p, 'Akshan');
    gg = act(gg, { type: 'playCard', player: p, obj: ak, destination: 'base' } as never);
    gg = drive(gg, x => { const d = x.pending!; return d.kind === 'optional' ? ['yes'] : d.options!.some(o => o.id === ls) ? [ls] : undefined; }).g;
    assert.equal(gg.objects[ls].controller, p, 'taken');
    return { gg, ak };
  };
  let r = playAk(g, P1); g = r.gg;          // opponent takes my sword
  r = playAk(g, P0); g = r.gg; const mine2 = r.ak; // I take it back
  r = playAk(g, P1); g = r.gg;             // they take it again
  r = playAk(g, P0); g = r.gg;             // I take it again
  r = playAk(g, P1); g = r.gg; const theirs = r.ak; // they take it once more
  g = S0tp(g, P0); fundAll(g, P0, 12);
  g = drive(play(g, P0, hand(g, P0, 'KillDraw'), { targets: [[theirs]] })).g;
  assert.equal(zone(g, theirs), 'trash');
  assert.equal(g.objects[ls].controller, P0, 'newest remaining Akshan effect is mine');
  void mine2;
});

test('RJ#10778 Two Akshan steals of one gear: the newer leaving restores the older thief\'s control; both gone → its owner controls it', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const ls = put(g, P0, 'Long Sword', 'base');
  const playAk = (gg: GameState, p: typeof P0) => {
    gg = S0tp(gg, p); fundAll(gg, p, 12);
    const ak = hand(gg, p, 'Akshan');
    gg = act(gg, { type: 'playCard', player: p, obj: ak, destination: 'base' } as never);
    gg = drive(gg, x => { const d = x.pending!; return d.kind === 'optional' ? ['yes'] : d.options!.some(o => o.id === ls) ? [ls] : undefined; }).g;
    return { gg, ak };
  };
  let r = playAk(g, P1); g = r.gg; const a1 = r.ak;
  r = playAk(g, P0); g = r.gg; const a2 = r.ak;
  assert.equal(g.objects[ls].controller, P0);
  g = S0tp(g, P0); fundAll(g, P0, 12);
  g = drive(play(g, P0, hand(g, P0, 'KillDraw'), { targets: [[a2]] })).g;
  assert.equal(g.objects[ls].controller, P1, 'older thief regains control');
  g = drive(play(g, P0, hand(g, P0, 'KillDraw'), { targets: [[a1]] })).g;
  assert.equal(g.objects[ls].controller, P0, 'both gone: owner');
});

test('RJ#10781 Guardian Angel is a replacement effect: it never goes on the chain, so there is no window to respond before the recall', () => {
  let g = S0(); fundAll(g, P0, 12);
  const u = put(g, P0, 'V(2)', BF_A, { damage: 2 }); control(g, BF_A, P0);
  const ga = put(g, P0, 'Guardian Angel', 'base'); attachNow(g, ga, u);
  g = play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[u]] });
  const labels: string[] = [];
  for (let i = 0; i < 10 && (g.chain.length || pend(g).inStep); i++) { labels.push(...chainLabels(g)); g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g); }
  assert.equal(locOf(g, u), 'base', 'saved and recalled');
  assert.equal(g.chain.length, 0);
  assert.ok(!labels.some(l => /Guardian Angel/.test(l)), `never on the chain (${labels})`);
});

test('RJ#10784 Gust on a 2-Might unit at Abandoned Hall; its controller responds with Combat Experience: the Hall\'s +1 resolves above Gust → 4 Might, Gust fails', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1); setBattlefieldCard(g, BF_A, 'Abandoned Hall');
  const u = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Gust'), { targets: [[u]] });
  for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = play(g, P1, hand(g, P1, 'Combat Experience'), { targets: [[u]] });
  g = drive(g, gg => { const d = gg.pending!; if (d.kind === 'optional') return [d.player === P1 ? 'yes' : 'no']; if (d.player === P1 && optionIds(gg).includes(u)) return [u]; return undefined; }).g;
  assert.equal(locOf(g, u), BF_A, 'Gust failed: the unit stays');
  assert.equal(mightOf(g, u), 4);
});

test('RJ#10786 Janna in response to Elder Dragon\'s play trigger: her heal resolves first, then the Dragon\'s 1 damage still kills my unit', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); setRunes(g, P1, 0); addRunes(g, P1, 12, 'order'); addRunes(g, P1, 4, 'body');
  const u = put(g, P0, 'V(5)', BF_A, { damage: 1 }); control(g, BF_A, P0);
  const ja = hand(g, P0, 'Janna');
  const ed = hand(g, P1, 'Elder Dragon');
  g = act(g, { type: 'playCard', player: P1, obj: ed, destination: 'base' } as never);
  for (let i = 0; i < 10 && !(chainLabels(g).some(l => /Elder Dragon/.test(l) && /trigger/.test(l)) && pend(g).player === P0 && !pend(g).inStep); i++) {
    const d = pend(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: optionIds(g).includes(u) ? [u] : [d.options![0].id] }) : pass(g);
  }
  assert.ok(chainLabels(g).some(l => /Elder Dragon/.test(l)), `Dragon trigger on the chain (${chainLabels(g)})`);
  g = act(g, { type: 'playCard', player: P0, obj: ja, destination: BF_A } as never);
  g = drive(g, gg => gg.pending!.kind === 'optional' ? ['no'] : undefined).g;
  assert.equal(locOf(g, ja), BF_A, 'Janna played');
  assert.equal(zone(g, u), 'trash', 'healed, then dealt 1 — lethal from Elder Dragon');
});

test('RJ#10788 Not So Fast counters Elder Dragon\'s play trigger that chose three of my units: all three are protected (one chain item)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); setRunes(g, P1, 0); addRunes(g, P1, 12, 'order'); addRunes(g, P1, 4, 'body');
  const us = [put(g, P0, 'V(5)', BF_A), put(g, P0, 'V(5)', BF_B), put(g, P0, 'V(5)', 'base')]; control(g, BF_A, P0); control(g, BF_B, P0);
  const nsf = hand(g, P0, 'Not So Fast');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Elder Dragon'), destination: 'base' } as never);
  for (let i = 0; i < 12 && !(chainLabels(g).some(l => /trigger:Elder Dragon/.test(l)) && pend(g).player === P0 && !pend(g).inStep); i++) {
    const d = pend(g); const o = optionIds(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: d.kind === 'chooseTargets' ? o.filter(x => us.includes(x)).slice(0, d.max ?? 3) : [o[0]] }) : pass(g);
  }
  const top = g.chain.at(-1)!;
  assert.equal((top.targets ?? []).flat().filter(t => us.includes(t as string)).length, 3, `three of my units chosen (${JSON.stringify(top.targets)})`);
  g = act(g, { type: 'playCard', player: P0, obj: nsf } as never);
  g = drive(g, gg => optionIds(gg).includes(top.id) ? [top.id] : undefined).g;
  assert.ok(us.every(u => g.objects[u].zone !== 'trash' && g.objects[u].damage === 0), 'all three unharmed');
});

test('RJ#10792 A unit replayed by Thrill of the Hunt enters exhausted (default), even if it was ready', () => {
  let g = S0(); fundAll(g, P0, 12);
  const u = put(g, P0, 'V(3)', 'base');
  assert.equal(g.objects[u].exhausted, false);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Thrill of the Hunt') } as never);
  g = drive(g, gg => { const d = gg.pending!; if (d.kind === 'optional') return ['no']; const o = optionIds(gg); return o.includes(u) ? [u] : o.includes(String(BF_A)) ? [String(BF_A)] : undefined; }).g;
  assert.equal(locOf(g, u), BF_A);
  assert.equal(g.objects[u].exhausted, true, 'enters exhausted');
});

test('RJ#10797 Herald of Spring (Hunt) holding Reckoner\'s Arena: Hunt triggers for the hold and again as a conquer effect via the Arena — 2 XP', () => {
  let g = S0({ tp: P1, bfA: "Reckoner's Arena" });
  put(g, P0, 'Herald of Spring', BF_A); control(g, BF_A, P0);
  const x0 = g.players[P0].xp;
  g = endTurn(g);
  for (let i = 0; i < 20; i++) { const d = g.pending!; if (d.kind === 'mainAction') break; g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : d.options![0].id) : pass(g); }
  assert.equal(g.activePlayer, P0);
  assert.equal(g.players[P0].xp - x0, 2, 'Hunt on hold + Hunt as conquer effect');
});

test('RJ#10800 Thrill of the Hunt (first card) on Darius, Trifarian: he is replayed as my second card, so he gets +2 and readies; with a card played before, he doesn\'t', () => {
  const run = (before: boolean) => {
    let g = S0(); fundAll(g, P0, 12);
    const d = put(g, P0, 'ogn-027-298', 'base');
    if (before) g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'V(1)'), destination: 'base' } as never)).g;
    const m0 = chars(g, d).might!;
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Thrill of the Hunt') } as never);
    g = drive(g, gg => { const dd = gg.pending!; if (dd.kind === 'optional') return ['yes']; const o = optionIds(gg); return o.includes(d) ? [d] : o.includes(String(BF_A)) ? [String(BF_A)] : undefined; }).g;
    assert.equal(locOf(g, d), BF_A);
    return { m: mightOf(g, d)! - m0, ready: !g.objects[d].exhausted };
  };
  assert.deepEqual(run(false), { m: 2, ready: true }, 'second card: +2 and ready');
  assert.deepEqual(run(true), { m: 0, ready: false }, 'third card: nothing');
});

test('RJ#10802 Red Brambleback with Trinity Force + Skyfall of Areion holding Reckoner\'s Arena: 3 points (Brambleback doesn\'t double the Arena\'s activation — no conquer)', () => {
  let g = S0({ tp: P1, bfA: "Reckoner's Arena" });
  fundAll(g, P0);
  const u = put(g, P0, 'Red Brambleback', BF_A); control(g, BF_A, P0);
  attachNow(g, put(g, P0, 'Trinity Force', 'base'), u);
  attachNow(g, put(g, P0, 'Skyfall of Areion', 'base'), u);
  g = endTurn(g);
  for (let i = 0; i < 30; i++) { const d = g.pending!; if (d.kind === 'mainAction') break; g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : d.options![0].id) : pass(g); }
  assert.equal(g.activePlayer, P0);
  assert.equal(g.players[P0].points, 3);
});

test('RJ#10803 Playing Elder Dragon (and its damage trigger) starts no showdown', () => {
  let g = S0(); setRunes(g, P0, 0); addRunes(g, P0, 12, 'order'); addRunes(g, P0, 4, 'body');
  put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Elder Dragon'), destination: 'base' } as never);
  let sd = false;
  for (let i = 0; i < 12 && (g.chain.length || pend(g).inStep); i++) { sd = sd || !!g.showdown; g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g); }
  assert.ok(!sd && !g.showdown, 'no showdown');
  assert.equal(pend(g).kind, 'mainAction');
});

test('RJ#10804 Smoke and Mirrors needs two units I control at different locations: with one (or both at the same place) it can\'t be played', () => {
  const g = S0(); fundAll(g, P0, 12);
  const sm = hand(g, P0, 'Smoke and Mirrors');
  put(g, P0, 'V(1)', 'base');
  assert.equal(canPlayNow(g, P0, sm), false, 'one unit');
  put(g, P0, 'V(2)', 'base');
  assert.equal(canPlayNow(g, P0, sm), false, 'two units, same location');
  put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  assert.equal(canPlayNow(g, P0, sm), true, 'units at different locations');
});

test('RJ#10805 Edge of Night played from face down attaches through its play trigger: no Equip [C] is paid (no runes needed)', () => {
  let g = S0(); setRunes(g, P0, 0);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const en = put(g, P0, 'Edge of Night', { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P0, obj: en } as never);
  g = drive(g, gg => optionIds(gg).includes(u) ? [u] : undefined).g;
  assert.equal(g.objects[en].attachedTo, u, 'attached with no power paid');
});

test('RJ#10806 Hidden Zhonya\'s Hourglass played in response to my Sprite\'s Temporary trigger: the Sprite is saved (healed, exhausted, recalled)', () => {
  const g0 = S0({ tp: P1 }); fundAll(g0, P0); tokens(g0, 'Sprite');
  const sp = put(g0, P0, 'Sprite', BF_A, { token: true }); control(g0, BF_A, P0);
  const z = put(g0, P0, 'Zhonya\'s Hourglass', { facedown: BF_A });
  let g = endTurn(g0, P1);
  assert.ok(g.chain.length > 0, 'Temporary trigger on the chain');
  g = play(g, P0, z);
  g = drive(g).g;
  assert.equal(zone(g, z), 'trash', 'Hourglass killed instead');
  assert.equal(locOf(g, sp), 'base', 'Sprite saved and recalled');
});

test('RJ#10811 Hard Bargain ("Counter a spell…") can\'t be played with no spell on the chain', () => {
  const g = S0(); fundAll(g, P0, 12);
  const hb = hand(g, P0, 'Hard Bargain');
  assert.equal(canPlayNow(g, P0, hb), false);
});

test('RJ#10812 At 7 points, Lucian with one Trinity Force + Skyfall of Areion conquers: the conquer point is replaced by a draw (not all battlefields scored), but Trinity Force\'s triggered point wins', () => {
  const g0 = S0();
  const lu = put(g0, P0, 'Lucian, Merciless', 'base');
  for (const n of ['Trinity Force', 'Skyfall of Areion']) attachNow(g0, put(g0, P0, n, 'base'), lu);
  put(g0, P1, 'V(1)', BF_A); control(g0, BF_A, P1);
  put(g0, P1, 'V(1)', BF_B); control(g0, BF_B, P1);
  g0.players[P0].points = 7;
  const g = drive(move(g0, P0, [lu], BF_A)).g;
  assert.equal(g.winner, P0);
});

test('RJ#10813 Elder Dragon\'s trigger chose my units at two battlefields; Flash moves both to base in response: neither is dealt damage (no longer meets "one at each location")', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); setRunes(g, P1, 0); addRunes(g, P1, 12, 'order'); addRunes(g, P1, 4, 'body');
  const a = put(g, P0, 'V(5)', BF_A), b = put(g, P0, 'V(5)', BF_B); control(g, BF_A, P0); control(g, BF_B, P0);
  const fl = hand(g, P0, 'Flash');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Elder Dragon'), destination: 'base' } as never);
  for (let i = 0; i < 12 && !(chainLabels(g).some(l => /trigger:Elder Dragon/.test(l)) && pend(g).player === P0 && !pend(g).inStep); i++) {
    const d = pend(g); const o = optionIds(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: d.kind === 'chooseTargets' ? o.filter(x => x === a || x === b) : [o[0]] }) : pass(g);
  }
  assert.equal((g.chain.at(-1)!.targets ?? []).flat().length, 2, 'both chosen');
  g = act(g, { type: 'playCard', player: P0, obj: fl } as never);
  g = drive(g, gg => { const o = optionIds(gg); return o.includes(a) && o.includes(b) ? [a, b] : undefined; }).g;
  assert.equal(locOf(g, a), 'base'); assert.equal(locOf(g, b), 'base');
  assert.equal(zone(g, a), 'base'); assert.equal(zone(g, b), 'base', 'both survive');
  assert.equal(g.objects[a].damage + g.objects[b].damage, 0);
});

test('RJ#10814 Blue Sentinel holding Startipped Peak: the Peak\'s and the Sentinel\'s own hold effects each trigger twice; each Peak trigger is optional (0-2 runes channelled)', () => {
  let g = S0({ tp: P1, bfA: 'Startipped Peak' });
  put(g, P0, 'Blue Sentinel', BF_A); control(g, BF_A, P0);
  const n = g.log.length; const r0 = g.players[P0].runesInPlay.length;
  g = endTurn(g);
  let peakAsks = 0;
  for (let i = 0; i < 30; i++) { const d = g.pending!; if (d.kind === 'mainAction') break; if (d.kind === 'optional' && /channel/i.test(d.prompt)) { peakAsks++; g = choose(g, peakAsks === 1 ? 'yes' : 'no'); continue; } g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : d.options![0].id) : pass(g); }
  const trig = g.log.slice(n).map(l => l.text).filter(t => /^Trigger:/.test(t));
  assert.equal(trig.filter(t => /Startipped Peak/.test(t)).length, 1, `the accepted Peak trigger goes on the chain; the declined one doesn't (principle 11) (${trig})`);
  assert.equal(trig.filter(t => /Blue Sentinel/.test(t)).length, 2, 'Sentinel\'s own hold twice');
  assert.equal(peakAsks, 2, 'the Peak triggers twice; each asks separately (at finalization)');
  assert.ok(g.players[P0].runesInPlay.length >= r0 + 1, 'one rune channelled (the other declined)');
});

test('RJ#10820 Scuttle Crab Gusted in response to its play trigger: the draw still resolves', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', 'deckTop');
  const sc = hand(g, P0, 'Scuttle Crab');
  g = act(g, { type: 'playCard', player: P0, obj: sc, destination: BF_A } as never);
  for (let i = 0; i < 6 && !(chainLabels(g).some(l => /Scuttle Crab/.test(l)) && pend(g).player === P1); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  const h0 = g.players[P0].hand.length;
  g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[sc]] });
  g = drive(g).g;
  assert.equal(zone(g, sc), 'hand', 'Crab returned');
  assert.equal(g.players[P0].hand.length, h0 + 2, 'Crab back in hand + the draw');
});

test('RJ#10822 Star-Crossed with Repeat (Temporal Portal): each execution has its own choices — the same ally (gone for the 2nd) and two different enemies → all three returned', () => {
  let g = S0(); fundAll(g, P0, 12);
  const f = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const e1 = put(g, P1, 'V(3)', BF_B), e2 = put(g, P1, 'V(4)', 'base'); control(g, BF_B, P1);
  const tp = put(g, P0, 'Temporal Portal', 'base');
  g = drive(act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === tp)!)).g;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Star-Crossed') } as never);
  let n = 0;
  g = drive(g, gg => { const d = gg.pending!; if (d.kind === 'optional') return ['yes']; const o = optionIds(gg); if (d.kind === 'chooseTargets' && (o.includes(e1) || o.includes(e2))) { n++; return [n === 1 && o.includes(e1) ? e1 : e2]; } return o.includes(f) ? [f] : undefined; }).g;
  assert.equal(zone(g, f), 'hand');
  assert.equal(zone(g, e1), 'hand');
  assert.equal(zone(g, e2), 'hand', 'second execution returned the other enemy');
});

test('RJ#10823 Akshan stealing Sprite Fountain doesn\'t play a Sprite (gaining control isn\'t playing it)', () => {
  let g = S0(); fundAll(g, P0, 12); tokens(g, 'Sprite');
  const sf = put(g, P1, 'Sprite Fountain', 'base');
  const ak = hand(g, P0, 'Akshan');
  g = act(g, { type: 'playCard', player: P0, obj: ak, destination: 'base' } as never);
  g = drive(g, x => { const d = x.pending!; return d.kind === 'optional' ? ['yes'] : d.options!.some(o => o.id === sf) ? [sf] : undefined; }).g;
  assert.equal(g.objects[sf].controller, P0, 'stolen');
  assert.equal(Object.values(g.objects).filter(o => g.cards[o.cardId]?.name === 'Sprite' && ['base', 'battlefield'].includes(o.zone)).length, 0, 'no Sprite played');
});

test('RJ#10826 Traveling Merchant and Yasuo, Remorseful attack together: the Merchant\'s move trigger resolves before Yasuo becomes an attacker — never on the chain together', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const tm = put(g, P0, 'Traveling Merchant', 'base'), y = put(g, P0, 'Yasuo, Remorseful', 'base');
  hand(g, P0, 'V(1)'); put(g, P0, 'V(1)', 'deckTop');
  g = move(g, P0, [tm, y], BF_A);
  const seen: string[][] = [];
  for (let i = 0; i < 20 && pend(g).kind !== 'assignDamage' && pend(g).kind !== 'mainAction'; i++) { seen.push(chainLabels(g)); g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g); }
  assert.ok(seen.some(c => c.some(l => /Traveling Merchant/.test(l))), 'Merchant trigger seen');
  assert.ok(seen.some(c => c.some(l => /Yasuo/.test(l))), 'Yasuo trigger seen');
  assert.ok(!seen.some(c => c.some(l => /Traveling Merchant/.test(l)) && c.some(l => /Yasuo/.test(l))), 'never together');
});

test('RJ#10827 Galio, Indefatigable (6, Tank) attacking deals no combat damage but takes part: the 3-Might defender survives, Galio survives 3 damage', () => {
  let { g, atk, def } = attackSetup(['unl-171-219'], ['V(3)']);
  g = drive(g, undefined, 60).g;
  assert.equal(zone(g, def[0]), 'battlefield', 'defender took no damage');
  assert.equal(zone(g, atk[0]), 'base', 'Galio survived and was recalled (no result)');
});

test('RJ#10838 Pyke hidden at Battlefield A can only be played to Battlefield A (not B, not base)', () => {
  const g = S0(); fundAll(g, P0, 12);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  const py = put(g, P0, 'unl-028-219', { facedown: BF_A });
  assert.deepEqual(playDests(g, P0, py).map(String), [String(BF_A)]);
});

test('RJ#10839 Jax (Equipment have Quick-Draw): an Equipment already on the board can\'t be attached at Reaction speed — only Equip, in an open main phase', () => {
  let g = S0(); fundAll(g, P0, 12);
  put(g, P0, 'sfd-054-221', 'base');
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(5)', BF_B); control(g, BF_B, P1);
  const ls = put(g, P0, 'Long Sword', 'base');
  const canEquip = (gg: GameState) => legal(gg, P0, 'activate').some(a => a.type === 'activate' && a.obj === ls);
  assert.ok(canEquip(g), 'Equip available in the open main phase');
  g = play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[e]] });
  assert.ok(g.chain.length > 0);
  assert.equal(canEquip(g), false, 'not while a chain exists');
  void u;
});

test('RJ#10840 Fiora, Victorious (+2 Equipment) defending alone at Forbidding Waste: 4 + 2 - 2 = 4, not Mighty — her own "while Mighty" Shield can\'t keep her Mighty (CR 478.4)', () => {
  const g0 = S0({ tp: P0 }); setBattlefieldCard(g0, BF_A, 'Forbidding Waste');
  const f = put(g0, P1, 'ogn-232-298', BF_A); control(g0, BF_A, P1);
  attachNow(g0, put(g0, P1, 'Trinity Force', 'base'), f);
  assert.equal(mightOf(g0, f), 6, 'before combat: 6 (Mighty)'); assert.ok(hasKeyword(g0, f, 'Shield'));
  const a = put(g0, P0, 'V(1)', 'base');
  let g = move(g0, P0, [a], BF_A);
  for (let i = 0; i < 4 && !g.objects[f].combatRole; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(g.objects[f].combatRole, 'defender');
  assert.equal(mightOf(g, f), 4, 'not Mighty: no Shield');
  assert.equal(hasKeyword(g, f, 'Shield'), false);
});

test('RJ#10842 Acceptable Losses (each player chooses) can be played with no gear on the board; it does nothing', () => {
  let g = S0(); fundAll(g, P0, 12);
  const al = hand(g, P0, 'Acceptable Losses');
  assert.ok(canPlayNow(g, P0, al), 'playable with no gear');
  g = drive(act(g, { type: 'playCard', player: P0, obj: al } as never)).g;
  assert.equal(zone(g, al), 'trash');
});

test('RJ#10843 Imperial Decree doesn\'t look back: a unit damaged before it was played survives; damaged again afterwards, it dies', () => {
  let g = S0(); fundAll(g, P0, 15);
  const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g = drive(play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[e]] })).g;
  assert.equal(g.objects[e].damage, 3);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Imperial Decree') } as never)).g;
  assert.equal(zone(g, e), 'battlefield', 'earlier damage doesn\'t trigger it');
  g = drive(play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[e]] })).g;
  assert.equal(zone(g, e), 'trash', 'new damage: killed');
});

test('RJ#10844 Deadly Flourish, then Lotus Trap in response on the same enemy: the Trap resolves first and doubles the 3 → 6', () => {
  let g = S0(); fundAll(g, P0, 15);
  const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Deadly Flourish'), { targets: [[e]] });
  for (let i = 0; i < 3 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  assert.equal(g.chain.length, 1);
  g = play(g, P0, hand(g, P0, 'Lotus Trap'), { targets: [[e]] });
  g = drive(g).g;
  assert.equal(g.objects[e].damage, 6);
});

test('RJ#10845 Not So Fast counters an enemy Blitzcrank\'s play trigger that chose my unit: my unit isn\'t moved', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1, 12);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const mine = put(g, P0, 'V(2)', BF_B); control(g, BF_B, P0);
  const bz = hand(g, P1, 'Blitzcrank');
  g = act(g, { type: 'playCard', player: P1, obj: bz, destination: BF_A } as never);
  for (let i = 0; i < 8 && !(chainLabels(g).some(l => /Blitzcrank/.test(l)) && pend(g).player === P0 && !pend(g).inStep); i++) {
    const d = pend(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: d.kind === 'optional' ? ['yes'] : optionIds(g).includes(mine) ? [mine] : [d.options![0].id] }) : pass(g);
  }
  const top = g.chain.at(-1)!;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Not So Fast') } as never);
  g = drive(g, gg => optionIds(gg).includes(top.id) ? [top.id] : undefined).g;
  assert.equal(locOf(g, mine), BF_B, 'not moved');
});

test('RJ#10849 A ready unit moved to base by Flash stays ready (a spell move isn\'t a Standard Move)', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Flash') } as never);
  g = drive(g, gg => optionIds(gg).includes(u) ? [u] : undefined).g;
  assert.equal(locOf(g, u), 'base');
  assert.equal(g.objects[u].exhausted, false);
});

test('RJ#10851 My Irresistible Faefolk moves into my own battlefield and pulls in an enemy Vi, Peacekeeper: Vi\'s controller applied Contested → attacker, her stun triggers', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(6)', BF_A); control(g, BF_A, P0);
  const ff = put(g, P0, 'Irresistible Faefolk', 'base');
  const vi = put(g, P1, 'unl-176-219', 'base');
  g = move(g, P0, [ff], BF_A);
  g = drive(g, gg => { const d = gg.pending!; const o = optionIds(gg); if (d.kind === 'optional') return ['yes']; if (o.includes(vi)) return [vi]; if (o.includes(u)) return [u]; return undefined; }, 60).g;
  assert.ok(g.log.some(l => /Trigger: Vi/.test(l.text)), 'Vi\'s attack trigger fired');
});

test('RJ#10853 Rocket Barrage deals 4 to Yone (5) in base, then Frigid Touch -2: the existing damage is now lethal and he dies', () => {
  let g = S0(); fundAll(g, P0, 15);
  const y = put(g, P1, 'sfd-116-221', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Rocket Barrage') } as never);
  g = drive(g, gg => { const d = gg.pending!; if (d.kind === 'optional') return ['no']; const m = d.options?.find(o => /Deal 4/i.test(o.label)); if (m) return [m.id]; return optionIds(gg).includes(y) ? [y] : undefined; }).g;
  assert.equal(g.objects[y].damage, 4); assert.equal(zone(g, y), 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Frigid Touch') } as never);
  g = drive(g, gg => { const d = gg.pending!; if (d.kind === 'optional') return ['no']; return optionIds(gg).includes(y) ? [y] : undefined; }).g;
  assert.equal(zone(g, y), 'trash');
});

test('RJ#10854 Smite vs Guardian Angel: the affected unit\'s controller orders the replacements; Guardian Angel first saves it (no death left to banish)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const ga = put(g, P0, 'Guardian Angel', 'base'); attachNow(g, ga, u);
  g = play(g, P1, hand(g, P1, 'Smite'), { targets: [[u]] });
  let asked = false;
  g = drive(g, gg => { const d = gg.pending!; if (d.player === P0) { const o = d.options!.find(x => /Guardian Angel/i.test(x.label)); if (o) { asked = true; return [o.id]; } } return undefined; }).g;
  assert.ok(asked, 'controller chose');
  assert.equal(zone(g, u), 'base', 'saved, recalled');
  assert.equal(zone(g, ga), 'trash');
});

test('RJ#10855 Arise!\'s Sand Soldier tokens may be played to a battlefield I control', () => {
  let g = S0(); fundAll(g, P0, 12);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'Long Sword', 'base');
  let offered = false;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Arise!') } as never);
  g = drive(g, gg => { const o = optionIds(gg); if (o.includes(String(BF_A))) { offered = true; return [String(BF_A)]; } return undefined; }).g;
  assert.ok(offered, 'battlefield offered');
  const ss = Object.values(g.objects).filter(o => g.cards[o.cardId]?.name === 'Sand Soldier' && o.zone === 'battlefield');
  assert.equal(ss.length, 1);
  assert.equal(ss[0].battlefieldIndex, BF_A);
});

test('RJ#10858 Mirror Image plays a Reflection token while an enemy Vex, Apathetic is at a battlefield: the token is stunned', () => {
  let g = S0(); fundAll(g, P0, 12); tokens(g, 'Reflection');
  put(g, P1, 'unl-150-219', BF_A); control(g, BF_A, P1);
  const src = put(g, P0, 'V(3)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Mirror Image') } as never);
  g = drive(g, gg => optionIds(gg).includes(src) ? [src] : undefined, 60).g;
  const refl = Object.keys(g.objects).filter(id => g.objects[id].zone === 'base' && g.cards[g.objects[id].cardId]?.name === 'Reflection');
  assert.equal(refl.length, 1, 'Reflection played');
  assert.ok(g.objects[refl[0]].stunned, 'stunned by Vex');
});

test('RJ#10861 Singularity ("up to two units") is playable with a single unit on the board and deals 6 to it', () => {
  let g = S0(); fundAll(g, P0, 12);
  const e = put(g, P1, 'V(7)', BF_A); control(g, BF_A, P1);
  const s = hand(g, P0, 'Singularity');
  assert.ok(canPlayNow(g, P0, s));
  g = play(g, P0, s, { targets: [[e]] });
  g = drive(g).g;
  assert.equal(g.objects[e].damage, 6);
});

test('RJ#10862 Virtuoso (Jhin legend) counts the Repeat payment: Frigid Touch (2) + Repeat [2] = 4 spent → it may be banished; without Repeat it can\'t', () => {
  const run = (repeat: boolean) => {
    let g = S0(); fundAll(g, P0, 12); setLegend(g, P0, 'Virtuoso');
    const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
    const ft = hand(g, P0, 'Frigid Touch');
    let asked = false;
    g = act(g, { type: 'playCard', player: P0, obj: ft } as never);
    g = drive(g, gg => { const d = gg.pending!; if (d.kind === 'optional') { if (/Repeat/i.test(d.prompt)) return [repeat ? 'yes' : 'no']; if (/banish/i.test(d.prompt)) { asked = true; return ['yes']; } } return optionIds(gg).includes(e) ? [e] : undefined; }).g;
    return { asked, z: zone(g, ft) };
  };
  assert.deepEqual(run(true), { asked: true, z: 'banishment' });
  assert.equal(run(false).asked, false);
});

test('RJ#10868 Daisy! counts tags, not units: two Poros reduce her cost by 1; Poro + Dog by 2', () => {
  const g = S0(); fundAll(g, P0, 12);
  const d = hand(g, P0, 'Daisy!');
  const c0 = playCostOf(g, P0, d)!.energy;
  put(g, P0, 'unl-137-219', 'base'); put(g, P0, 'unl-137-219', 'base');
  assert.equal(playCostOf(g, P0, d)!.energy, c0 - 1, 'two Poros: one tag');
  put(g, P0, 'sfd-006-221', 'base');
  assert.equal(playCostOf(g, P0, d)!.energy, c0 - 2, 'Poro + Dog');
});

test('RJ#10869 Imperial Decree active; Bellows Breath targets a unit; Thrill of the Hunt in response replays it as a new object: no damage, no Decree kill', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); fundAll(g, P1, 20);
  const u = put(g, P0, 'V(5)', BF_A); control(g, BF_A, P0);
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Imperial Decree') } as never)).g;
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Bellows Breath') } as never);
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const d = pend(g); g = act(g, { type: 'choose', player: d.player, optionIds: d.kind === 'optional' ? ['no'] : optionIds(g).includes(u) ? [u] : [d.options![0].id] }); }
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Thrill of the Hunt') } as never);
  g = drive(g, gg => { const d = gg.pending!; if (d.kind === 'optional') return ['no']; const o = optionIds(gg); return o.includes(u) ? [u] : o.includes(String(BF_A)) ? [String(BF_A)] : undefined; }).g;
  assert.equal(locOf(g, u), BF_A, 'replayed and alive');
  assert.equal(g.objects[u].damage, 0, 'Bellows Breath dealt nothing to the new object');
});

test('RJ#10873 Blood Money\'s target is locked when played; Discipline in response makes the Poro 4 Might: on resolution it no longer qualifies — no kill, no Gold', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1); tokens(g, 'Gold');
  const poro = put(g, P1, 'Lonely Poro', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Blood Money'), { targets: [[poro]] });
  for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = play(g, P1, hand(g, P1, 'Discipline'), { targets: [[poro]] });
  g = drive(g).g;
  assert.equal(locOf(g, poro), BF_A, 'not killed');
  assert.ok(!Object.values(g.objects).some(o => g.cards[o.cardId]?.name === 'Gold' && o.zone === 'base'), 'no Gold');
});

test('RJ#10878 Opponent\'s Irresistible Faefolk pulls my lone Tideturner from my BF-B to BF-A; in the showdown I Ride the Wind it back to BF-B: I re-conquer BF-B and score', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12);
  const tt = put(g, P0, 'Tideturner', BF_B); control(g, BF_B, P0);
  const ff = put(g, P1, 'Irresistible Faefolk', 'base');
  const rw = hand(g, P0, 'Ride the Wind');
  const p0 = g.players[P0].points;
  g = move(g, P1, [ff], BF_A);
  for (let i = 0; i < 12 && !(locOf(g, tt) === BF_A && pend(g).player === P0 && !pend(g).inStep && g.chain.length === 0 && canPlayNow(g, P0, rw)); i++) {
    const d = pend(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: d.kind === 'optional' ? ['yes'] : optionIds(g).includes(tt) ? [tt] : [d.options![0].id] }) : pass(g);
  }
  assert.equal(locOf(g, tt), BF_A, 'pulled to BF-A');
  assert.notEqual(g.battlefields[BF_B].controller, P0, 'BF-B lost (no unit left there)');
  g = act(g, { type: 'playCard', player: P0, obj: rw } as never);
  g = drive(g, gg => { const o = optionIds(gg); return o.includes(tt) ? [tt] : o.includes(String(BF_B)) ? [String(BF_B)] : undefined; }, 80).g;
  assert.equal(locOf(g, tt), BF_B);
  assert.equal(g.battlefields[BF_B].controller, P0);
  assert.equal(g.players[P0].points, p0 + 1, 'conquered BF-B on the opponent\'s turn');
});

test('RJ#10879 Baited Hook kills Ruined Rex (Deathknell chained first) and plays Harnessed Dragon at Star Spring: the Dragon\'s and Star Spring\'s triggers go on top in my order, the Dragon\'s target is chosen as it is chained, and they resolve before the Deathknell', () => {
  let g = S0(); fundAll(g, P0, 12); setBattlefieldCard(g, BF_A, 'Star Spring');
  const rex = put(g, P0, 'Ruined Rex', BF_A); control(g, BF_A, P0);
  const o = put(g, P0, 'V(2)', BF_A);
  const e = put(g, P1, 'V(3)', BF_B); control(g, BF_B, P1);
  const hook = put(g, P0, 'Baited Hook', 'base');
  const dr = put(g, P0, 'Harnessed Dragon', 'deckTop');
  g = act(g, { type: 'activate', player: P0, obj: hook, abilityIndex: 0 });
  let ordered = false;
  g = drive(g, gg => { const d = gg.pending!; const ids = optionIds(gg);
    if (d.kind === 'orderTriggers') { ordered = true; return [d.options!.find(x => /Star Spring/.test(x.label))!.id]; }
    return ids.includes(rex) ? [rex] : ids.includes(dr) ? [dr] : ids.includes(String(BF_A)) ? [String(BF_A)] : ids.includes(o) ? [o] : undefined; }, 3).g;
  for (let i = 0; i < 6 && g.pending?.inStep; i++) { const d = pend(g); const ids = optionIds(g); g = act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'orderTriggers' ? (ordered = true, d.options!.find(x => /Star Spring/.test(x.label))!.id) : ids.includes(String(BF_A)) ? String(BF_A) : ids[0]] }); }
  assert.ok(ordered, 'I order my simultaneous triggers');
  const labels = chainLabels(g);
  assert.equal(labels.length, 3);
  assert.match(labels[0], /Ruined Rex/, 'Deathknell at the bottom');
  assert.match(labels[1], /Star Spring/); assert.match(labels[2], /Harnessed Dragon/);
  assert.ok(/Kill an enemy unit: V\(3\)[\s\S]*Trigger: Harnessed Dragon/.test(logText(g)), 'Dragon\'s target chosen as the trigger is chained');
  g = drive(g, gg => optionIds(gg).includes(o) ? [o] : undefined).g;
  assert.equal(zone(g, e), 'trash', 'Dragon killed it first (Rex\'s Deathknell then has no enemy left)');
  assert.equal(locOf(g, o), 'base', 'Star Spring moved the other unit');
});

test('RJ#10879b Star Spring\'s "may move another unit" is decided (with the unit) when the trigger is chained, not on resolution (principle 11)', () => {
  let g = S0(); fundAll(g, P0, 12); setBattlefieldCard(g, BF_A, 'Star Spring');
  control(g, BF_A, P0); const o = put(g, P0, 'V(2)', BF_A);
  g = play(g, P0, hand(g, P0, 'V(3)'), { dest: BF_A });
  let asked = false;
  for (let i = 0; i < 8 && !g.chain.some(c => /Star Spring/.test(String(c.label))); i++) { const d = pend(g); if (d.inStep && (d.kind === 'optional' || optionIds(g).includes(o))) asked = true; g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [optionIds(g).includes(o) ? o : d.kind === 'optional' ? 'yes' : d.options![0].id] }) : pass(g); }
  assert.ok(g.chain.some(c => /Star Spring/.test(String(c.label))), 'Star Spring triggered');
  assert.ok(asked, 'the may/unit choice was made before the trigger landed on the chain');
});

test('RJ#10880 Vanguard Armory\'s Recruits can only be played to base or a battlefield I control, not an open one', () => {
  let g = S0(); fundAll(g, P0, 12); tokens(g, 'Recruit');
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  const va = put(g, P0, 'Vanguard Armory', 'base');
  g = act(g, { type: 'activate', player: P0, obj: va, abilityIndex: 0 } as never);
  const offered: string[][] = [];
  g = drive(g, gg => { const ids = optionIds(gg); offered.push(ids); return [ids[0]]; }).g;
  assert.equal(offered.length, 3);
  for (const ids of offered) { assert.ok(ids.includes(String(BF_B))); assert.ok(!ids.includes(String(BF_A)), 'open battlefield not offered'); }
});

test('RJ#10882 Opponent Sacrifices its only (Mighty) defender during the combat showdown: Nidalee still wins the combat and draws', () => {
  let { g, atk: [n], def: [d] } = attackSetup(['Nidalee'], ['V(5)']);
  fundAll(g, P1, 12);
  const h0 = g.players[P0].hand.length;
  for (let i = 0; i < 6 && !(pend(g).player === P1 && pend(g).kind === 'showdownAction'); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = play(g, P1, hand(g, P1, 'Sacrifice'));
  g = drive(g, gg => optionIds(gg).includes(d) ? [d] : undefined).g;
  assert.equal(zone(g, d), 'trash');
  assert.equal(locOf(g, n), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].hand.length, h0 + 1, 'Nidalee drew 1');
});

test('RJ#10883 Hidden Switcheroo on my Ember Monk (4) and Mutated Mouser (1, not defending): the swap resolves, then Ember Monk\'s hidden-play trigger → Monk 3, Mouser 4', () => {
  let g = S0(); fundAll(g, P0, 12);
  const em = put(g, P0, 'Ember Monk', BF_A); control(g, BF_A, P0);
  const mm = put(g, P0, 'Mutated Mouser', BF_A);
  const sw = put(g, P0, 'Switcheroo', { facedown: BF_A });
  g = play(g, P0, sw, { targets: [[em, mm], [mm]] });
  assert.ok(!chainLabels(g).some(l => /Ember Monk/.test(l)), 'the play trigger waits for Switcheroo to resolve (CR 420.4.a)');
  g = drive(g).g;
  assert.equal(mightOf(g, em), 3); assert.equal(mightOf(g, mm), 4);
});

test('RJ#10883b Same with Mutated Mouser defending (Shield 2 → 3): Monk ends 5, Mouser 4', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12);
  const em = put(g, P0, 'Ember Monk', BF_A); control(g, BF_A, P0);
  const mm = put(g, P0, 'Mutated Mouser', BF_A);
  const sw = put(g, P0, 'Switcheroo', { facedown: BF_A });
  const a = put(g, P1, 'V(1)', 'base');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 8 && !canPlayNow(g, P0, sw); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, mm), 3, 'defending Shield');
  g = play(g, P0, sw, { targets: [[em, mm], [mm]] });
  for (let i = 0; i < 8 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, em), 5); assert.equal(mightOf(g, mm), 4);
});

test('RJ#10884 Hidden Switcheroo with only Ember Monk at the battlefield can\'t be played (needs two units there), so no Ember Monk trigger', () => {
  const g = S0(); fundAll(g, P0, 12);
  put(g, P0, 'Ember Monk', BF_A); control(g, BF_A, P0);
  put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  const sw = put(g, P0, 'Switcheroo', { facedown: BF_A });
  assert.equal(canPlayNow(g, P0, sw), false);
});

test('RJ#10885 Defender Retreats its only unit in the combat showdown: the showdown continues, focus passes on and the attacker may play an Action (Stacked Deck)', () => {
  let { g, def: [d] } = attackSetup(['V(3)'], ['V(3)']);
  fundAll(g, P0, 12); fundAll(g, P1, 12);
  const sd = hand(g, P0, 'Stacked Deck');
  for (let i = 0; i < 6 && !(pend(g).player === P1 && pend(g).kind === 'showdownAction'); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = play(g, P1, hand(g, P1, 'Retreat'), { targets: [[d]] });
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(zone(g, d), 'hand');
  assert.equal(pend(g).kind, 'showdownAction', 'showdown continues');
  assert.equal(pend(g).player, P0, 'focus passed to the attacker');
  assert.ok(canPlayNow(g, P0, sd), 'Stacked Deck playable');
});

test('RJ#10887 Deceiver (LeBlanc legend): the Reflection copying a buffed, pumped unit gets only its printed Might (no buff, no +Might)', () => {
  const g0 = S0(); fundAll(g0, P0); setLegend(g0, P0, 'Deceiver'); tokens(g0, 'Reflection');
  const u = put(g0, P0, 'V(3)', 'base', { buff: true }); mod(g0, u, { might: 2 }); hand(g0, P0, 'V(1)');
  assert.equal(mightOf(g0, u), 6);
  const before = new Set(Object.keys(g0.objects));
  const g = drive(move(g0, P0, [u], BF_A), gg => optionIds(gg).includes(u) ? [u] : undefined).g;
  const r = Object.keys(g.objects).find(id => !before.has(id) && g.objects[id].isToken && g.objects[id].zone === 'battlefield');
  assert.ok(r, 'Reflection played');
  assert.equal(mightOf(g, r!), 3, 'printed Might only');
  assert.ok(!(g.objects[r!].counters.buff > 0), 'no buff copied');
});

test('RJ#10888 Mask of Foresight: Lillia defends alone (+1); Smoke and Mirrors swaps her with my base Sprite: the Sprite defends alone and gets Mask\'s +1 whatever the order with Lillia\'s new-Sprite trigger', () => {
  for (const first of [/Mask/, /Lillia/]) {
    let g = S0({ tp: P1 }); fundAll(g, P0, 12); tokens(g, 'Sprite');
    put(g, P0, 'Mask of Foresight', 'base');
    const li = put(g, P0, 'unl-082-219', BF_A); control(g, BF_A, P0);
    const sp = put(g, P0, 'Sprite', 'base', { token: true });
    const sm = hand(g, P0, 'Smoke and Mirrors');
    const a = put(g, P1, 'V(9)', 'base');
    g = move(g, P1, [a], BF_A);
    for (let i = 0; i < 10 && !(pend(g).player === P0 && !pend(g).inStep && g.chain.length === 0 && canPlayNow(g, P0, sm)); i++) g = pend(g).inStep ? act(g, { type: 'choose', player: pend(g).player, optionIds: [pend(g).kind === 'optional' ? 'yes' : pend(g).options![0].id] }) : pass(g);
    assert.equal(mightOf(g, li), 4, 'Lillia defended alone: +1');
    const sp0 = mightOf(g, sp)!;
    g = play(g, P0, sm, { targets: [[li], [sp]] });
    for (let i = 0; i < 14 && (g.chain.length || pend(g).inStep); i++) { const d = pend(g); g = d.inStep ? choose(g, d.kind === 'orderTriggers' ? d.options!.find(o => first.test(o.label))?.id ?? d.options![0].id : d.kind === 'optional' ? 'yes' : d.options![0].id) : pass(g); }
    assert.equal(locOf(g, sp), BF_A); assert.equal(locOf(g, li), 'base');
    assert.equal(Object.keys(g.objects).filter(id => g.cards[g.objects[id].cardId]?.name === 'Sprite' && locOf(g, id) === BF_A).length, 2, 'Lillia\'s trigger played a second Sprite there');
    assert.equal(mightOf(g, sp), sp0 + 1, `Mask +1 on the swapped Sprite (${first})`);
  }
});

test('RJ#10889 Opponent\'s repeated Bellows Breath at my base on Determined Sentry and Lonely Poro: both die together (or the Sentry survives) — the Poro didn\'t die alone, no draw; Repeat is one chain item', () => {
  for (const both of [true, false]) {
    let g = S0({ tp: P1 }); fundAll(g, P1, 12);
    const se = put(g, P0, 'Determined Sentry', 'base'); const poro = put(g, P0, 'Lonely Poro', 'base');
    const h0 = g.players[P0].hand.length;
    g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Bellows Breath') } as never);
    g = drive(g, gg => { const d = gg.pending!; if (d.kind === 'optional') return [/Repeat/i.test(d.prompt) ? 'yes' : 'no'];
      const ids = optionIds(gg); const want = both ? [se, poro].filter(x => ids.includes(x)) : ids.includes(poro) ? [poro] : [];
      if (want.length) return d.kind === 'chooseTargets' && (d.data as { max?: number } | undefined)?.max !== 1 ? want : [want[0]]; return undefined; }, 60).g;
    assert.equal(zone(g, poro), 'trash');
    assert.equal(zone(g, se), both ? 'trash' : 'base');
    assert.equal(g.players[P0].hand.length, h0, 'no draw');
  }
});

test('RJ#10892 Opponent moves into an empty battlefield (showdown); I have no units there: my Sprite Call\'s Sprite can only go to my base', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); tokens(g, 'Sprite');
  const sc = hand(g, P0, 'Sprite Call');
  const a = put(g, P1, 'V(2)', 'base');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 8 && !(pend(g).player === P0 && !pend(g).inStep && canPlayNow(g, P0, sc)); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(canPlayNow(g, P0, sc), 'Action playable in the showdown');
  g = act(g, { type: 'playCard', player: P0, obj: sc } as never);
  const offered: string[][] = [];
  g = drive(g, gg => { const ids = optionIds(gg); if (gg.pending!.kind === 'chooseDestination') offered.push(ids); return undefined; }).g;
  for (const ids of offered) assert.ok(!ids.includes(String(BF_A)), 'the showdown battlefield is not offered');
  const sp = Object.keys(g.objects).filter(id => g.cards[g.objects[id].cardId]?.name === 'Sprite' && ['base', 'battlefield'].includes(g.objects[id].zone));
  assert.equal(sp.length, 1); assert.equal(locOf(g, sp[0]), 'base');
});

test('RJ#10893 Showstopper on an already-buffed unit in my base: legal; no second buff, and it still moves', () => {
  let g = S0(); fundAll(g, P0, 12);
  const u = put(g, P0, 'V(2)', 'base', { buff: true });
  const ss = hand(g, P0, 'Showstopper, Sett');
  assert.ok(canPlayNow(g, P0, ss));
  g = play(g, P0, ss, { targets: [[u]] });
  for (let i = 0; i < 8 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? answer(g, { locations: [BF_A], battlefields: [BF_A] }) : pass(g);
  assert.equal(locOf(g, u), BF_A, 'moved');
  assert.equal(g.objects[u].counters.buff, 1, 'still one buff');
});

test('RJ#10895 Grim Apothecary played to BF-A may return a friendly unit at another battlefield (BF-B) to hand', () => {
  let g = S0(); fundAll(g, P0, 12);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const far = put(g, P0, 'V(2)', BF_B); control(g, BF_B, P0);
  g = play(g, P0, hand(g, P0, 'Grim Apothecary'), { dest: BF_A });
  let offered = false;
  g = drive(g, gg => { const ids = optionIds(gg); if (ids.includes(far)) { offered = true; return [far]; } return gg.pending!.kind === 'optional' ? ['yes'] : undefined; }).g;
  assert.ok(offered, 'unit at the other battlefield offered');
  assert.equal(zone(g, far), 'hand');
});

test('RJ#10898 Acceptable Losses: in response I kill my Gold for its [Add]; on resolution I kill another gear of mine if I have one, else nothing (gear chosen on resolution)', () => {
  for (const other of [true, false]) {
    let g = S0(); fundAll(g, P0, 12); tokens(g, 'Gold');
    const gold = put(g, P0, 'Gold', 'base', { token: true });
    const sw = other ? put(g, P0, 'Long Sword', 'base') : undefined;
    const pg = put(g, P1, 'Baited Hook', 'base');
    g = play(g, P0, hand(g, P0, 'Acceptable Losses'));
    const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === gold);
    assert.ok(ab, 'Gold usable in response');
    g = act(g, ab!);
    for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
    assert.notEqual(zone(g, gold), 'base', 'Gold killed as a cost');
    g = drive(g).g;
    if (sw) assert.equal(zone(g, sw), 'trash', 'the other gear is killed');
    assert.equal(zone(g, pg), 'trash', 'opponent kills theirs');
  }
});

test('RJ#10899 Jinx, Demolitionist with Accelerate costs [4] + two Fury power (runes exhausted for energy, two recycled for power) and enters ready; with 3 runes it isn\'t offered', () => {
  let g = S0(); setRunes(g, P0, 6);
  const rd0 = g.players[P0].runeDeck.length;
  const j = hand(g, P0, 'Jinx, Demolitionist'); hand(g, P0, 'V(1)'); hand(g, P0, 'V(1)');
  g = act(g, { type: 'playCard', player: P0, obj: j, destination: 'base' } as never);
  assert.equal(pend(g).kind, 'optional', 'Accelerate offered');
  g = yes(g);
  g = drive(g).g;
  assert.equal(zone(g, j), 'base'); assert.equal(g.objects[j].exhausted, false, 'enters ready');
  assert.equal(g.players[P0].runeDeck.length, rd0 + 2, 'two runes recycled for the power');
  let t = S0(); setRunes(t, P0, 3);
  const j2 = hand(t, P0, 'Jinx, Demolitionist');
  t = act(t, { type: 'playCard', player: P0, obj: j2, destination: 'base' } as never);
  assert.ok(!(pend(t).kind === 'optional' && /Accelerate/i.test(pend(t).prompt)), 'not affordable with 3 runes');
});

test('RJ#10900 Cull the Weak doesn\'t choose: Not So Fast can\'t counter it', () => {
  const g0 = S0({ tp: P1 }); fundAll(g0, P0); fundAll(g0, P1);
  put(g0, P0, 'V(2)', BF_A); control(g0, BF_A, P0); put(g0, P1, 'V(1)', 'base');
  const nsf = hand(g0, P0, 'Not So Fast');
  let g = play(g0, P1, hand(g0, P1, 'Cull the Weak'));
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  assert.ok(g.chain.length > 0 && pend(g).player === P0);
  assert.equal(canPlayNow(g, P0, nsf), false, 'no spell choosing a friendly unit to counter');
});

test('RJ#10901 Pridestalker (Rengar legend) triggers when Emperor\'s Dais plays its Sand Soldier token', () => {
  let g = S0(); fundAll(g, P0); setLegend(g, P0, 'Pridestalker');
  setBattlefieldCard(g, BF_A, "Emperor's Dais");
  const t = put(g, P0, 'V(2)', 'base'); const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [t, u], BF_A);
  g = drive(g, gg => { const d = gg.pending!; if (d.kind === 'optional') return ['yes']; return optionIds(gg).includes(t) ? [t] : undefined; }).g;
  const ss = Object.keys(g.objects).filter(id => g.cards[g.objects[id].cardId]?.name === 'Sand Soldier' && g.objects[id].zone === 'battlefield');
  assert.equal(ss.length, 1, 'Sand Soldier played');
  assert.ok(/Resolving Pridestalker/.test(logText(g)), 'Pridestalker triggered');
});

test('RJ#10902 Glorious Executioner (Draven legend): Star-Crossed bounces my second attacker and the only defender mid-combat; my remaining attacker wins the combat → draw 1', () => {
  let { g, atk: [a, b], def: [d] } = attackSetup(['V(3)', 'V(2)'], ['V(4)']);
  fundAll(g, P0, 12); setLegend(g, P0, 'Glorious Executioner');
  const sc = hand(g, P0, 'Star-Crossed');
  for (let i = 0; i < 6 && !(pend(g).player === P0 && pend(g).kind === 'showdownAction' && canPlayNow(g, P0, sc)); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  const h0 = g.players[P0].hand.length;
  g = play(g, P0, sc, { targets: [[b], [d]] });
  g = drive(g, gg => { const ids = optionIds(gg); return ids.includes(b) ? [b] : ids.includes(d) ? [d] : undefined; }).g;
  assert.equal(zone(g, d), 'hand'); assert.equal(zone(g, b), 'hand');
  assert.equal(locOf(g, a), BF_A); assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].hand.length, h0 - 1 + 1 + 1, 'Star-Crossed left the hand, the bounced unit returned, and the legend drew 1');
});

test('RJ#10903 Evelynn, Entrancing played from face down: Gust her in response to her move trigger → back to hand, the enemy unit isn\'t moved', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  const ev = put(g, P0, 'Evelynn, Entrancing', { facedown: BF_A });
  const gust = hand(g, P1, 'Gust');
  g = play(g, P0, ev);
  for (let i = 0; i < 8 && !(pend(g).player === P1 && !pend(g).inStep && chainLabels(g).some(l => /Evelynn/.test(l)) && canPlayNow(g, P1, gust)); i++) { const d = pend(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g).includes(e) ? e : d.options![0].id] }) : pass(g); }
  assert.ok(chainLabels(g).some(l => /Evelynn/.test(l)), 'her trigger is on the chain');
  g = play(g, P1, gust, { targets: [[ev]] });
  g = drive(g, gg => optionIds(gg).includes(e) ? [e] : undefined).g;
  assert.equal(zone(g, ev), 'hand');
  assert.equal(locOf(g, e), BF_B, 'not moved');
});

test('RJ#10904 Elder Dragon doesn\'t get around Vilemaw: my smaller attacker deals no combat damage, so Vilemaw survives', () => {
  let { g, atk: [a], def: [v] } = attackSetup(['V(3)'], ['Vilemaw']);
  put(g, P0, 'Elder Dragon', 'base');
  g = drive(g).g;
  assert.equal(zone(g, v), 'battlefield', 'Vilemaw survives');
  assert.equal(g.objects[v].damage ?? 0, 0);
  assert.notEqual(zone(g, a), 'battlefield');
});

test('RJ#10905 Irresistible Faefolk moves in; I Ambush Rengar in response to its move trigger: when combat starts two enemy units are there, so a defending Kha\'Zix\'s "if an enemy unit is alone here" fails (no +2)', () => {
  let g = S0(); fundAll(g, P0, 12);
  const kz = put(g, P1, 'unl-143-219', BF_A); control(g, BF_A, P1);
  const e2 = put(g, P1, 'V(1)', 'base');
  const ff = put(g, P0, 'Irresistible Faefolk', 'base');
  const r = hand(g, P0, 'Rengar, Trophy Hunter');
  g = move(g, P0, [ff], BF_A);
  for (let i = 0; i < 6 && !(pend(g).player === P0 && !pend(g).inStep && chainLabels(g).some(l => /Faefolk/.test(l))); i++) { const d = pend(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g).includes(e2) ? e2 : d.options![0].id] }) : pass(g); }
  assert.ok(chainLabels(g).some(l => /Faefolk/.test(l)), 'move trigger pending');
  assert.ok(canPlayNow(g, P0, r, BF_A), 'Ambush in response');
  g = play(g, P0, r, { dest: BF_A });
  for (let i = 0; i < 16 && (g.chain.length || pend(g).inStep); i++) { const d = pend(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g).includes(e2) ? e2 : d.options![0].id] }) : pass(g); }
  assert.equal(locOf(g, r), BF_A); assert.equal(locOf(g, e2), BF_A, 'enemy unit pulled in');
  assert.ok(g.showdown?.isCombat, 'combat');
  assert.equal(mightOf(g, kz), 4, 'no Kha\'Zix +2');
  // control: without the Ambush, the Faefolk is alone and Kha'Zix gets +2
  let h = S0(); const kz2 = put(h, P1, 'unl-143-219', BF_A); control(h, BF_A, P1);
  h = drive(move(h, P0, [put(h, P0, 'Irresistible Faefolk', 'base')], BF_A), gg => gg.pending!.kind === 'optional' ? ['no'] : undefined).g;
  assert.equal(mightOf(h, kz2), 6, 'alone → +2');
});

test('RJ#10906 Glorious Executioner\'s win-combat draw uses the chain: the opponent may react to it before I draw', () => {
  let { g } = attackSetup(['V(5)'], ['V(2)']);
  fundAll(g, P1); setLegend(g, P0, 'Glorious Executioner');
  const r = hand(g, P1, 'DrawR');
  let window = false;
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    if (chainLabels(g).some(l => /Glorious Executioner/.test(l)) && pend(g).player === P1 && canPlayNow(g, P1, r)) { window = true; break; }
    const d = pend(g); g = d.kind === 'assignDamage' ? act(g, legal(g, d.player)[0]) : d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.ok(window, 'P1 had priority with the legend trigger on the chain');
});

test('RJ#10908 (MISMATCH-RJ for the combat case, see RJ#10909) Deceiver trigger after LeBlanc, Fragmented conquers an EMPTY battlefield (no combat, no Assault): the opponent may Gust LeBlanc in response; the Reflection is still played but with no other unit there it copies nothing', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1); setLegend(g, P0, 'Deceiver'); tokens(g, 'Reflection');
  const lb = put(g, P0, 'LeBlanc, Fragmented', 'base'); hand(g, P0, 'V(1)');
  const gust = hand(g, P1, 'Gust');
  g = move(g, P0, [lb], BF_A);
  for (let i = 0; i < 12 && !(chainLabels(g).some(l => /Deceiver/.test(l)) && pend(g).player === P1 && !pend(g).inStep); i++) { const d = pend(g); if (d.kind === 'mainAction') break; g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : d.options![0].id) : pass(g); }
  assert.ok(chainLabels(g).some(l => /Deceiver/.test(l)) && pend(g).player === P1, 'P1 has priority over the Deceiver trigger');
  const before = new Set(Object.keys(g.objects));
  g = play(g, P1, gust, { targets: [[lb]] });
  g = drive(g).g;
  assert.equal(zone(g, lb), 'hand');
  const r = Object.keys(g.objects).find(id => !before.has(id) && g.objects[id].isToken && g.objects[id].zone === 'battlefield');
  assert.ok(r, 'Reflection still played');
  assert.equal(mightOf(g, r!), 0, 'no copy (no other unit there)');
});

test('RJ#10909 LeBlanc, Fragmented attacks and conquers: while the Deceiver conquer trigger is on the chain she is still an attacker (Assault: 4 Might), so Gust can\'t target her (CR 468.6 before 468.7.a)', () => {
  let { g, atk: [lb] } = attackSetup(['LeBlanc, Fragmented'], ['V(1)']);
  fundAll(g, P0); fundAll(g, P1); setLegend(g, P0, 'Deceiver'); tokens(g, 'Reflection'); hand(g, P0, 'V(1)');
  const gust = hand(g, P1, 'Gust');
  for (let i = 0; i < 20 && !(chainLabels(g).some(l => /Deceiver/.test(l)) && pend(g).player === P1 && !pend(g).inStep); i++) { const d = pend(g); if (d.kind === 'mainAction') break; g = d.kind === 'assignDamage' ? act(g, legal(g, d.player)[0]) : d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : d.options![0].id) : pass(g); }
  assert.ok(chainLabels(g).some(l => /Deceiver/.test(l)) && pend(g).player === P1, 'P1 has priority over the Deceiver trigger');
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  assert.equal(mightOf(g, lb), 4, 'still an attacker: Assault applies');
  assert.equal(canPlayNow(g, P1, gust), false, 'no legal Gust target');
});

test('RJ#10912 Karthus, Eternal on the board; another unit equipped with Sacred Shears dies: its Deathknell triggers twice → draw 2', () => {
  const g0 = S0({ tp: P1 }); fundAll(g0, P1);
  put(g0, P0, 'Karthus, Eternal', 'base');
  const u = put(g0, P0, 'V(2)', BF_A); control(g0, BF_A, P0);
  attachNow(g0, put(g0, P0, 'Sacred Shears', 'base'), u);
  const h0 = g0.players[P0].hand.length;
  const g = drive(play(g0, P1, hand(g0, P1, 'Hidden Blade'), { targets: [[u]] })).g;
  assert.equal(zone(g, u), 'trash');
  assert.equal(g.players[P0].hand.length, h0 + 2 + 2, 'Hidden Blade\'s 2 + Shears Deathknell twice');
});

test('RJ#10913 Star-Crossed on my Ezreal + enemy Rengar; in response Heedless Resurrection kills Ezreal and plays Fizz, Trickster: Star-Crossed is still on the chain, so Fizz can\'t use it; it then returns only Rengar', () => {
  let g = S0(); fundAll(g, P0, 20);
  const ez = put(g, P0, 'Ezreal, Prodigy', BF_A); control(g, BF_A, P0);
  const rg = put(g, P1, 'Rengar, Trophy Hunter', BF_B); control(g, BF_B, P1);
  const fz = put(g, P0, 'Fizz, Trickster', 'trash');
  const sc = hand(g, P0, 'Star-Crossed');
  g = play(g, P0, sc, { targets: [[ez], [rg]] });
  for (let i = 0; i < 4 && pend(g).inStep; i++) { const ids = optionIds(g); g = act(g, { type: 'choose', player: P0, optionIds: [ids.includes(ez) ? ez : ids.includes(rg) ? rg : ids[0]] }); }
  assert.equal(zone(g, sc), 'chain');
  if (pend(g).player !== P0) g = pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Heedless Resurrection') } as never);
  let scOffered = false;
  g = drive(g, gg => { const ids = optionIds(gg); if (ids.includes(sc)) scOffered = true; if (/spell.*from your trash/.test(gg.pending!.prompt)) return []; return ids.includes(ez) ? [ez] : ids.includes(fz) ? [fz] : ids.includes(String(BF_A)) ? [String(BF_A)] : undefined; }, 80).g;
  assert.ok(['base', 'battlefield'].includes(zone(g, fz)), 'Fizz played');
  assert.ok(!scOffered, 'Star-Crossed never offered to Fizz');
  assert.equal(zone(g, ez), 'trash', 'Ezreal stays dead (the target became a new object)');
  assert.equal(zone(g, rg), 'hand', 'Rengar still returned');
});

test('RJ#10914 My lone unit ganks from my battlefield to an empty Seat of Power: the battlefield it left is no longer controlled, so the conquer draws 0', () => {
  let g = S0(); setBattlefieldCard(g, BF_B, 'Seat of Power');
  const r = put(g, P0, 'Rengar, Unseen', BF_A); control(g, BF_A, P0);
  const h0 = g.players[P0].hand.length;
  g = drive(move(g, P0, [r], BF_B)).g;
  assert.equal(g.battlefields[BF_B].controller, P0, 'conquered Seat of Power');
  assert.notEqual(g.battlefields[BF_A].controller, P0, 'left battlefield lost');
  assert.equal(g.players[P0].hand.length, h0, 'no draw');
});

test('RJ#10915 Elder Dragon chose my unit at a battlefield; I Flash it to base in response: the choice was "the enemy unit at that battlefield", so it is no longer a legal target there and survives', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); setRunes(g, P1, 0); addRunes(g, P1, 12, 'order'); addRunes(g, P1, 4, 'body');
  const u = put(g, P0, 'V(5)', BF_A); control(g, BF_A, P0);
  const fl = hand(g, P0, 'Flash');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Elder Dragon'), destination: 'base' } as never);
  for (let i = 0; i < 10 && !(chainLabels(g).some(l => /Elder Dragon/.test(l) && /trigger/.test(l)) && pend(g).player === P0 && !pend(g).inStep); i++) {
    const d = pend(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: optionIds(g).includes(u) ? [u] : [d.options![0].id] }) : pass(g);
  }
  assert.ok(chainLabels(g).some(l => /Elder Dragon/.test(l)), 'Dragon trigger on the chain');
  g = play(g, P0, fl, { targets: [[u]] });
  g = drive(g, gg => optionIds(gg).includes(u) ? [u] : undefined).g;
  assert.equal(locOf(g, u), 'base', 'moved');
  assert.equal(g.objects[u].damage ?? 0, 0, 'no damage, survives');
});

test('RJ#10916 Factory Recall returns the Brutalizer attached this turn to Lillia (3 → 6): she goes back to 3', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1, 12);
  const li = put(g, P0, 'unl-082-219', BF_A); control(g, BF_A, P0);
  const br = put(g, P0, 'Brutalizer', 'base'); attachNow(g, br, li);
  assert.equal(mightOf(g, li), 6, '3 + 1 + 2 (attached this turn)');
  g = drive(play(g, P1, hand(g, P1, 'Factory Recall'), { targets: [[br]] })).g;
  assert.equal(zone(g, br), 'hand');
  assert.equal(mightOf(g, li), 3);
});

test('RJ#10917 Heedless Resurrection killing my only unit at BF-A: an Ambush unit from my trash can be played to BF-A (control is kept while the spell is on the chain)', () => {
  let g = S0(); fundAll(g, P0, 12);
  const rex = put(g, P0, 'Ruined Rex', BF_A); control(g, BF_A, P0);
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  const kz = put(g, P0, 'unl-143-219', 'trash');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Heedless Resurrection') } as never);
  let offered = false;
  g = drive(g, gg => { const ids = optionIds(gg); if (gg.pending!.kind === 'chooseDestination' && ids.includes(String(BF_A))) { offered = true; return [String(BF_A)]; } return ids.includes(rex) ? [rex] : ids.includes(kz) ? [kz] : undefined; }, 60).g;
  assert.ok(offered, 'BF-A offered');
  assert.equal(locOf(g, kz), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#10919 Kai\'Sa, Evolutionary plays a spell from my trash on conquer with Virtuoso (Jhin legend): no banish — the spell is recycled, never back in the trash', () => {
  let g = S0(); fundAll(g, P0, 12); setLegend(g, P0, 'Virtuoso'); g.players[P0].points = 3;
  const ks = put(g, P0, "Kai'Sa, Evolutionary", 'base');
  const e = put(g, P1, 'V(5)', BF_B); control(g, BF_B, P1);
  const ray = put(g, P0, 'Hextech Ray', 'trash');
  let banishAsked = false;
  g = drive(move(g, P0, [ks], BF_A), gg => { const d = gg.pending!; if (d.kind === 'optional' && /banish/i.test(d.prompt)) { banishAsked = true; return ['yes']; } const ids = optionIds(gg); return ids.includes(ray) ? [ray] : ids.includes(e) ? [e] : d.kind === 'optional' ? ['yes'] : undefined; }, 60).g;
  assert.ok(g.objects[e].damage > 0, 'Hextech Ray was played from the trash');
  assert.ok(!banishAsked, 'Virtuoso offered no banish');
  assert.equal(zone(g, ray), 'mainDeck', 'recycled');
});

test('RJ#10920 Shadow\'s [Action] stun ability: usable with focus in the combat showdown (open, empty chain), not in response to a chain item', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const sh = put(g, P0, 'Shadow', BF_A, { ready: true }); control(g, BF_A, P0);
  const a = put(g, P1, 'V(3)', 'base');
  const can = (h: GameState) => legal(h, P0, 'activate').some(x => x.type === 'activate' && x.obj === sh);
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 8 && !(pend(g).kind === 'showdownAction' && pend(g).player === P1); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = play(g, P1, hand(g, P1, 'DrawR'));
  if (pend(g).player === P1) g = pass(g);
  assert.ok(g.chain.length > 0 && pend(g).player === P0);
  assert.equal(can(g), false, 'not as a response (Action, closed state)');
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(pend(g).player, P0, 'focus passes to me after the chain');
  assert.ok(can(g), 'usable in the open showdown');
  g = act(g, legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === sh)!);
  g = drive(g, gg => optionIds(gg).includes(a) ? [a] : undefined, 6).g;
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(/V\(3\) is stunned/.test(logText(g)), 'attacker stunned');
  assert.equal(g.objects[sh].damage ?? 0, 0, 'the stunned attacker dealt no damage');
});

test('RJ#10921 Defending alone at Forbidding Waste (-2); I Ambush a second unit in during the showdown: the -2 ends at once', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); setBattlefieldCard(g, BF_A, 'Forbidding Waste');
  const d = put(g, P0, 'V(4)', BF_A); control(g, BF_A, P0);
  const kz = hand(g, P0, 'unl-143-219');
  g = move(g, P1, [put(g, P1, 'V(9)', 'base')], BF_A);
  for (let i = 0; i < 8 && !(pend(g).player === P0 && !pend(g).inStep && canPlayNow(g, P0, kz, BF_A)); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, d), 2, 'defending alone: -2');
  g = play(g, P0, kz, { dest: BF_A });
  for (let i = 0; i < 6 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(locOf(g, kz), BF_A);
  assert.equal(mightOf(g, d), 4, 'no longer alone');
});

test('RJ#10923 Faefolk moves to Star Spring; I Ambush a unit there in response and Star Spring sends the Faefolk to base: its trigger still moves the enemy unit to "that battlefield"', () => {
  let g = S0(); fundAll(g, P0, 12); setBattlefieldCard(g, BF_A, 'Star Spring');
  const ff = put(g, P0, 'Irresistible Faefolk', 'base');
  const e = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  const kz = hand(g, P0, 'unl-143-219');
  g = move(g, P0, [ff], BF_A);
  for (let i = 0; i < 6 && !(pend(g).player === P0 && !pend(g).inStep && chainLabels(g).some(l => /Faefolk/.test(l))); i++) { const d = pend(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g).includes(e) ? e : d.options![0].id] }) : pass(g); }
  assert.ok(chainLabels(g).some(l => /Faefolk/.test(l)));
  g = play(g, P0, kz, { dest: BF_A });
  g = drive(g, gg => { const ids = optionIds(gg); return ids.includes(ff) ? [ff] : ids.includes(e) ? [e] : gg.pending!.kind === 'optional' ? ['yes'] : undefined; }, 80).g;
  assert.equal(locOf(g, ff), 'base', 'Star Spring moved the Faefolk away');
  assert.ok(/Faefolk moves to base[\s\S]*V\(2\) moves to Star Spring/.test(logText(g)), 'the enemy unit still moved to Star Spring (then died in the combat)');
});

test('RJ#10928 Fading Memories gave my unit Temporary; in response to the Beginning-Phase Temporary trigger I play Tactical Retreat: it is healed, exhausted and recalled instead of dying', () => {
  const g0 = S0({ tp: P1 }); fundAll(g0, P0); fundAll(g0, P1);
  const u = put(g0, P0, 'V(2)', BF_A); control(g0, BF_A, P0);
  const tr = hand(g0, P0, 'Tactical Retreat');
  let g = drive(play(g0, P1, hand(g0, P1, 'Fading Memories'), { targets: [[u]] })).g;
  g = endTurn(g, P1);
  assert.ok(g.chain.length > 0, 'Temporary trigger on the chain');
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, tr, { targets: [[u]] });
  g = drive(g, gg => optionIds(gg).includes(u) ? [u] : undefined).g;
  assert.equal(locOf(g, u), 'base', 'recalled instead of dying');
});

test('RJ#10929 Solari Shieldbearer can be played with no other units in play (its trigger may stun itself)', () => {
  let g = S0(); fundAll(g, P0, 12);
  const s = hand(g, P0, 'Solari Shieldbearer');
  assert.ok(canPlayNow(g, P0, s));
  g = act(g, { type: 'playCard', player: P0, obj: s, destination: 'base' } as never);
  g = drive(g).g;
  assert.equal(zone(g, s), 'base');
  assert.equal(g.objects[s].stunned, true, 'the only unit: stunned itself');
});

test('RJ#10930 V(2) + Vilemaw attack four defenders with 13 Might total, all smaller than Vilemaw: they deal no damage, but 10 can\'t kill them all — no result, my attackers are recalled', () => {
  let { g, atk: [a] } = attackSetup(['V(2)'], ['V(4)', 'V(3)', 'V(3)', 'V(3)']);
  const vm = put(g, P0, 'Vilemaw', BF_A);
  g = drive(g).g;
  assert.equal(locOf(g, a), 'base'); assert.equal(locOf(g, vm), 'base', 'recalled');
  assert.equal(g.objects[vm].damage ?? 0, 0); assert.equal(g.objects[a].damage ?? 0, 0, 'no combat damage taken');
  assert.equal(g.battlefields[BF_A].controller, P1, 'defender keeps it');
});

test('RJ#10931 Cull the Weak; the opponent Gusts my unit in response: the Gusted unit isn\'t killed; the opponent still kills one of theirs — and since Cull chooses on resolution, a second unit of mine would die instead', () => {
  for (const second of [false, true]) {
    let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
    const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
    const u2 = second ? put(g, P0, 'V(4)', 'base') : undefined;
    const e = put(g, P1, 'V(1)', 'base');
    g = play(g, P0, hand(g, P0, 'Cull the Weak'));
    if (pend(g).player === P0) g = pass(g);
    g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[u]] });
    g = drive(g, gg => { const ids = optionIds(gg); return ids.includes(e) ? [e] : u2 && ids.includes(u2) ? [u2] : undefined; }).g;
    assert.equal(zone(g, u), 'hand', 'Gusted, not killed');
    assert.equal(zone(g, e), 'trash', 'opponent still kills theirs');
    if (u2) assert.equal(zone(g, u2), 'trash', 'my other unit is killed instead');
  }
});

test('RJ#10935 Desert\'s Call\'s Sand Soldier may be played to a battlefield I control', () => {
  let g = S0(); fundAll(g, P0, 12);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  let offered = false;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, "Desert's Call") } as never);
  g = drive(g, gg => { const o = optionIds(gg); if (o.includes(String(BF_A))) { offered = true; return [String(BF_A)]; } return gg.pending!.kind === 'optional' ? ['no'] : undefined; }).g;
  assert.ok(offered, 'battlefield offered');
  const ss = Object.values(g.objects).filter(o => g.cards[o.cardId]?.name === 'Sand Soldier' && o.zone === 'battlefield');
  assert.equal(ss.length, 1);
});

test('RJ#10937 Opponent moves into an empty battlefield (showdown); I play Rengar, Trophy Hunter there in response: combat follows with the opponent as Attacker and me as Defender', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12);
  const r = hand(g, P0, 'Rengar, Trophy Hunter');
  const a = put(g, P1, 'V(2)', 'base');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 8 && !(pend(g).player === P0 && !pend(g).inStep && canPlayNow(g, P0, r, BF_A)); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(canPlayNow(g, P0, r, BF_A), 'Rengar playable there (enemy units, none of mine)');
  g = play(g, P0, r, { dest: BF_A });
  for (let i = 0; i < 8 && !g.showdown?.isCombat; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.showdown?.isCombat, 'combat');
  assert.ok(/Combat at BF-A: P1 attacks, P0 defends/.test(logText(g)));
});

test('RJ#10938 Last Rites conquer: a [Hidden] unit in my trash can be played from there, but never hidden (no hide option, no hide action from the trash)', () => {
  let g = S0(); fundAll(g, P0, 12);
  const u = put(g, P0, 'V(2)', 'base');
  const lr = put(g, P0, 'Last Rites', 'base'); attachNow(g, lr, u);
  const ev = put(g, P0, 'Evelynn, Entrancing', 'trash');
  assert.ok(!legal(g, P0, 'hide').some(a => a.type === 'hide' && a.obj === ev), 'no hide from the trash');
  const labels: string[] = [];
  g = drive(move(g, P0, [u], BF_A), gg => { for (const o of gg.pending!.options ?? []) labels.push(o.label); const ids = optionIds(gg); return ids.includes(ev) ? [ev] : ids.includes('base') ? ['base'] : undefined; }).g;
  assert.ok(!labels.some(l => /hide|face ?down/i.test(l)), `no hide option (${labels})`);
  assert.equal(zone(g, ev), 'base', 'played face up');
});

test('RJ#10939 Retreat on my Ekko; I Sacrifice the same Ekko in response: Retreat\'s only target is gone, so it does nothing — no rune channeled', () => {
  let g = S0(); fundAll(g, P0, 12);
  const ek = put(g, P0, 'ogn-110-298', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_A);
  g = play(g, P0, hand(g, P0, 'Retreat'), { targets: [[ek]] });
  const sac = hand(g, P0, 'Sacrifice');
  if (pend(g).player !== P0) g = pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: sac } as never);
  g = drive(g, gg => { const ids = optionIds(gg); if (ids.includes(ek)) return [ek]; if (gg.pending!.kind === 'optional') return ['no']; return undefined; }, 3).g;
  for (let i = 0; i < 20 && g.chain.length; i++) { const d = pend(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: d.kind === 'optional' ? ['no'] : [d.options![0].id] }) : pass(g); }
  assert.equal(zone(g, ek), 'trash');
  assert.ok(!/Resolving Retreat[\s\S]*channels/.test(logText(g)), 'Retreat channeled nothing');
});

test('RJ#10940 Void Seeker deals 4 to Darius, Trifarian (5); then The List (naming Noxus) gives him -2: 4 marked damage is now lethal, he dies', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1, 12);
  const d = put(g, P0, 'ogn-027-298', BF_A); control(g, BF_A, P0);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'The List') } as never);
  g = drive(g, gg => { const o = gg.pending!.options?.find(x => /^Noxus$/i.test(x.label)); return o ? [o.id] : undefined; }).g;
  const tl = g.players[P1].base.find(id => g.cards[g.objects[id].cardId].name === 'The List')!;
  assert.ok(tl, 'The List in play');
  g = drive(play(g, P1, hand(g, P1, 'Void Seeker'), { targets: [[d]] })).g;
  assert.equal(g.objects[d].damage, 4); assert.equal(zone(g, d), 'battlefield');
  g = act(g, legal(g, P1, 'activate').find(a => a.type === 'activate' && a.obj === tl)!);
  g = drive(g, gg => optionIds(gg).includes(d) ? [d] : undefined).g;
  assert.equal(zone(g, d), 'trash');
});

test('RJ#10941 Here to Help played from hiding at BF-A on the opponent\'s turn: the unit must be played to BF-A, not to my other battlefield (CR 811.1.d.5)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  const hth = put(g, P0, 'Here to Help', { facedown: BF_A });
  const u = hand(g, P0, 'V(4)');
  g = play(g, P1, hand(g, P1, 'DrawR'));
  if (pend(g).player === P1) g = pass(g);
  assert.ok(canPlayNow(g, P0, hth));
  g = act(g, { type: 'playCard', player: P0, obj: hth } as never);
  const dests: string[][] = [];
  g = drive(g, gg => { const d = gg.pending!; const ids = optionIds(gg); if (d.kind === 'chooseDestination' || d.kind === 'chooseBattlefield') { dests.push(ids); return [ids[0]]; } if (ids.includes(u)) return [u]; return d.kind === 'optional' ? ['yes'] : undefined; }).g;
  for (const ids of dests) assert.ok(!ids.includes(String(BF_B)), `BF-B not offered (${ids})`);
  assert.equal(locOf(g, u), BF_A);
});

test('RJ#10942 Piercing Light on a battlefield unit, then a base unit; the opponent kills the first with a hidden Hidden Blade in response: the base unit still takes 2', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const eb = put(g, P1, 'V(5)', 'base');
  const hb = put(g, P1, 'Hidden Blade', { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Piercing Light') } as never);
  for (let i = 0; i < 12 && pend(g).inStep; i++) {
    const d = pend(g);
    if (d.kind === 'optional') { g = no(g); continue; }
    if (d.kind === 'chooseTargets') { g = choose(g, /other/.test(d.prompt ?? '') ? eb : e); continue; }
    g = choose(g, optionIds(g)[0]);
  }
  if (pend(g).player === P0) g = pass(g);
  g = play(g, P1, hb, { targets: [[e]] });
  g = drive(g).g;
  assert.notEqual(zone(g, e), 'battlefield', 'first target gone');
  assert.equal(g.objects[eb].damage, 2, 'base unit still dealt 2');
});

test('RJ#10944 Forge of the Future can\'t recycle itself: its "up to 4 cards from trashes" are chosen while it is still on the board', () => {
  let g = S0(); fundAll(g, P0);
  const f = put(g, P0, 'Forge of the Future', 'base');
  const t = put(g, P0, 'V(1)', 'trash');
  g = act(g, legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === f)!);
  let offeredSelf = false; let offered = false;
  g = drive(g, gg => { const ids = optionIds(gg); if (/Recycle/i.test(gg.pending!.prompt ?? '')) { offered = true; if (ids.includes(f)) offeredSelf = true; return ids.filter(x => x !== f); } return undefined; }).g;
  assert.ok(offered, 'choice offered');
  assert.ok(!offeredSelf, 'Forge itself not selectable');
  assert.equal(zone(g, f), 'trash', 'Forge stays in the trash');
  assert.equal(zone(g, t), 'mainDeck');
});

test('RJ#10945 Fizz plays Lunar Boon from the trash; I respond with my last card, Heedless Resurrection (killing Fizz): Lunar Boon then discards nothing and still draws 2', () => {
  let g = S0(); fundAll(g, P0, 20);
  const fz = hand(g, P0, 'Fizz, Trickster');
  const lb = put(g, P0, 'Lunar Boon', 'trash');
  const back = put(g, P0, 'V(1)', 'trash');
  const hr = hand(g, P0, 'Heedless Resurrection');
  for (const id of [...g.players[P0].hand]) if (id !== fz && id !== hr) { g.players[P0].hand = g.players[P0].hand.filter(x => x !== id); delete g.objects[id]; }
  g = act(g, { type: 'playCard', player: P0, obj: fz, destination: 'base' } as never);
  for (let i = 0; i < 12 && zone(g, lb) !== 'chain'; i++) { const d = pend(g); const ids = optionIds(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [ids.includes(lb) ? lb : d.kind === 'optional' ? 'yes' : ids[0]] }) : pass(g); }
  assert.equal(zone(g, lb), 'chain', 'Lunar Boon played from the trash');
  if (pend(g).player !== P0) g = pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: hr } as never);
  assert.equal(g.players[P0].hand.length, 0, 'hand now empty');
  g = drive(g, gg => { const ids = optionIds(gg); return ids.includes(fz) ? [fz] : ids.includes(back) ? [back] : ids.includes('base') ? ['base'] : undefined; }, 60).g;
  assert.equal(zone(g, back), 'base', 'Heedless Resurrection played the unit');
  assert.equal(g.players[P0].hand.length, 2, 'Lunar Boon drew 2');
});

test('RJ#10947 I Star-Crossed the opponent\'s Elder Dragon in response to its play trigger; they respond with Flurry of Blades: it resolves (and its kills happen) while the Dragon is still on the board — my battlefield units die', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); setRunes(g, P1, 0); addRunes(g, P1, 12, 'order'); addRunes(g, P1, 4, 'body'); addRunes(g, P1, 4, 'fury');
  const u1 = put(g, P0, 'V(5)', BF_A); control(g, BF_A, P0);
  const u2 = put(g, P0, 'V(4)', BF_B); control(g, BF_B, P0);
  const ed = hand(g, P1, 'Elder Dragon');
  const fob = hand(g, P1, 'Flurry of Blades');
  g = act(g, { type: 'playCard', player: P1, obj: ed, destination: 'base' } as never);
  for (let i = 0; i < 10 && !(chainLabels(g).some(l => /Elder Dragon/.test(l)) && pend(g).player === P0 && !pend(g).inStep); i++) { const d = pend(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: d.kind === 'chooseTargets' ? [] : [d.options![0].id] }) : pass(g); }
  assert.ok(chainLabels(g).some(l => /Elder Dragon/.test(l)), 'Dragon trigger on the chain');
  g = play(g, P0, hand(g, P0, 'Star-Crossed'), { targets: [[u2], [ed]] });
  for (let i = 0; i < 4 && pend(g).inStep; i++) { const ids = optionIds(g); g = act(g, { type: 'choose', player: pend(g).player, optionIds: [ids.includes(u2) ? u2 : ids.includes(ed) ? ed : ids[0]] }); }
  if (pend(g).player === P0) g = pass(g);
  g = play(g, P1, fob);
  g = drive(g, gg => gg.pending!.kind === 'chooseTargets' ? [] : undefined).g;
  assert.equal(zone(g, u1), 'trash', '1 damage was lethal (Dragon still on the board at that cleanup)');
  assert.equal(zone(g, u2), 'trash');
  assert.equal(zone(g, ed), 'hand', 'then Star-Crossed found only the Dragon');
});

test('RJ#10949 (MISMATCH-RJ) Ruined Rex and Irelia, Fervent (Guardian Angel) kill each other in combat: GA recalls Irelia, but Rex\'s "Deal 4 to an enemy unit" can still choose her in base — and its Deflect cost may be refused (trigger removed)', () => {
  let { g, atk: [rex], def: [ir] } = attackSetup(['Ruined Rex'], ['Irelia, Fervent'], { atkOpts: [{ damage: 2 }] });
  fundAll(g, P0, 12);
  const ga = put(g, P1, 'Guardian Angel', 'base'); attachNow(g, ga, ir);
  const seen: string[] = [];
  let offeredIr = false;
  g = drive(g, gg => { const d = gg.pending!; seen.push(`${d.kind}:P${d.player}:${d.prompt}`); if (d.player === P0 && optionIds(gg).includes(ir)) { offeredIr = true; return [ir]; } if (d.player === P0 && d.kind === 'optional' && /Deflect/i.test(d.prompt)) return ['no']; return undefined; }, 80).g;
  assert.equal(zone(g, rex), 'trash');
  assert.equal(locOf(g, ir), 'base', 'Guardian Angel recalled Irelia');
  assert.ok(offeredIr || /Deal 4 to an enemy unit: Irelia \(base\)/.test(logText(g)), 'Irelia in base is a legal (here the only, so mandatory) Deathknell target');
  assert.ok(seen.some(s => /Deflect/i.test(s)), 'Deflect cost offered — and refusable');
  assert.equal(g.objects[ir].damage ?? 0, 0, 'Deflect refused: no damage');
});

test('RJ#10950 After scoring a battlefield, my last unit leaves it (control lost) and comes back: a showdown starts there again, I regain control, but no second point', () => {
  let g = S0(); fundAll(g, P0, 12);
  const a = put(g, P0, 'V(2)', 'base');
  g = drive(move(g, P0, [a], BF_A)).g;
  assert.equal(g.players[P0].points, 1, 'conquered once');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Ride the Wind') } as never);
  g = drive(g, gg => { const ids = optionIds(gg); return ids.includes(a) ? [a] : ids.includes('base') ? ['base'] : undefined; }).g;
  assert.equal(locOf(g, a), 'base'); assert.notEqual(g.battlefields[BF_A].controller, P0, 'control lost');
  const n0 = (logText(g).match(/Showdown at BF-A/g) ?? []).length;
  g = drive(move(g, P0, [a], BF_A)).g;
  assert.equal((logText(g).match(/Showdown at BF-A/g) ?? []).length, n0 + 1, 'a new showdown');
  assert.equal(g.battlefields[BF_A].controller, P0, 'control regained');
  assert.equal(g.players[P0].points, 1, 'no second point this turn');
});

test('RJ#10952 Deathgrip: the opponent Gusts one of its targets in response — the rest happens as possible, and the draw always happens', () => {
  for (const gone of ['kill', 'bonus'] as const) {
    let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
    const k = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
    const b = put(g, P0, 'V(2)', BF_A);
    const dg = hand(g, P0, 'Deathgrip');
    const h0 = g.players[P0].hand.length - 1;
    g = act(g, { type: 'playCard', player: P0, obj: dg } as never);
    for (let i = 0; i < 6 && pend(g).inStep; i++) { const ids = optionIds(g); g = act(g, { type: 'choose', player: P0, optionIds: [ids.includes(k) ? k : ids.includes(b) ? b : ids[0]] }); }
    if (pend(g).player === P0) g = pass(g);
    const victim = gone === 'kill' ? k : b;
    g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[victim]] });
    g = drive(g).g;
    assert.equal(zone(g, victim), 'hand');
    if (gone === 'bonus') assert.equal(zone(g, k), 'trash', 'the kill still happens');
    else assert.equal(mightOf(g, b), 2, 'no kill → no bonus');
    assert.equal(g.players[P0].hand.length, h0 + 1 + 1, `drew 1 (+ the Gusted unit; ${gone} target gone)`);
  }
});

test('RJ#10954 Void Assault moves my Yone, Blademaster into the enemy\'s battlefield and its only unit (Rengar) to base: the battlefield becomes uncontrolled first, so Yone\'s conquer trigger fires (hits Rengar in base)', () => {
  let g = S0(); fundAll(g, P0, 12);
  const y = put(g, P0, 'sfd-116-221', 'base');
  const r = put(g, P1, 'Rengar, Trophy Hunter', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Void Assault') } as never);
  for (let i = 0; i < 8 && pend(g).inStep; i++) g = answer(g, { targets: [[y], [r]], locations: [BF_A, 'base'] });
  g = drive(g, gg => optionIds(gg).includes(r) ? [r] : undefined).g;
  assert.equal(locOf(g, y), BF_A);
  assert.ok(zone(g, r) === 'trash' || (locOf(g, r) === 'base' && (g.objects[r].damage ?? 0) > 0), 'Rengar in base was hit');
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  assert.ok(/Resolving Yone/.test(logText(g)), 'Yone\'s "was uncontrolled" conquer trigger fired');
});

test('RJ#10956 Flurry of Blades marks 1 on the enemy units; at end of turn Dazzling Aurora plays Elder Dragon: the cleanup after it enters kills them (my damage is now lethal) before its play trigger lets anyone respond', () => {
  let g = S0(); setRunes(g, P0, 0); addRunes(g, P0, 6, 'fury');
  put(g, P0, 'Dazzling Aurora', 'base');
  const ed = put(g, P0, 'Elder Dragon', 'deckTop');
  const e1 = put(g, P1, 'V(3)', BF_A), e2 = put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  fundAll(g, P1, 12); const sc = hand(g, P1, 'Star-Crossed'); put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  g = drive(play(g, P0, hand(g, P0, 'Flurry of Blades'))).g;
  assert.equal(g.objects[e1].damage, 1);
  g = endTurn(g, P0);
  let deadWhenAsked: boolean | null = null;
  for (let i = 0; i < 30 && zone(g, ed) !== 'base'; i++) { const d = pend(g); if (!d || d.kind === 'mainAction') break; g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: d.kind === 'optional' ? ['yes'] : [d.options![0].id] }) : pass(g); }
  assert.equal(zone(g, ed), 'base', 'Elder Dragon played');
  for (let i = 0; i < 30; i++) { const d = pend(g); if (!d || d.kind === 'mainAction') break; if (d.player === P1 && !d.inStep && canPlayNow(g, P1, sc) && deadWhenAsked === null) deadWhenAsked = zone(g, e1) === 'trash' && zone(g, e2) === 'trash'; g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: d.kind === 'optional' ? ['no'] : d.kind === 'chooseTargets' ? [] : [d.options![0].id] }) : pass(g); }
  assert.equal(zone(g, e1), 'trash'); assert.equal(zone(g, e2), 'trash');
  if (deadWhenAsked !== null) assert.ok(deadWhenAsked, 'already dead at the first response window');
});

test('RJ#10958 (MISMATCH-RJ) Thousand-Tailed Watcher\'s -3 (min 1) on my 4-Might unit at Frozen Fortress expires at end of that turn, so the Fortress\'s 1 damage at the next Beginning Phase doesn\'t kill it', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1, 12); setBattlefieldCard(g, BF_A, 'Frozen Fortress');
  const u = put(g, P0, 'V(4)', BF_A); control(g, BF_A, P0);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Thousand-Tailed Watcher'), destination: 'base' } as never);
  g = drive(g, gg => gg.pending!.kind === 'optional' ? ['no'] : undefined).g;
  assert.equal(mightOf(g, u), 1, '-3 to a minimum of 1 this turn');
  g = endTurn(g, P1);
  for (let i = 0; i < 20 && !(g.activePlayer === P0 && pend(g).kind === 'mainAction'); i++) { const d = pend(g); g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g); }
  assert.ok(/Frozen Fortress/.test(logText(g)), 'Fortress triggered');
  assert.equal(zone(g, u), 'battlefield', 'survives: back to 4 Might when the 1 damage is dealt');
  assert.equal(mightOf(g, u), 4);
  assert.equal(g.objects[u].damage, 1, 'the Fortress dealt 1');
});

test('RJ#10959 Opponent\'s Charm on the chain; I Ambush Rengar, Trophy Hunter in response: after Rengar resolves, the opponent (controller of the Charm, now the top item) gets priority again', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const mine = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  const r = hand(g, P0, 'Rengar, Trophy Hunter');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Charm') } as never);
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const ids = optionIds(g); g = act(g, { type: 'choose', player: P1, optionIds: [ids.includes(mine) ? mine : ids.includes('base') ? 'base' : ids[0]] }); }
  if (pend(g).player === P1) g = pass(g);
  g = play(g, P0, r, { dest: BF_A });
  for (let i = 0; i < 6 && zone(g, r) !== 'battlefield'; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(locOf(g, r), BF_A, 'Rengar resolved');
  assert.ok(chainLabels(g).some(l => /Charm/.test(l)), 'Charm still on the chain');
  assert.equal(pend(g).player, P1, 'the Charm\'s controller has priority');
});

test('RJ#10960 Wuju Bladesman (Master Yi legend) +2 to the lone defender applies first; Fiora, Peerless\'s defend trigger then doubles 5 → 10', () => {
  let g = S0({ tp: P1 }); setLegend(g, P0, 'Wuju Bladesman');
  const f = put(g, P0, 'Fiora, Peerless', BF_A); control(g, BF_A, P0);
  g = move(g, P1, [put(g, P1, 'V(1)', 'base')], BF_A);
  for (let i = 0; i < 10 && (g.chain.length || pend(g).inStep || !g.showdown); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, f), 10);
});

test('RJ#10961 Attacking: Heedless Resurrection (killing my attacker) can\'t play the unit to the battlefield I\'m attacking — not controlled', () => {
  let { g, atk: [a] } = attackSetup(['Ruined Rex'], ['V(9)']);
  fundAll(g, P0, 12);
  const back = put(g, P0, 'V(2)', 'trash');
  const hr = hand(g, P0, 'Heedless Resurrection');
  for (let i = 0; i < 6 && !(pend(g).player === P0 && pend(g).kind === 'showdownAction' && canPlayNow(g, P0, hr)); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: hr } as never);
  const dests: string[][] = [];
  g = drive(g, gg => { const ids = optionIds(gg); if (gg.pending!.kind === 'chooseDestination' && ids.includes('base')) { dests.push(ids); return ['base']; } return ids.includes(a) ? [a] : ids.includes(back) ? [back] : undefined; }, 60).g;
  assert.equal(zone(g, back), 'base', 'unit played to base (the only legal destination)');
  for (const ids of dests) assert.ok(!ids.includes(String(BF_A)), 'attacked battlefield not offered');
});

test('RJ#10962 Imperial Decree + repeated Bellows Breath on Irelia, Fervent with Guardian Angel: two damage events → two Decree kills; GA saves her from one (recall), the other kills her in base', () => {
  let g = S0(); fundAll(g, P0, 20); fundAll(g, P1, 20);
  const ir = put(g, P1, 'Irelia, Fervent', BF_A); control(g, BF_A, P1);
  const ga = put(g, P1, 'Guardian Angel', 'base'); attachNow(g, ga, ir);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Imperial Decree') } as never)).g;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bellows Breath') } as never);
  g = drive(g, gg => { const d = gg.pending!; if (d.kind === 'optional') return [/Repeat|Deflect/i.test(d.prompt) ? 'yes' : 'no']; return optionIds(gg).includes(ir) ? [ir] : undefined; }, 80).g;
  assert.equal(zone(g, ga), 'trash', 'Guardian Angel used');
  assert.equal(zone(g, ir), 'trash', 'the second Decree kill gets her in base');
});

test('RJ#10963 Bellows Breath marks 1 on an enemy 4-Might unit; then Thousand-Tailed Watcher\'s -3 (4 → 1) makes it lethal: it dies', () => {
  let g = S0(); fundAll(g, P0, 20);
  const e = put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bellows Breath') } as never);
  g = drive(g, gg => { const d = gg.pending!; if (d.kind === 'optional') return ['no']; return optionIds(gg).includes(e) ? [e] : undefined; }).g;
  assert.equal(g.objects[e].damage, 1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Thousand-Tailed Watcher'), destination: 'base' } as never);
  g = drive(g, gg => gg.pending!.kind === 'optional' ? ['no'] : undefined).g;
  assert.equal(zone(g, e), 'trash');
});

test('RJ#10964 Attacking: I may play Janna, Savior (Reaction) during the combat showdown, but only to base or a battlefield I control — not the attacked one', () => {
  let { g } = attackSetup(['V(3)'], ['V(3)']);
  fundAll(g, P0, 12);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  const j = hand(g, P0, 'Janna, Savior');
  for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(canPlayNow(g, P0, j), 'playable in the showdown');
  const dests = playDests(g, P0, j).map(String);
  assert.ok(dests.includes(String(BF_B)) && dests.includes('base'), `base / my battlefield (${dests})`);
  assert.ok(!dests.includes(String(BF_A)), 'not the attacked battlefield');
});

test('RJ#10967 Safety Inspector with no other units of mine (no XP paid): "each player must kill one of their units" includes the Inspector itself — it dies; the opponent kills one of theirs', () => {
  let g = S0(); fundAll(g, P0, 12);
  const e = put(g, P1, 'V(2)', 'base');
  const si = hand(g, P0, 'Safety Inspector');
  assert.ok(canPlayNow(g, P0, si), 'playable');
  g = act(g, { type: 'playCard', player: P0, obj: si, destination: 'base' } as never);
  g = drive(g, gg => gg.pending!.kind === 'optional' ? ['no'] : undefined).g;
  assert.equal(zone(g, e), 'trash', 'opponent killed theirs');
  assert.equal(zone(g, si), 'trash', 'the Inspector was my only unit');
});

test('RJ#10970 An Ambush unit can be played to base in my open main phase (Ambush only adds Reaction timing to a battlefield with my units)', () => {
  const g = S0(); fundAll(g, P0, 12);
  const kz = hand(g, P0, 'unl-143-219');
  assert.ok(playDests(g, P0, kz).includes('base'), 'base allowed');
});

test('RJ#10971 Fiora, Peerless doubles her total Might including an attached Equipment\'s bonus (3 + Long Sword → doubled)', () => {
  let g = S0({ tp: P1 });
  const f = put(g, P0, 'Fiora, Peerless', BF_A); control(g, BF_A, P0);
  const sw = put(g, P0, 'Long Sword', 'base'); attachNow(g, sw, f);
  const m0 = mightOf(g, f)!;
  assert.ok(m0 > 3, 'equipment bonus applies');
  g = move(g, P1, [put(g, P1, 'V(1)', 'base')], BF_A);
  for (let i = 0; i < 10 && (g.chain.length || pend(g).inStep || !g.showdown); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, f), m0 * 2);
});

test('RJ#10972 Channelling with an empty rune deck (all 12 runes out) does nothing: no new rune, no readying, no floating resources', () => {
  let g = S0(); fundAll(g, P0, 12); hand(g, P0, 'V(1)'); hand(g, P0, 'V(1)');
  const ex = g.players[P0].runesInPlay.slice(0, 3); for (const r of ex) g.objects[r].exhausted = true;
  for (const r of g.players[P0].runeDeck) delete g.objects[r];
  g.players[P0].runeDeck = [];
  const n0 = g.players[P0].runesInPlay.length;
  const pool0 = JSON.stringify(g.players[P0].pool ?? null);
  g = drive(play(g, P0, hand(g, P0, 'Retreat'), { targets: [[put(g, P0, 'V(2)', 'base')]] })).g;
  assert.equal(g.players[P0].runesInPlay.length, n0, 'no rune channelled');
  assert.ok(ex.every(r => g.objects[r].exhausted), 'nothing readied');
  assert.equal(JSON.stringify(g.players[P0].pool ?? null), pool0, 'no floating resources');
});

test('RJ#10973 Relentless Pursuit can move an exhausted unit (no ready requirement); it arrives still exhausted', () => {
  let g = S0(); fundAll(g, P0, 12);
  const u = put(g, P0, 'V(2)', 'base'); g.objects[u].exhausted = true;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Relentless Pursuit') } as never);
  let offered = false;
  g = drive(g, gg => { const d = gg.pending!; const ids = optionIds(gg); if (ids.includes(u)) { offered = true; return [u]; } if (d.kind === 'optional') return ['no']; return ids.includes(String(BF_A)) ? [String(BF_A)] : d.kind === 'chooseTargets' ? [] : undefined; }).g;
  assert.ok(offered || /Relentless Pursuit/.test(logText(g)), 'played');
  assert.equal(locOf(g, u), BF_A);
  assert.equal(g.objects[u].exhausted, true);
});

test('RJ#10974 A damaged unit conquering an empty battlefield (non-combat showdown) is not healed', () => {
  let g = S0();
  const u = put(g, P0, 'V(4)', 'base', { damage: 2 });
  g = drive(move(g, P0, [u], BF_A)).g;
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  assert.equal(g.objects[u].damage, 2, 'still damaged');
});

test('RJ#10975 Damaged enemy defender Flashes to base during the combat showdown: combat still reaches its cleanup, which heals all units — including it', () => {
  let { g, def: [d] } = attackSetup(['V(3)'], ['V(5)'], { defOpts: [{ damage: 3 }] });
  fundAll(g, P1, 12);
  for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P1); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = play(g, P1, hand(g, P1, 'Flash'), { targets: [[d]] });
  g = drive(g, gg => optionIds(gg).includes(d) ? [d] : undefined).g;
  assert.equal(locOf(g, d), 'base');
  assert.equal(g.objects[d].damage ?? 0, 0, 'healed by the combat cleanup');
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#10977 Star-Crossed returns the attacking Leona, Determined in response to her attack trigger: "stun an enemy unit here" no longer has a "here" — my unit isn\'t stunned', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12);
  const mine = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const other = put(g, P0, 'V(1)', 'base');
  const le = put(g, P1, 'Leona, Determined', 'base');
  g = move(g, P1, [le], BF_A);
  for (let i = 0; i < 8 && !(chainLabels(g).some(l => /Leona/.test(l)) && pend(g).player === P0 && !pend(g).inStep); i++) { const d = pend(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: optionIds(g).includes(mine) ? [mine] : d.kind === 'optional' ? ['yes'] : [d.options![0].id] }) : pass(g); }
  assert.ok(chainLabels(g).some(l => /Leona/.test(l)), 'attack trigger on the chain');
  g = play(g, P0, hand(g, P0, 'Star-Crossed'), { targets: [[other], [le]] });
  g = drive(g, gg => { const ids = optionIds(gg); return ids.includes(other) ? [other] : ids.includes(le) ? [le] : undefined; }).g;
  assert.equal(zone(g, le), 'hand');
  assert.ok(!g.objects[mine].stunned, 'not stunned');
});

test('RJ#10978 Guards!: the Sand Soldier is played either way; paying [C] afterwards is optional and only readies it', () => {
  for (const pay of [false, true]) {
    let g = S0(); fundAll(g, P0, 12);
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Guards!') } as never);
    g = drive(g, gg => { const d = gg.pending!; if (d.kind === 'optional') return [pay ? 'yes' : 'no']; return optionIds(gg).includes('base') ? ['base'] : undefined; }).g;
    const s = Object.keys(g.objects).find(id => g.objects[id].isToken && g.cards[g.objects[id].cardId]?.name === 'Sand Soldier' && ['base', 'battlefield'].includes(g.objects[id].zone));
    assert.ok(s, `Sand Soldier played (pay=${pay})`);
    assert.equal(g.objects[s!].exhausted, !pay);
  }
});

test('RJ#10979 Assault doesn\'t apply when moving into an empty battlefield (non-combat showdown: not an attacker)', () => {
  let g = S0();
  const lb = put(g, P0, 'LeBlanc, Fragmented', 'base');
  g = move(g, P0, [lb], BF_A);
  assert.ok(g.showdown && !g.showdown.isCombat, 'non-combat showdown');
  assert.equal(mightOf(g, lb), 3, 'no Assault bonus');
});

test('RJ#10980 The opponent\'s spell choosing my Jae Medarda doesn\'t make me draw ("When you choose me")', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1, 12);
  const jae = put(g, P0, 'Jae Medarda', BF_A); control(g, BF_A, P0);
  const h0 = g.players[P0].hand.length;
  g = drive(play(g, P1, hand(g, P1, 'Void Seeker'), { targets: [[jae]] })).g;
  assert.equal(g.players[P0].hand.length, h0, 'no draw for me');
  assert.ok(!/Trigger: Jae Medarda/.test(logText(g)));
});

test('RJ#10981 Kato the Arm\'s move trigger chooses its unit as it is chained: an Ambush unit played there in response can\'t receive the bonus', () => {
  let g = S0(); fundAll(g, P0, 12);
  const k = put(g, P0, 'Kato the Arm', 'base');
  const o = put(g, P0, 'V(1)', 'base');
  const kz = hand(g, P0, 'unl-143-219');
  g = move(g, P0, [k], BF_A);
  for (let i = 0; i < 6 && !(pend(g).player === P0 && !pend(g).inStep && chainLabels(g).some(l => /Kato/.test(l))); i++) { const d = pend(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [optionIds(g).includes(o) ? o : d.options![0].id] }) : pass(g); }
  assert.ok(chainLabels(g).some(l => /Kato/.test(l)), 'Kato trigger on the chain (target chosen)');
  g = play(g, P0, kz, { dest: BF_A });
  g = drive(g, gg => optionIds(gg).includes(o) ? [o] : undefined).g;
  assert.equal(locOf(g, kz), BF_A);
  assert.equal(mightOf(g, o), 1 + mightOf(g, k)!, 'the unit chosen earlier got +Might');
  assert.equal(mightOf(g, kz), 4, 'the Ambush unit got nothing');
});

test('RJ#10982 Opponent\'s Star-Crossed on my Ruined Rex; I respond with Sacrifice killing Rex for its cost: the Deathknell resolves first, then Sacrifice, then Star-Crossed (Rex part ignored)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const rex = put(g, P0, 'Ruined Rex', BF_A); control(g, BF_A, P0);
  const own = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  const e2 = put(g, P1, 'V(3)', 'base');
  g = play(g, P1, hand(g, P1, 'Star-Crossed'), { targets: [[own], [rex]] });
  for (let i = 0; i < 4 && pend(g).inStep; i++) { const ids = optionIds(g); g = act(g, { type: 'choose', player: pend(g).player, optionIds: [ids.includes(own) ? own : ids.includes(rex) ? rex : ids[0]] }); }
  if (pend(g).player === P1) g = pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Sacrifice') } as never);
  for (let i = 0; i < 4 && pend(g).inStep; i++) { const ids = optionIds(g); g = act(g, { type: 'choose', player: pend(g).player, optionIds: [ids.includes(rex) ? rex : ids.includes(e2) ? e2 : ids[0]] }); }
  const labels = chainLabels(g);
  assert.equal(zone(g, rex), 'trash');
  assert.match(labels[0], /Star-Crossed/);
  assert.match(labels.at(-1)!, /Ruined Rex/, `Deathknell on top (${labels})`);
  g = drive(g, gg => optionIds(gg).includes(e2) ? [e2] : undefined).g;
  const L = logText(g);
  assert.ok(L.indexOf('Resolving Ruined Rex') < L.indexOf('Resolving Sacrifice') && L.indexOf('Resolving Sacrifice') < L.lastIndexOf('Resolving Star-Crossed'), 'Deathknell → Sacrifice → Star-Crossed');
  assert.equal(zone(g, own), 'hand', 'Star-Crossed still returned its other target');
});

test('RJ#10983 Karthus makes Ruined Rex\'s Deathknell trigger twice; one Not So Fast counters only one of the two items', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1, 12);
  put(g, P0, 'Karthus, Eternal', 'base');
  const rex = put(g, P0, 'Ruined Rex', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(9)', BF_B); control(g, BF_B, P1);
  const nsf = hand(g, P1, 'Not So Fast');
  g = play(g, P1, hand(g, P1, 'Hidden Blade'), { targets: [[rex]] });
  for (let i = 0; i < 12 && !(chainLabels(g).filter(l => /Ruined Rex/.test(l)).length === 2 && pend(g).player === P1 && !pend(g).inStep); i++) { const d = pend(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [optionIds(g).includes(e) ? e : d.kind === 'optional' ? 'yes' : d.options![0].id] }) : pass(g); }
  assert.equal(chainLabels(g).filter(l => /Ruined Rex/.test(l)).length, 2, 'two Deathknell items');
  g = play(g, P1, nsf);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, { type: 'choose', player: P1, optionIds: [pend(g).options![0].id] });
  g = drive(g).g;
  assert.equal(g.objects[e].damage, 4, 'the other Deathknell still dealt 4');
});

test('RJ#10984 Opponent\'s lone defender has Wuju Bladesman\'s +2; my Moonfall pulls their Akshan in: no longer alone (+2 gone), and both get -2', () => {
  let { g, def: [yi] } = attackSetup(['V(4)'], ['V(3)']);
  fundAll(g, P0, 12); setLegend(g, P1, 'Wuju Bladesman');
  const ak = put(g, P1, 'Akshan, Mischievous', 'base');
  for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0 && g.chain.length === 0); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, yi), 5, 'defending alone: +2');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Moonfall') } as never);
  for (let i = 0; i < 10 && (pend(g).inStep || g.chain.length); i++) { const d = pend(g); const ids = optionIds(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [ids.includes(String(BF_A)) ? String(BF_A) : ids.includes(ak) ? ak : d.kind === 'optional' ? 'yes' : ids[0]] }) : pass(g); }
  assert.equal(locOf(g, ak), BF_A, 'Akshan pulled in');
  assert.equal(mightOf(g, yi), 1, '3, no longer alone (no +2), -2 from Moonfall');
});

test('RJ#10986 Opponent\'s The Ruination; I reveal a hidden Evelynn, Entrancing in response: legal, but (not my turn) no move trigger, Ruination kills her too and the battlefield is lost', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); fundAll(g, P1, 20);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const ev = put(g, P0, 'Evelynn, Entrancing', { facedown: BF_A });
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  g = play(g, P1, hand(g, P1, 'The Ruination'));
  if (pend(g).player === P1) g = pass(g);
  assert.ok(canPlayNow(g, P0, ev), 'hidden: Reaction timing');
  g = play(g, P0, ev);
  g = drive(g, gg => gg.pending!.kind === 'optional' ? ['yes'] : undefined).g;
  assert.ok(!/Trigger: Evelynn/.test(logText(g)), 'no trigger on the opponent\'s turn');
  assert.equal(zone(g, ev), 'trash'); assert.equal(zone(g, u), 'trash');
  assert.notEqual(g.battlefields[BF_A].controller, P0, 'battlefield lost');
});

test('RJ#10989 Void Assault moves my Kha\'Zix into the enemy battlefield and one of their two units to base; a facedown card there is not a unit, so the remaining enemy unit is alone: +2', () => {
  let g = S0(); fundAll(g, P0, 12);
  const kz = put(g, P0, 'unl-143-219', BF_A); control(g, BF_A, P0);
  const e1 = put(g, P1, 'V(9)', BF_B); const e2 = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  put(g, P1, 'Hidden Blade', { facedown: BF_B });
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Void Assault') } as never);
  let nd = 0;
  for (let i = 0; i < 8 && pend(g).inStep; i++) { const d = pend(g); const ids = optionIds(g); const pick = d.kind === 'chooseDestination' ? (nd++ === 0 ? String(BF_B) : 'base') : ids.includes(kz) ? kz : ids.includes(e1) ? e1 : ids[0]; g = act(g, { type: 'choose', player: d.player, optionIds: [pick] }); }
  for (let i = 0; i < 12 && !(g.showdown?.isCombat && g.chain.length === 0 && /Resolving Kha'Zix/.test(logText(g))); i++) { const d = pend(g); if (d.kind === 'mainAction') break; g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g); }
  assert.equal(locOf(g, e1), 'base'); assert.equal(locOf(g, kz), BF_B);
  assert.ok(/Resolving Kha'Zix/.test(logText(g)), 'Kha\'Zix\'s attack trigger (enemy unit alone)');
  void e2;
});

test('RJ#10990 My Star-Crossed; the opponent Thrill of the Hunts the enemy target (banished and replayed as a new object): my friendly unit still returns, the enemy part is ignored', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const f = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(3)', BF_B); control(g, BF_B, P1);
  g = play(g, P0, hand(g, P0, 'Star-Crossed'), { targets: [[f], [e]] });
  for (let i = 0; i < 4 && pend(g).inStep; i++) { const ids = optionIds(g); g = act(g, { type: 'choose', player: P0, optionIds: [ids.includes(f) ? f : ids.includes(e) ? e : ids[0]] }); }
  if (pend(g).player === P0) g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Thrill of the Hunt') } as never);
  g = drive(g, gg => { const ids = optionIds(gg); return ids.includes(e) ? [e] : ids.includes(String(BF_B)) ? [String(BF_B)] : gg.pending!.kind === 'optional' ? ['no'] : undefined; }).g;
  assert.equal(zone(g, f), 'hand', 'friendly unit returned');
  assert.equal(locOf(g, e), BF_B, 'the replayed enemy unit stays');
});

test('RJ#10992 Discipline / Void Seeker whose only target left play still draws 1 (the draw is independent of the target, CR 359.3.e)', () => {
  for (const sp of ['Discipline', 'Void Seeker']) {
    let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
    const own = sp === 'Discipline';
    const t = put(g, own ? P0 : P1, 'V(2)', BF_A); control(g, BF_A, own ? P0 : P1);
    const s = hand(g, P0, sp);
    const h0 = g.players[P0].hand.length - 1;
    g = play(g, P0, s, { targets: [[t]] });
    if (pend(g).player === P0) g = pass(g);
    g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[t]] });
    g = drive(g).g;
    assert.equal(zone(g, t), 'hand', 'target gone');
    assert.equal(g.players[P0].hand.length - (own ? 1 : 0), h0 + 1, `${sp}: still drew 1`);
  }
});

test('RJ#10994 Grim Apothecary played to a battlefield with Pridestalker (Rengar legend): order both triggers, give another unit +1, then the Apothecary may return itself to hand', () => {
  let g = S0(); fundAll(g, P0, 12); setLegend(g, P0, 'Pridestalker');
  const o = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const ga = hand(g, P0, 'Grim Apothecary');
  g = play(g, P0, ga, { dest: BF_A });
  let ordered = false;
  g = drive(g, gg => { const d = gg.pending!; if (d.kind === 'orderTriggers') { ordered = true; const x = d.options!.find(z => /Grim Apothecary/.test(z.label)); return [x ? x.id : d.options![0].id]; } if (d.kind === 'optional') return ['yes']; const ids = optionIds(gg); if (/\+1/.test(d.prompt ?? '') && ids.includes(o)) return [o]; return ids.includes(ga) ? [ga] : ids.includes(o) ? [o] : undefined; }).g;
  assert.ok(ordered, 'I ordered the two triggers');
  assert.equal(mightOf(g, o), 2, 'Pridestalker +1 on the other unit');
  assert.equal(zone(g, ga), 'hand', 'Apothecary returned itself');
});

test('RJ#10995 My Gust\'s target is pumped above 3 in response (Discipline): Gust does nothing, but it was still played — Ravenbloom Student gets +1', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const rs = put(g, P0, 'Ravenbloom Student', 'base');
  const m0 = mightOf(g, rs)!;
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Gust'), { targets: [[e]] });
  if (pend(g).player === P0) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Discipline'), { targets: [[e]] });
  g = drive(g).g;
  assert.equal(locOf(g, e), BF_A, 'Gust did nothing');
  assert.equal(mightOf(g, rs), m0 + 1);
});

test('RJ#10996 Akshan, Mischievous steals an exhausted gear: it stays exhausted (and a ready one stays ready)', () => {
  for (const ex of [true, false]) {
    let g = S0(); fundAll(g, P0, 12);
    const gear = put(g, P1, 'Baited Hook', 'base'); g.objects[gear].exhausted = ex;
    const ak = hand(g, P0, 'Akshan, Mischievous');
    g = act(g, { type: 'playCard', player: P0, obj: ak, destination: 'base' } as never);
    g = drive(g, gg => { const d = gg.pending!; if (d.kind === 'optional') return ['yes']; return optionIds(gg).includes(gear) ? [gear] : undefined; }).g;
    assert.equal(g.objects[gear].controller, P0, 'stolen');
    assert.equal(g.objects[gear].exhausted, ex);
  }
});

test('RJ#10997 (MISMATCH-RJ, partial) Smoke Screen on my Rift Herald (7) still on the chain: Gust can\'t be played on it — it has more than 3 Might when targets are chosen; once Smoke Screen resolves (3), Gust can return it', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const rh = put(g, P0, 'Rift Herald', BF_A); control(g, BF_A, P0);
  const gust = hand(g, P1, 'Gust');
  g = play(g, P1, hand(g, P1, 'Smoke Screen'), { targets: [[rh]] });
  assert.equal(pend(g).player, P1);
  assert.equal(canPlayNow(g, P1, gust), false, 'no legal Gust target while the Herald is 7');
  for (let i = 0; i < 4 && g.chain.length; i++) g = pass(g);
  assert.equal(mightOf(g, rh), 3);
  g = drive(play(g, P1, gust, { targets: [[rh]] })).g;
  assert.equal(zone(g, rh), 'hand');
});

test('RJ#11000 My Vex, Apathetic stuns the opponent\'s Elder Dragon as it is played; its play trigger still deals 1 (lethal: its passive still works while stunned)', () => {
  let g = S0({ tp: P1 }); setRunes(g, P1, 0); addRunes(g, P1, 12, 'order'); addRunes(g, P1, 4, 'body');
  put(g, P0, 'unl-150-219', BF_A); control(g, BF_A, P0);
  const u = put(g, P0, 'V(5)', BF_B); control(g, BF_B, P0);
  const ed = hand(g, P1, 'Elder Dragon');
  g = act(g, { type: 'playCard', player: P1, obj: ed, destination: 'base' } as never);
  g = drive(g, gg => optionIds(gg).includes(u) ? [u] : undefined).g;
  assert.ok(g.objects[ed].stunned, 'Elder Dragon stunned');
  assert.equal(zone(g, u), 'trash', '1 damage from the play trigger was lethal');
});

test('RJ#11001 Prodigal Explorer (Ezreal legend): The List\'s gear ability choosing an enemy unit doesn\'t count (only spells and unit abilities); one spell + The List is not "twice"', () => {
  let g = S0(); fundAll(g, P0, 12);
  const l = setLegend(g, P0, 'Prodigal Explorer');
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  g.cards = { ...g.cards, [g.objects[e].cardId]: { ...g.cards[g.objects[e].cardId], tags: ['Noxus'] } } as never;
  const canDraw = (h: GameState) => legal(h, P0, 'activate').some(a => a.type === 'activate' && a.obj === l);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'The List') } as never);
  g = drive(g, gg => { const o = gg.pending!.options?.find(x => /^Noxus$/i.test(x.label)); return o ? [o.id] : undefined; }).g;
  const tl = g.players[P0].base.find(id => g.cards[g.objects[id].cardId].name === 'The List')!;
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === tl)!);
  g = drive(g, gg => optionIds(gg).includes(e) ? [e] : undefined).g;
  assert.equal(mightOf(g, e), 3, 'The List chose the enemy unit');
  g = drive(play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[e]] })).g;
  assert.ok(!canDraw(g), 'only one qualifying choice');
});

test('RJ#11008 Insightful Investigator: when I pay 2 XP and choose a card, the opponent discards it and the opponent draws 1', () => {
  let g = S0(); fundAll(g, P0, 12); g.players[P0].xp = 5;
  const c = hand(g, P1, 'V(3)');
  const ph0 = g.players[P1].hand.length; const mh0 = g.players[P0].hand.length;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Insightful Investigator'), destination: 'base' } as never);
  g = drive(g, gg => { const d = gg.pending!; if (d.kind === 'optional') return ['yes']; return optionIds(gg).includes(c) ? [c] : undefined; }).g;
  assert.equal(zone(g, c), 'trash', 'discarded');
  assert.equal(g.players[P1].hand.length, ph0, 'opponent: -1 discarded, +1 drawn');
  assert.equal(g.players[P0].hand.length, mh0, 'I drew nothing');
});

test('RJ#11009 Pyke, Returned dying simultaneously with an enemy unit (mutual combat kill) gives no Gold', () => {
  let { g, atk: [a], def: [p] } = attackSetup(['V(3)'], ['unl-145-219']);
  tokens(g, 'Gold');
  g = drive(g).g;
  assert.equal(zone(g, a), 'trash'); assert.equal(zone(g, p), 'trash');
  assert.ok(!Object.values(g.objects).some(o => g.cards[o.cardId]?.name === 'Gold' && o.zone === 'base'), 'no Gold');
  // control: Pyke survives the enemy's death → Gold
  let r = attackSetup(['V(1)'], ['unl-145-219']); tokens(r.g, 'Gold');
  const h = drive(r.g).g;
  assert.equal(zone(h, r.def[0]), 'battlefield');
  assert.ok(Object.values(h.objects).some(o => h.cards[o.cardId]?.name === 'Gold' && o.zone === 'base'), 'Gold when Pyke survives');
});

test('RJ#11010 Red Brambleback with Skyfall of Areion + Trinity Force conquers: 1 (conquer) + Trinity Force\'s "hold" point as a conquer effect, twice (Brambleback) = 3', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'Red Brambleback', 'base');
  attachNow(g, put(g, P0, 'Trinity Force', 'base'), u);
  attachNow(g, put(g, P0, 'Skyfall of Areion', 'base'), u);
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 30; i++) { const d = g.pending!; if (d.kind === 'mainAction') break; g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : d.options![0].id) : pass(g); }
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, 3);
});

test('RJ#11016 (MISMATCH-RJ) A Reflection that copied a 5-Might unit is Mighty: in my Beginning Phase I may Sacrifice it in response to its Temporary trigger', () => {
  let g = S0(); fundAll(g, P0, 12); tokens(g, 'Reflection');
  const u = put(g, P0, 'V(5)', 'base');
  const before = new Set(Object.keys(g.objects));
  g = drive(play(g, P0, hand(g, P0, 'Mirror Image'), { targets: [[u]] })).g;
  const r = g.players[P0].base.find(id => !before.has(id) && g.objects[id].isToken)!;
  assert.ok(r); assert.equal(mightOf(g, r), 5, 'copy of a 5-Might unit');
  const sac = hand(g, P0, 'Sacrifice');
  g = endTurn(g, P0);
  for (let i = 0; i < 20 && !(g.activePlayer === P0 && chainLabels(g).some(l => /Temporary|Reflection/.test(l)) && pend(g).player === P0 && !pend(g).inStep); i++) { const d = pend(g); if (d.kind === 'mainAction' && g.activePlayer === P1) { g = endTurn(g, P1); continue; } g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g); }
  assert.ok(g.activePlayer === P0 && chainLabels(g).length > 0, 'Temporary trigger in my Beginning Phase');
  assert.ok(canPlayNow(g, P0, sac), 'Sacrifice playable (the Reflection is Mighty)');
  g = act(g, { type: 'playCard', player: P0, obj: sac } as never);
  for (let i = 0; i < 4 && pend(g).inStep; i++) { const ids = optionIds(g); g = act(g, { type: 'choose', player: P0, optionIds: [ids.includes(r) ? r : ids[0]] }); }
  assert.ok(!g.objects[r] || g.objects[r].zone !== 'base', 'Reflection killed for the cost');
});

test('RJ#11019 (MISMATCH-RJ, partial) In my Beginning Phase I hold BF-A, then (in response to a hold trigger) Thrill of the Hunt replays the unit to empty BF-B: no second Hold, but it conquers BF-B (+1)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); setBattlefieldCard(g, BF_A, 'Star Spring');
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  attachNow(g, put(g, P0, 'Trinity Force', 'base'), u);
  const th = hand(g, P0, 'Thrill of the Hunt');
  g = endTurn(g, P1);
  for (let i = 0; i < 20 && !(g.activePlayer === P0 && chainLabels(g).some(l => /V\(2\)/.test(l)) && pend(g).player === P0 && !pend(g).inStep); i++) { const d = pend(g); if (d.kind === 'mainAction') break; g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'no' : d.options![0].id] }) : pass(g); }
  const p0 = g.players[P0].points;
  assert.ok(chainLabels(g).length > 0, `hold trigger window (${chainLabels(g)})`);
  g = act(g, { type: 'playCard', player: P0, obj: th } as never);
  g = drive(g, gg => { const ids = optionIds(gg); return ids.includes(u) ? [u] : ids.includes(String(BF_B)) ? [String(BF_B)] : gg.pending!.kind === 'optional' ? ['no'] : undefined; }, 60).g;
  assert.equal(locOf(g, u), BF_B);
  assert.equal((logText(g).match(/P0 holds/g) ?? []).length, 1, 'no second Hold');
  assert.ok(/P0 conquers BF-B/.test(logText(g)), 'BF-B conquered (not yet scored this turn)');
  assert.equal(g.players[P0].points, p0 + 2, 'Trinity Force\'s hold point + the BF-B conquer point');
});

test('RJ#11020 Existential Dread can\'t choose a defender (attacking enemy units only); an already-stunned attacker is returned to hand instead', () => {
  let { g, atk: [a] } = attackSetup(['V(3)'], ['V(2)']);
  fundAll(g, P1, 12);
  const ed = hand(g, P1, 'Existential Dread');
  g.objects[a].stunned = true; g.timestamp++;
  for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P1); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: ed } as never);
  g = drive(g, gg => { const ids = optionIds(gg); return ids.includes(a) ? [a] : undefined; }).g;
  assert.equal(zone(g, a), 'hand', 'stunned attacker returned');
  // the attacker can't aim it at the defenders
  let r = attackSetup(['V(3)'], ['V(2)']); let h = r.g; fundAll(h, P0, 12);
  const ed2 = hand(h, P0, 'Existential Dread');
  for (let i = 0; i < 6 && !(pend(h).kind === 'showdownAction' && pend(h).player === P0); i++) h = pend(h).inStep ? act(h, legal(h, pend(h).player)[0]) : pass(h);
  assert.equal(canPlayNow(h, P0, ed2), false, 'no attacking enemy unit to choose');
});

test('RJ#11022 Last Rites\' Equip needs [C] (a Chaos rune) plus recycling 2 trash cards: with only Fury runes it can\'t be equipped', () => {
  const g = S0(); setRunes(g, P0, 6, 'fury');
  const lr = put(g, P0, 'Last Rites', 'base');
  put(g, P0, 'V(1)', 'base'); put(g, P0, 'V(1)', 'trash'); put(g, P0, 'V(1)', 'trash');
  const can = () => legal(g, P0, 'activate').some(x => x.type === 'activate' && x.obj === lr);
  assert.ok(!can(), 'no Chaos power');
  addRunes(g, P0, 1, 'chaos');
  assert.ok(can(), 'Chaos rune + 2 trash cards');
});

test('RJ#11025 Attacking into an occupied battlefield: the attack trigger is already on the chain at the defender\'s first priority (no window before it), so a Reaction like Gust can only respond to it', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12);
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const le = put(g, P1, 'Leona, Determined', 'base');
  g = move(g, P1, [le], BF_A);
  for (let i = 0; i < 8 && !(pend(g).player === P0 && !pend(g).inStep); i++) { const d = pend(g); g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g); }
  assert.ok(chainLabels(g).some(l => /Leona/.test(l)), `attack trigger already chained at P0's first priority: ${chainLabels(g)}`);
  assert.equal(pend(g).kind, 'chainResponse');
});

test('RJ#11029 En Garde on Irelia, Fervent (3 Might) with Blade Dancer: her +1 and the ready trigger go on the chain; the opponent may Gust her in response — she returns to hand and the rest does nothing', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  setLegend(g, P0, 'Blade Dancer');
  const ir = put(g, P0, 'Irelia, Fervent', BF_A); control(g, BF_A, P0); g.objects[ir].exhausted = true;
  mod(g, ir, { might: -1 });
  assert.equal(mightOf(g, ir), 3);
  g = play(g, P0, hand(g, P0, 'En Garde'), { targets: [[ir]] });
  for (let i = 0; i < 8 && !(pend(g).player === P1 && !pend(g).inStep); i++) { const d = pend(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g)[0]] }) : pass(g); }
  assert.ok(chainLabels(g).length >= 2, `En Garde + triggers on the chain: ${chainLabels(g)}`);
  assert.equal(mightOf(g, ir), 3, 'nothing resolved yet');
  g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[ir]] });
  g = drive(g).g;
  assert.equal(zone(g, ir), 'hand');
});

test('RJ#11030 Fizz plays a spell from the trash (my 2nd card); Darius, Trifarian played next is the 3rd card: no +2, not readied', () => {
  const g0 = S0(); fundAll(g0, P0, 12);
  const enemy = put(g0, P1, 'V(5)', BF_A); control(g0, BF_A, P1);
  const ray = put(g0, P0, 'Hextech Ray', 'trash');
  let g = passAll(play(g0, P0, hand(g0, P0, 'Fizz, Trickster')));
  g = answer(g, { targets: [[ray]] }, P0);
  g = pass(pass(g));
  g = answer(g, { targets: [[enemy]] }, P0);
  g = drive(g).g;
  assert.ok(g.objects[enemy].damage > 0, 'the trash spell was played');
  const dz = hand(g, P0, 'Darius, Trifarian');
  g = drive(act(g, { type: 'playCard', player: P0, obj: dz, destination: 'base' } as never)).g;
  assert.equal(mightOf(g, dz), 5);
  assert.equal(g.objects[dz].exhausted, true);
});

test('RJ#11032 Anivia attacks two enemy units; the opponent Star-Crosseds one of them and Anivia in response: her "deal 3 to all enemy units here" has no "here" — the remaining unit takes nothing', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const d1 = put(g, P1, 'V(4)', BF_A), d2 = put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  const an = put(g, P0, 'Anivia', 'base');
  g = move(g, P0, [an], BF_A);
  for (let i = 0; i < 8 && !(chainLabels(g).some(l => /Anivia/.test(l)) && pend(g).player === P1 && !pend(g).inStep); i++) { const d = pend(g); g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g); }
  assert.ok(chainLabels(g).some(l => /Anivia/.test(l)), 'attack trigger on the chain');
  g = play(g, P1, hand(g, P1, 'Star-Crossed'), { targets: [[d1], [an]] });
  g = drive(g, gg => { const ids = optionIds(gg); return ids.includes(d1) ? [d1] : ids.includes(an) ? [an] : undefined; }).g;
  assert.equal(zone(g, an), 'hand'); assert.equal(zone(g, d1), 'hand');
  assert.equal(g.objects[d2].damage, 0);
});

test('RJ#11034 Copying a unit with gear attached copies only the unit: the Reflection has the unit\'s printed Might and no attached gear', () => {
  let g = S0(); fundAll(g, P0, 12); tokens(g, 'Reflection');
  const u = put(g, P0, 'V(3)', 'base');
  const ls = put(g, P0, 'Long Sword', 'base'); attachNow(g, ls, u);
  assert.ok(mightOf(g, u)! > 3, 'the gear boosts the original');
  const before = new Set(Object.keys(g.objects));
  g = drive(play(g, P0, hand(g, P0, 'Mirror Image'), { targets: [[u]] })).g;
  const r = g.players[P0].base.find(id => !before.has(id) && g.objects[id].isToken)!;
  assert.ok(r, 'Reflection played');
  assert.equal(mightOf(g, r), 3);
  assert.ok(!Object.values(g.objects).some(o => o.attachedTo === r), 'no gear on the copy');
  assert.equal(g.objects[ls].attachedTo, u);
});

test('RJ#11036 Thrill of the Hunt replays my unit onto Abandoned Hall: the Hall\'s spell trigger comes after it resolves, so the replayed unit can get +1', () => {
  let g = S0(); fundAll(g, P0); setBattlefieldCard(g, BF_A, 'Abandoned Hall');
  const other = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const u = put(g, P0, 'V(3)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Thrill of the Hunt') } as never);
  g = drive(g, gg => { const x = gg.pending!; const ids = optionIds(gg); if (x.kind === 'optional') return ['yes']; if (ids.includes(u)) return [u]; if (ids.includes(String(BF_A))) return [String(BF_A)]; const n = ids.find(id => id !== other && gg.objects[id]); return n ? [n] : undefined; }).g;
  const u2 = Object.values(g.objects).find(o => o.zone === 'battlefield' && o.controller === P0 && g.cards[o.cardId]?.name === 'V(3)')!;
  assert.ok(u2 && locOf(g, u2.id) === BF_A, 'replayed to the Hall');
  assert.equal(mightOf(g, u2.id), 4, 'Hall +1 on the replayed unit');
});

test('RJ#11041 (MISMATCH-RJ, partial) Forbidding Waste: a 4-Might enemy with 2 damage there is not "defending alone" yet, so it survives; when my unit moves in it becomes the lone defender (2 Might) and dies in that cleanup, before anyone can respond', () => {
  let g = S0(); setBattlefieldCard(g, BF_A, 'Forbidding Waste');
  const e = put(g, P1, 'V(4)', BF_A, { damage: 2 }); control(g, BF_A, P1);
  const a = put(g, P0, 'V(3)', 'base');
  g = drive(g).g;
  assert.equal(zone(g, e), 'battlefield', 'not defending: no -2, the 2 damage is not lethal');
  assert.equal(mightOf(g, e), 4);
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 10 && pend(g).kind !== 'mainAction'; i++) { if (pend(g).player === P1) assert.equal(zone(g, e), 'trash', 'already dead at P1\'s first decision'); g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g); }
  assert.equal(zone(g, e), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P0, 'no defender left: conquered');
});

test('RJ#11042 Opponent\'s Star-Crossed on their unit and my Elder Dragon; my Flurry of Blades in response kills their unit (Elder Dragon\'s passive): Star-Crossed still returns Elder Dragon', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const ed = put(g, P0, 'Elder Dragon', BF_A); control(g, BF_A, P0);
  const f = put(g, P1, 'V(3)', BF_B); control(g, BF_B, P1);
  g = play(g, P1, hand(g, P1, 'Star-Crossed'), { targets: [[f], [ed]] });
  if (pend(g).player === P1 && !pend(g).inStep) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Flurry of Blades'));
  g = drive(g).g;
  assert.equal(zone(g, f), 'trash', '1 damage from my Flurry is lethal (Elder Dragon)');
  assert.equal(zone(g, ed), 'hand', 'Elder Dragon returned');
});

test('RJ#11043 Turn to Dust on an attached Long Sword: the granted Temporary works while attached — at my next Beginning Phase the gear dies and the unit loses its bonus', () => {
  let g = S0(); fundAll(g, P0, 12);
  const u = put(g, P0, 'V(2)', 'base');
  const ls = put(g, P0, 'Long Sword', 'base'); attachNow(g, ls, u);
  const m1 = mightOf(g, u)!;
  assert.ok(m1 > 2);
  g = drive(play(g, P0, hand(g, P0, 'Turn to Dust'), { targets: [[ls]] })).g;
  assert.equal(zone(g, ls), 'base');
  g = nextTurn(g); g = nextTurn(g);
  assert.equal(g.activePlayer, P0);
  assert.equal(zone(g, ls), 'trash');
  assert.equal(mightOf(g, u), 2);
});

test('RJ#11047 Temporary unit with Guardian Angel: at my Beginning Phase GA dies instead and the unit is recalled; it keeps Temporary and dies at the following Beginning Phase', () => {
  let g = S0(); fundAll(g, P0, 12);
  const u = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const ga = put(g, P0, 'Guardian Angel', 'base'); attachNow(g, ga, u);
  g = drive(play(g, P0, hand(g, P0, 'Fading Memories'), { targets: [[u]] })).g;
  assert.ok(hasKeyword(g, u, 'Temporary'));
  g = nextTurn(g); g = nextTurn(g);
  assert.equal(g.activePlayer, P0);
  assert.equal(zone(g, ga), 'trash', 'Guardian Angel killed instead');
  assert.equal(locOf(g, u), 'base', 'recalled');
  assert.ok(hasKeyword(g, u, 'Temporary'), 'keeps Temporary');
  g = nextTurn(g); g = nextTurn(g);
  assert.equal(zone(g, u), 'trash', 'dies at the next Beginning Phase');
});

test('RJ#11050 Defiant Dance: one of its two units is returned in response — the spell still resolves for the other (-2 still applied)', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const mine = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(4)', BF_B); control(g, BF_B, P1);
  g = play(g, P0, hand(g, P0, 'Defiant Dance'), { targets: [[mine], [e]] });
  if (pend(g).player === P0 && !pend(g).inStep) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[mine]] });
  g = drive(g).g;
  assert.equal(zone(g, mine), 'hand');
  assert.equal(mightOf(g, e), 2, 'the enemy part still resolves');
});

test('RJ#11051 Tapping Honeyfruit ([Add]) while I have focus in a showdown doesn\'t pass focus: I keep acting', () => {
  let g = S0(); fundAll(g, P0, 12);
  const hf = put(g, P0, 'Honeyfruit', 'base'); g.objects[hf].exhausted = false;
  const a = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(pend(g).kind, 'showdownAction'); assert.equal(pend(g).player, P0);
  const ab = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === hf);
  assert.ok(ab, 'Honeyfruit usable in the showdown');
  g = act(g, ab!);
  for (let i = 0; i < 4 && pend(g).inStep && pend(g).player === P0; i++) g = act(g, legal(g, P0)[0]);
  assert.equal(g.objects[hf].exhausted, true);
  assert.equal(g.chain.length, 0, 'the Add resolved at once');
  assert.equal(pend(g).player, P0, 'still my focus');
  assert.equal(pend(g).kind, 'showdownAction');
});

test('RJ#11052 My 1-Might unit moves into an empty battlefield; the opponent plays Rengar, Trophy Hunter there; I stun him (Back Off): combat — nobody dies, I\'m recalled, the opponent (defender) conquers', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const r = hand(g, P1, 'Rengar, Trophy Hunter');
  const bo = hand(g, P0, 'Back Off');
  const a = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 8 && !(pend(g).player === P1 && !pend(g).inStep && canPlayNow(g, P1, r, BF_A)); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = play(g, P1, r, { dest: BF_A });
  for (let i = 0; i < 8 && !(locOf(g, r) === BF_A && pend(g).player === P0 && !pend(g).inStep && canPlayNow(g, P0, bo)); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(locOf(g, r), BF_A);
  assert.ok(g.showdown && g.objects[a]?.zone === 'battlefield', 'I get to act again after Rengar is played, before combat damage');
  g = play(g, P0, bo, { targets: [[r]] });
  g = drive(g, gg => optionIds(gg).includes(r) ? [r] : undefined).g;
  assert.ok(g.objects[r].stunned, 'Rengar stunned');
  assert.equal(locOf(g, r), BF_A);
  assert.equal(locOf(g, a), 'base', 'surviving attacker recalled');
  assert.equal(g.battlefields[BF_A].controller, P1);
  assert.ok(/P1 conquers BF-A/.test(logText(g)), 'defender conquers');
});

test('RJ#11053 Safety Inspector played to my battlefield where I have one unit: its trigger may kill that unit (the Inspector stays, so I keep the battlefield)', () => {
  let g = S0(); fundAll(g, P0, 12);
  const mine = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(2)', 'base');
  const si = hand(g, P0, 'Safety Inspector');
  g = act(g, { type: 'playCard', player: P0, obj: si, destination: BF_A } as never);
  g = drive(g, gg => { const d = gg.pending!; if (d.kind === 'optional') return ['no']; const ids = optionIds(gg); return ids.includes(mine) ? [mine] : undefined; }).g;
  assert.equal(zone(g, mine), 'trash', 'I killed my other unit');
  assert.equal(locOf(g, si), BF_A);
  assert.equal(zone(g, e), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#11054 My Reflection (copy of Glasc Mixologist) alone at my battlefield dies to Temporary in my Beginning Phase; its Deathknell plays a unit there: I keep control and score the Hold', () => {
  let g = S0(); fundAll(g, P0, 12); tokens(g, 'Reflection');
  const mx = put(g, P0, 'Glasc Mixologist', 'base');
  const v = put(g, P0, 'V(2)', 'trash');
  const before = new Set(Object.keys(g.objects));
  g = drive(play(g, P0, hand(g, P0, 'Mirror Image'), { targets: [[mx]] })).g;
  const r = g.players[P0].base.find(id => !before.has(id) && g.objects[id].isToken)!;
  assert.ok(r);
  g = drive(move(g, P0, [r], BF_A)).g;
  assert.equal(g.battlefields[BF_A].controller, P0);
  const p0 = g.players[P0].points;
  g = endTurn(g, P0);
  for (let i = 0; i < 40; i++) { const d = pend(g); if (d.kind === 'mainAction' && g.activePlayer === P1) { g = endTurn(g, P1); continue; } if (d.kind === 'mainAction') break;
    if (d.inStep) { const ids = optionIds(g); g = act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : ids.includes(v) ? v : ids.includes(String(BF_A)) ? String(BF_A) : ids[0]] }); } else g = pass(g); }
  assert.equal(g.activePlayer, P0);
  assert.ok(!g.objects[r] || g.objects[r].zone !== 'battlefield', 'Reflection died (Temporary)');
  assert.equal(locOf(g, v), BF_A, 'Deathknell played the unit there');
  assert.ok(/P0 holds/.test(logText(g)), 'Hold scored');
  assert.equal(g.players[P0].points, p0 + 1);
});

test('RJ#11056 (MISMATCH-RJ, partial) A Deathknell from a death during a spell\'s resolution waits for the spell to finish: Hidden Blade\'s "its controller draws 2" happens before Glasc Mixologist\'s Deathknell resolves', () => {
  let g = S0(); fundAll(g, P0, 12);
  const mx = put(g, P0, 'Glasc Mixologist', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(2)', 'trash');
  g = play(g, P0, hand(g, P0, 'Hidden Blade'), { targets: [[mx]] });
  g = drive(g, gg => gg.pending!.kind === 'optional' ? ['no'] : undefined).g;
  const t = logText(g);
  const iDraw = t.indexOf('P0 draws 2'), iDk = t.search(/Resolving Glasc Mixologist/);
  assert.ok(iDraw >= 0 && iDk >= 0, t);
  assert.ok(iDraw < iDk, 'the spell finished (draw 2) before the Deathknell resolved');
});

test('RJ#11057 Star Spring\'s "may move another unit" is a triggered ability on the chain: the opponent can respond to it before it resolves', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12); setBattlefieldCard(g, BF_A, 'Star Spring');
  const o = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const u = hand(g, P0, 'V(3)');
  g = act(g, { type: 'playCard', player: P0, obj: u, destination: BF_A } as never);
  for (let i = 0; i < 8 && !(pend(g).player === P1 && !pend(g).inStep); i++) { const d = pend(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g).includes(o) ? o : optionIds(g)[0]] }) : pass(g); }
  assert.ok(chainLabels(g).some(l => /Star Spring/.test(l)), `Star Spring trigger on the chain: ${chainLabels(g)}`);
  assert.equal(pend(g).kind, 'chainResponse');
  g = drive(g, gg => optionIds(gg).includes(o) ? [o] : undefined).g;
  assert.equal(locOf(g, o), 'base');
});

test('RJ#11059 Tideturner\'s swap target is returned by the opponent\'s Star-Crossed in response: the swap does nothing — Tideturner stays where it was played', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const f = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const theirs = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  const tt = hand(g, P0, 'Tideturner');
  g = act(g, { type: 'playCard', player: P0, obj: tt, destination: 'base' } as never);
  for (let i = 0; i < 8 && !(pend(g).player === P1 && !pend(g).inStep); i++) { const d = pend(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g).includes(f) ? f : optionIds(g)[0]] }) : pass(g); }
  assert.ok(chainLabels(g).some(l => /Tideturner/.test(l)), `Tideturner trigger on the chain: ${chainLabels(g)}`);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Star-Crossed') } as never);
  g = drive(g, gg => { const ids = optionIds(gg); return ids.includes(theirs) ? [theirs] : ids.includes(f) ? [f] : undefined; }).g;
  assert.equal(zone(g, f), 'hand'); assert.equal(zone(g, theirs), 'hand');
  assert.equal(locOf(g, tt), 'base', 'Tideturner did not move');
});

test('RJ#11060 Disposal Order in response to Fizz\'s trigger recycles the chosen trash spell: Fizz plays nothing', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const enemy = put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  const ray = put(g, P0, 'Hextech Ray', 'trash');
  g = passAll(play(g, P0, hand(g, P0, 'Fizz, Trickster')));
  g = answer(g, { targets: [[ray]] }, P0);
  for (let i = 0; i < 4 && !(pend(g).player === P1 && !pend(g).inStep); i++) g = pass(g);
  assert.ok(chainLabels(g).some(l => /Fizz/.test(l)), 'Fizz trigger on the chain');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Disposal Order') } as never);
  g = drive(g, gg => { const d = gg.pending!; const o = d.options ?? []; const m = o.find(x => /trash|recycle/i.test(x.label)); if (m && d.kind !== 'chooseCards' && !o.some(x => x.id === ray)) return [m.id]; return o.some(x => x.id === ray) ? [ray] : undefined; }).g;
  assert.equal(zone(g, ray), 'mainDeck', 'recycled');
  assert.equal(g.objects[enemy].damage, 0, 'Hextech Ray was never played');
});

test('RJ#11063 Piercing Light on a battlefield unit, then a base unit; the opponent Thrill of the Hunts the first (a new object): it takes nothing, the base unit still takes 2', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const eb = put(g, P1, 'V(5)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Piercing Light') } as never);
  for (let i = 0; i < 12 && pend(g).inStep; i++) {
    const d = pend(g);
    if (d.kind === 'optional') { g = no(g); continue; }
    if (d.kind === 'chooseTargets') { g = choose(g, /other/.test(d.prompt ?? '') ? eb : e); continue; }
    g = choose(g, optionIds(g)[0]);
  }
  if (pend(g).player === P0) g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Thrill of the Hunt') } as never);
  g = drive(g, gg => { const ids = optionIds(gg); return ids.includes(e) ? [e] : ids.includes(String(BF_A)) ? [String(BF_A)] : undefined; }).g;
  const units = Object.values(g.objects).filter(o => o.zone === 'battlefield' && o.controller === P1 && g.cards[o.cardId]?.name === 'V(5)');
  assert.equal(units.length, 1, 'the replayed unit is at a battlefield');
  assert.equal(units[0].damage ?? 0, 0, 'the replayed unit takes nothing');
  assert.equal(g.objects[eb].damage, 2, 'the second instruction still deals 2');
});

test('RJ#11069 Not So Fast counters the opponent\'s Star-Crossed (it chooses my unit): both units stay', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const mine = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const theirs = put(g, P1, 'V(3)', BF_B); control(g, BF_B, P1);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Star-Crossed') } as never);
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const ids = optionIds(g); g = act(g, { type: 'choose', player: pend(g).player, optionIds: [ids.includes(theirs) ? theirs : ids.includes(mine) ? mine : ids[0]] }); }
  if (pend(g).player === P1) g = pass(g);
  const sc = g.chain.at(-1)!.id;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Not So Fast') } as never);
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const ids = optionIds(g); g = act(g, { type: 'choose', player: pend(g).player, optionIds: [ids.includes(String(sc)) ? String(sc) : ids[0]] }); }
  g = drive(g).g;
  assert.equal(locOf(g, mine), BF_A); assert.equal(locOf(g, theirs), BF_B);
  assert.ok(/counter/i.test(logText(g)), 'Star-Crossed countered');
});

test('RJ#11070 Sacrifice kills my lone Rift Herald at a battlefield: its Deathknell plays the unit to my base only — the battlefield (still mine while Sacrifice is on the chain) is not offered', () => {
  let g = S0(); fundAll(g, P0, 12);
  const rh = put(g, P0, 'Rift Herald', BF_A); control(g, BF_A, P0);
  const v = hand(g, P0, 'V(3)');
  let offered: string[] = [];
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Sacrifice') } as never);
  g = drive(g, gg => { const d = gg.pending!; const ids = optionIds(gg); if (d.kind === 'chooseDestination' || d.kind === 'chooseBattlefield') { offered = ids; return undefined; } if (ids.includes(rh)) return [rh]; if (ids.includes(v)) return [v]; return undefined; }).g;
  assert.equal(zone(g, rh), 'trash');
  assert.equal(locOf(g, v), 'base');
  assert.ok(!offered.includes(String(BF_A)), `battlefield not offered (${offered})`);
});

test('RJ#11075 Hall of Legends: "you may pay [1] to ready your legend" is decided and paid as the conquer trigger goes on the chain (principle 11), not after other conquer triggers resolve', () => {
  let g = S0(); fundAll(g, P0, 12); setBattlefieldCard(g, BF_A, 'Hall of Legends');
  const leg = g.players[P0].legend; g.objects[leg].exhausted = true;
  const u = put(g, P0, 'V(2)', 'base');
  attachNow(g, put(g, P0, 'Trinity Force', 'base'), u);
  g = move(g, P0, [u], BF_A);
  let asked = false;
  for (let i = 0; i < 20; i++) {
    const d = pend(g); if (d.kind === 'mainAction') break;
    if (d.kind === 'optional' && /ready your legend|Hall of Legends|pay/i.test(d.prompt)) {
      asked = true;
      assert.ok(g.chain.length === 0 || g.chain[g.chain.length - 1].pending, 'decided while the Hall trigger is pending (finalization)');
      assert.ok(!/Resolving/.test(logText(g).split('conquers')[1] ?? ''), 'no conquer trigger has resolved yet');
      g = choose(g, 'yes'); continue;
    }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.ok(asked, 'Hall of Legends offered');
  assert.equal(g.objects[leg].exhausted, false, 'legend readied');
});

test('RJ#11076 Thousand-Tailed Watcher: a unit I play in response to its play trigger is on the board when it resolves and gets -3 (min 1) (units played after it resolved: RJ#10588)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const rg = hand(g, P0, 'sfd-025-221');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Thousand-Tailed Watcher'), destination: 'base' } as never);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, { type: 'choose', player: pend(g).player, optionIds: [pend(g).kind === 'optional' ? 'no' : pend(g).options![0].id] });
  if (pend(g).player === P1) g = pass(g);
  assert.ok(g.chain.length > 0, 'trigger on the chain');
  g = act(g, { type: 'playCard', player: P0, obj: rg, destination: 'base' } as never);
  g = drive(g).g;
  assert.equal(locOf(g, rg), 'base');
  assert.equal(mightOf(g, rg), 1, '3 - 3 to a minimum of 1');
});

test('RJ#11080 Darius, Trifarian: my second card (Gust) is countered by Defy — a countered card was not played, so Darius doesn\'t ready', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const dz = put(g, P0, 'Darius, Trifarian', 'base'); g.objects[dz].exhausted = true;
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'V(1)'), destination: 'base' } as never)).g;
  assert.equal(g.objects[dz].exhausted, true, 'first card: nothing');
  const gust = hand(g, P0, 'Gust');
  g = play(g, P0, gust, { targets: [[e]] });
  if (pend(g).player === P0 && !pend(g).inStep) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Defy'), { targets: [[gust]] });
  g = drive(g, gg => optionIds(gg).includes(gust) ? [gust] : undefined).g;
  assert.equal(locOf(g, e), BF_A, 'Gust countered');
  assert.equal(g.objects[dz].exhausted, true, 'Darius not readied');
  assert.equal(mightOf(g, dz), 5);
});

test('RJ#11081 Loyal Pup: the opponent moving to an empty battlefield (even one I control) is a non-combat showdown — I don\'t defend, so no Pup trigger', () => {
  let g = S0({ tp: P1 }); control(g, BF_A, P0);
  const pup = put(g, P0, 'Loyal Pup', 'base');
  const a = put(g, P1, 'V(2)', 'base');
  const { g: h, seen } = drive(move(g, P1, [a], BF_A));
  assert.ok(!seen.some(s => /Loyal Pup|move me/i.test(s)), `no Pup prompt: ${seen}`);
  assert.ok(!/Trigger: Loyal Pup/.test(logText(h)));
  assert.equal(locOf(h, pup), 'base');
  assert.equal(h.battlefields[BF_A].controller, P1);
});

test('RJ#11083 Bloodharbor Ripper (Pyke legend) on my unit, then my own Star-Crossed on the same unit in response: Star-Crossed returns it, Ripper\'s return does nothing but the Gold token is still played', () => {
  let g = S0(); fundAll(g, P0, 12); tokens(g, 'Gold');
  const l = setLegend(g, P0, 'Bloodharbor Ripper');
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === l)!;
  g = act(g, ab);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, { type: 'choose', player: P0, optionIds: [optionIds(g).includes(u) ? u : optionIds(g)[0]] });
  assert.equal(pend(g).player, P0, 'I hold priority after activating');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Star-Crossed') } as never);
  g = drive(g, gg => { const ids = optionIds(gg); return ids.includes(u) ? [u] : ids.includes(e) ? [e] : undefined; }).g;
  assert.equal(zone(g, u), 'hand'); assert.equal(zone(g, e), 'hand');
  const gold = Object.values(g.objects).filter(o => g.cards[o.cardId]?.name === 'Gold' && o.zone === 'base' && o.controller === P0);
  assert.equal(gold.length, 1, 'Gold token played');
  assert.equal(gold[0].exhausted, true);
});

test('RJ#11084 Heedless Resurrection killing Kog\'Maw for its cost: his Deathknell (deal 4 at his battlefield) resolves first; the unit played to that battlefield afterwards takes nothing', () => {
  let g = S0(); fundAll(g, P0, 12);
  const kg = put(g, P0, "Kog'Maw", BF_A); control(g, BF_A, P0);
  const other = put(g, P0, 'V(5)', BF_A);
  const v = put(g, P0, 'V(2)', 'trash');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Heedless Resurrection') } as never);
  g = drive(g, gg => { const ids = optionIds(gg); if (gg.pending!.kind === 'chooseDestination' && ids.includes(String(BF_A))) return [String(BF_A)]; return ids.includes(kg) ? [kg] : ids.includes(v) ? [v] : undefined; }, 60).g;
  assert.equal(zone(g, kg), 'trash');
  assert.equal(g.objects[other].damage, 4, 'the Deathknell hit the unit already there');
  assert.equal(locOf(g, v), BF_A);
  assert.equal(g.objects[v].damage ?? 0, 0, 'the resurrected unit arrived after the Deathknell');
});

test('RJ#11086 Two copies of the same Equipment (Long Sword) can both be equipped to one unit, paying Equip for each; an attached copy offers no Equip', () => {
  let g = S0(); fundAll(g, P0, 12);
  const u = put(g, P0, 'V(2)', 'base');
  const s1 = put(g, P0, 'Long Sword', 'base'), s2 = put(g, P0, 'Long Sword', 'base');
  const equip = (s: ObjId) => { const a = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === s); assert.ok(a, 'Equip offered'); g = drive(act(g, a!), gg => optionIds(gg).includes(u) ? [u] : undefined).g; };
  equip(s1);
  assert.equal(g.objects[s1].attachedTo, u);
  assert.ok(!legal(g, P0, 'activate').some(x => x.type === 'activate' && x.obj === s1), 'attached: no Equip');
  equip(s2);
  assert.equal(g.objects[s2].attachedTo, u);
  assert.equal(g.objects[s1].attachedTo, u);
});

test('RJ#11091 Deceiver (LeBlanc legend): the Reflection is played at the battlefield I conquered ("there") and copies a unit there — not at another battlefield', () => {
  let g = S0(); fundAll(g, P0, 12); setLegend(g, P0, 'Deceiver'); tokens(g, 'Reflection');
  put(g, P0, 'V(5)', BF_B); control(g, BF_B, P0);
  const x = put(g, P0, 'V(3)', 'base'); hand(g, P0, 'V(1)');
  const before = new Set(Object.keys(g.objects));
  g = drive(move(g, P0, [x], BF_A), gg => { const ids = optionIds(gg); return ids.includes(x) ? [x] : undefined; }).g;
  const r = Object.values(g.objects).find(o => !before.has(o.id) && o.isToken && (o.zone === 'battlefield' || o.zone === 'base'));
  assert.ok(r, 'Reflection played');
  assert.equal(locOf(g, r!.id), BF_A, 'at the conquered battlefield');
  assert.equal(mightOf(g, r!.id), 3, 'copy of the unit there');
});

test('RJ#11094 Irresistible Faefolk Gusted in response to its move trigger: the trigger still moves the enemy unit to "that battlefield"', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const ff = put(g, P0, 'Irresistible Faefolk', 'base');
  const e = put(g, P1, 'V(2)', 'base');
  g = move(g, P0, [ff], BF_A);
  for (let i = 0; i < 6 && !(pend(g).player === P1 && !pend(g).inStep && chainLabels(g).some(l => /Faefolk/.test(l))); i++) { const d = pend(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g).includes(e) ? e : d.options![0].id] }) : pass(g); }
  assert.ok(chainLabels(g).some(l => /Faefolk/.test(l)), 'trigger on the chain');
  g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[ff]] });
  g = drive(g, gg => { const ids = optionIds(gg); return ids.includes(e) ? [e] : gg.pending!.kind === 'optional' ? ['yes'] : undefined; }).g;
  assert.equal(zone(g, ff), 'hand');
  assert.equal(locOf(g, e), BF_A, 'the enemy unit was still moved there');
});

test('RJ#11095 (MISMATCH-RJ, partial) Emperor\'s Divide vs the opponent\'s Unchecked Power: as an [Action] it can\'t respond from hand — but played from hidden (Reaction timing) it moves my units at that battlefield to base before the 12 damage', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const u = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const fromHand = hand(g, P0, "Emperor's Divide");
  const hid = put(g, P0, "Emperor's Divide", { facedown: BF_A });
  g = play(g, P1, hand(g, P1, 'Unchecked Power'));
  if (pend(g).player === P1 && !pend(g).inStep) g = pass(g);
  assert.equal(pend(g).player, P0);
  assert.equal(canPlayNow(g, P0, fromHand), false, 'Action from hand: not in a closed state');
  assert.ok(canPlayNow(g, P0, hid), 'from hidden: Reaction timing');
  g = act(g, { type: 'playCard', player: P0, obj: hid } as never);
  g = drive(g, gg => optionIds(gg).includes(u) ? [u] : gg.pending!.kind === 'optional' ? ['yes'] : undefined).g;
  assert.equal(locOf(g, u), 'base', 'moved to base');
  assert.equal(zone(g, u), 'base', 'survived');
});

test('RJ#11097 Svellsongur on Ultrasoft Poro: exhausting it makes 2 Birds, not 4 — the copied [T] ability can\'t also be paid once the Poro is exhausted', () => {
  let g = S0(); fundAll(g, P0, 12); tokens(g, 'Bird');
  const po = put(g, P0, 'Ultrasoft Poro', BF_A); control(g, BF_A, P0);
  attachNow(g, put(g, P0, 'Svellsongur', 'base'), po);
  const birds = (h: GameState) => Object.values(h.objects).filter(o => o.isToken && h.cards[o.cardId]?.name === 'Bird' && (o.zone === 'battlefield' || o.zone === 'base')).length;
  const abs = (h: GameState) => legal(h, P0, 'activate').filter(a => a.type === 'activate' && (a.obj === po || h.objects[a.obj]?.attachedTo === po));
  assert.ok(abs(g).length >= 1);
  g = drive(act(g, abs(g)[0])).g;
  assert.equal(birds(g), 2);
  assert.equal(g.objects[po].exhausted, true);
  assert.equal(abs(g).length, 0, 'no second use while exhausted');
});

test('RJ#11099 (MISMATCH-RJ, partial) On the opponent\'s turn: Reactions only in response (closed state); in a showdown with an empty chain only the focus holder may play (Action or Reaction) — a Reaction is not playable "regardless" without focus', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const r = hand(g, P0, 'DrawR');
  const a = put(g, P1, 'V(2)', 'base');
  assert.equal(canPlayNow(g, P0, r), false, 'opponent\'s open main phase: no');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 4 && !(pend(g).kind === 'showdownAction' && pend(g).player === P1); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(pend(g).kind, 'showdownAction'); assert.equal(pend(g).player, P1, 'the contesting player has focus');
  assert.equal(canPlayNow(g, P0, r), false, 'no focus: no Reaction either');
  g = pass(g);
  assert.equal(pend(g).player, P0);
  assert.ok(canPlayNow(g, P0, r), 'with focus: yes');
});

test('RJ#11100 Shakedown ("Choose an enemy unit") can\'t be played when the opponent has no units; Cull the Weak (no choice when played) can', () => {
  const g = S0(); fundAll(g, P0, 12);
  put(g, P0, 'V(2)', 'base');
  const sk = hand(g, P0, 'Shakedown'), cw = hand(g, P0, 'Cull the Weak');
  assert.equal(canPlayNow(g, P0, sk), false);
  assert.ok(canPlayNow(g, P0, cw));
  put(g, P1, 'V(2)', 'base');
  assert.ok(canPlayNow(g, P0, sk), 'with an enemy unit');
});

test('RJ#11101 "In combat" is not "during a showdown": Cannon Barrage ("all enemy units in combat") in a non-combat showdown hits nothing; in a combat it hits the attacker', () => {
  for (const combat of [false, true]) {
    let g = S0(); fundAll(g, P1, 12);
    if (combat) { put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1); }
    const a = put(g, P0, 'V(4)', 'base');
    g = move(g, P0, [a], BF_A);
    for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P1); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
    assert.equal(!!g.showdown?.isCombat, combat);
    g = play(g, P1, hand(g, P1, 'Cannon Barrage'));
    for (let i = 0; i < 4 && g.chain.length; i++) g = pass(g);
    assert.equal(g.objects[a].damage ?? 0, combat ? 2 : 0, combat ? 'in combat' : 'showdown, not combat');
  }
});

test('RJ#11102 Heedless Resurrection: a unit in my hand can\'t be killed for its cost (board units only) — with no unit on the board it can\'t be played', () => {
  let g = S0(); fundAll(g, P0, 12);
  hand(g, P0, 'V(2)'); put(g, P0, 'V(1)', 'trash');
  const hr = hand(g, P0, 'Heedless Resurrection');
  assert.equal(canPlayNow(g, P0, hr), false, 'no friendly unit on the board');
  put(g, P0, 'V(2)', 'base');
  assert.ok(canPlayNow(g, P0, hr), 'with a unit on the board');
});

test('RJ#11104 Allay grants Deflect to Vex, Apathetic (printed Deflect) at its battlefield: the values add — Deflect 2, so choosing Vex costs 2 extra power', () => {
  let g = S0(); setRunes(g, P0, 2, 'fury');
  put(g, P1, 'Allay', BF_A); control(g, BF_A, P1);
  const vx = put(g, P1, 'unl-150-219', BF_A);
  assert.equal(kwValue(g, vx, 'Deflect'), 2);
  const ray = hand(g, P0, 'Hextech Ray');
  const tryPlay = (h: GameState) => { try { const r = play(h, P0, ray, { targets: [[vx]] }); return r.chain.some(c => /Hextech Ray/.test(String(c.label ?? '')) && (c.targets ?? []).flat().includes(vx)); } catch { return false; } };
  assert.equal(tryPlay(g), false, '2 runes: [1] + [R] + 2 Deflect power is unaffordable for Vex (Allay, Deflect 1, is still affordable)');
  addRunes(g, P0, 1, 'fury');
  assert.ok(tryPlay(g), '3 runes: 1 energy + 3 power');
});

test('RJ#11105 My unit moves into an empty battlefield; the opponent plays Rengar, Trophy Hunter there (a unit: no chain); I then Flash my unit to base: only Rengar remains — the opponent conquers (+1)', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const r = hand(g, P1, 'Rengar, Trophy Hunter');
  const fl = hand(g, P0, 'Flash');
  const a = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 8 && !(pend(g).player === P1 && !pend(g).inStep && canPlayNow(g, P1, r, BF_A)); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  const p1 = g.players[P1].points;
  g = play(g, P1, r, { dest: BF_A });
  for (let i = 0; i < 8 && !(pend(g).player === P0 && !pend(g).inStep && canPlayNow(g, P0, fl)) && g.showdown; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.showdown && canPlayNow(g, P0, fl), 'I get a window after Rengar is played');
  g = play(g, P0, fl, { targets: [[a]] });
  g = drive(g, gg => optionIds(gg).includes(a) ? [a] : undefined).g;
  assert.equal(locOf(g, a), 'base');
  assert.equal(g.battlefields[BF_A].controller, P1);
  assert.equal(g.players[P1].points, p1 + 1, 'the opponent conquers');
});

test('RJ#11110 Deceiver after my Assault 2 unit (3 Might) wins a combat and conquers: the Reflection copies it with Assault but isn\'t an attacker — 3 Might, no bonus', () => {
  let g = S0(); fundAll(g, P0, 12); setLegend(g, P0, 'Deceiver'); tokens(g, 'Reflection');
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const rg = put(g, P0, 'sfd-025-221', 'base'); hand(g, P0, 'V(1)');
  const before = new Set(Object.keys(g.objects));
  g = drive(move(g, P0, [rg], BF_A), gg => { const ids = optionIds(gg); return ids.includes(rg) ? [rg] : undefined; }, 60).g;
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  const r = Object.values(g.objects).find(o => !before.has(o.id) && o.isToken && o.zone === 'battlefield');
  assert.ok(r, 'Reflection played');
  assert.ok(hasKeyword(g, r!.id, 'Assault'), 'copied Assault');
  assert.equal(mightOf(g, r!.id), 3, 'not attacking: no Assault bonus');
});

test('RJ#11112 Deceiver\'s conquer trigger on the chain (discard paid): I Ambush Chakram Dancer there in response; the Reflection\'s copy ("Then do this") can then copy the Dancer', () => {
  let g = S0(); fundAll(g, P0, 12); setLegend(g, P0, 'Deceiver'); tokens(g, 'Reflection');
  const x = put(g, P0, 'V(2)', 'base'); hand(g, P0, 'V(1)');
  const cd = hand(g, P0, 'Chakram Dancer');
  g = move(g, P0, [x], BF_A);
  for (let i = 0; i < 12 && !(chainLabels(g).some(l => /Deceiver/.test(l)) && pend(g).player === P0 && !pend(g).inStep); i++) { const d = pend(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g)[0]] }) : pass(g); }
  assert.ok(chainLabels(g).some(l => /Deceiver/.test(l)), `Deceiver trigger on the chain: ${chainLabels(g)}`);
  assert.ok(canPlayNow(g, P0, cd, BF_A), 'Ambush in response');
  g = play(g, P0, cd, { dest: BF_A });
  const before = new Set(Object.keys(g.objects));
  let offered = false;
  g = drive(g, gg => { const ids = optionIds(gg); if (ids.includes(cd)) { offered = true; return [cd]; } return gg.pending!.kind === 'optional' ? ['no'] : undefined; }, 60).g;
  assert.ok(offered, 'the Dancer offered as the copy target');
  const r = Object.values(g.objects).find(o => !before.has(o.id) && o.isToken && o.zone === 'battlefield');
  assert.ok(r, 'Reflection played');
  assert.equal(mightOf(g, r!.id), 3, 'copy of Chakram Dancer');
});

test('RJ#11113 Crescent Strike\'s chosen unit Flashed to base in response: it takes nothing; the other enemy unit still there takes 1', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const t = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const o = put(g, P1, 'V(5)', BF_A);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Crescent Strike') } as never);
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const d = pend(g); g = choose(g, d.options!.find(x => x.id === t || x.id === String(BF_A))?.id ?? d.options![0].id); }
  if (pend(g).player === P0) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Flash'), { targets: [[t]] });
  g = drive(g, gg => { const ids = optionIds(gg); return ids.includes(t) ? [t] : undefined; }).g;
  assert.equal(locOf(g, t), 'base');
  assert.equal(g.objects[t].damage ?? 0, 0, 'no damage to the Flashed unit');
  assert.equal(g.objects[o].damage, 1, 'the other enemy unit there still takes 1');
});

test('RJ#11119 Voidreaver (Kha\'Zix legend): conquering an empty battlefield is no combat — no XP; winning a combat gives 1', () => {
  for (const combat of [false, true]) {
    let g = S0(); setLegend(g, P0, 'Voidreaver'); g.players[P0].xp = 0;
    if (combat) { put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1); }
    const a = put(g, P0, 'V(3)', 'base');
    g = drive(move(g, P0, [a], BF_A)).g;
    assert.equal(g.battlefields[BF_A].controller, P0);
    assert.equal(g.players[P0].xp, combat ? 1 : 0);
  }
});

test('RJ#11121 (MISMATCH-RJ) Inferna (1 + Assault 2 = 3) attacks Vex, Apathetic (4, 3 damage marked) and Evelynn, Entrancing (2, Backline): 1 is lethal for Vex, the other 2 go to Evelynn last — both die', () => {
  let g = S0();
  const vx = put(g, P1, 'unl-150-219', BF_A, { damage: 3 }); const ev = put(g, P1, 'Evelynn, Entrancing', BF_A); control(g, BF_A, P1);
  const inf = put(g, P0, 'Inferna', 'base');
  g = move(g, P0, [inf], BF_A);
  let seen = false;
  for (let i = 0; i < 20; i++) { const d = pend(g); if (d.kind === 'mainAction') break; if (d.kind === 'assignDamage' && d.player === P0) { const l = legal(g, P0); const ok = l.find(a => a.type === 'assignDamage' && (a as { assignment: Record<string, number> }).assignment[vx] === 1 && (a as { assignment: Record<string, number> }).assignment[ev] === 2); assert.ok(ok, 'Vex 1 + Evelynn 2 is a legal assignment'); seen = true; g = act(g, ok!); continue; } g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g); }
  assert.ok(seen);
  assert.equal(zone(g, vx), 'trash'); assert.equal(zone(g, ev), 'trash');
});

test('RJ#11123 Rumble, Hotheaded conquers Vilemaw\'s Lair: his trigger recycles my other unit there and plays a Mech from my trash to that battlefield', () => {
  let g = S0(); fundAll(g, P0, 12); setBattlefieldCard(g, BF_A, "Vilemaw's Lair");
  const rb = put(g, P0, 'Rumble, Hotheaded', 'base');
  const u = put(g, P0, 'V(2)', 'base');
  const gj = put(g, P0, 'Gem Jammer', 'trash');
  let dests: string[] = [];
  g = drive(move(g, P0, [rb, u], BF_A), gg => { const d = gg.pending!; const ids = optionIds(gg); if (d.kind === 'chooseDestination' || d.kind === 'chooseBattlefield') { dests = ids; return ids.includes(String(BF_A)) ? [String(BF_A)] : undefined; } if (ids.includes(u)) return [u]; if (ids.includes(gj)) return [gj]; return d.kind === 'optional' ? ['yes'] : undefined; }, 60).g;
  assert.equal(zone(g, u), 'mainDeck', 'recycled');
  assert.ok(dests.includes(String(BF_A)), `Vilemaw's Lair offered (${dests})`);
  assert.equal(locOf(g, gj), BF_A, 'Mech played there');
});

test('RJ#11124 Deathgrip on my unit, then my Tactical Retreat on it in response: it is recalled instead of dying, so no Might bonus — still draw 1', () => {
  let g = S0(); fundAll(g, P0, 12);
  const u = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const o = put(g, P0, 'V(1)', 'base');
  const tr = hand(g, P0, 'Tactical Retreat');
  const dg = hand(g, P0, 'Deathgrip');
  const pick = (gg: GameState) => { const d = gg.pending!; if (d.kind === 'optional') return ['yes']; const x = d.options?.find(z => z.id === u) ?? d.options?.find(z => z.id === o); return x ? [x.id] : undefined; };
  g = act(g, { type: 'playCard', player: P0, obj: dg } as never);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, { type: 'choose', player: P0, optionIds: pick(g) ?? [optionIds(g)[0]] });
  assert.equal(pend(g).player, P0);
  const h0 = g.players[P0].hand.length - 1;
  g = act(g, { type: 'playCard', player: P0, obj: tr } as never);
  g = drive(g, pick).g;
  assert.equal(locOf(g, u), 'base', 'recalled instead of dying');
  assert.equal(mightOf(g, o), 1, 'no Might bonus');
  assert.equal(g.players[P0].hand.length, h0 + 1, 'drew 1');
});

test('RJ#11125 Amateur Recital\'s hold trigger choosing an enemy Deflect unit must pay its Deflect: without power it can\'t be chosen; with power it is paid and the unit moves to base', () => {
  for (const funded of [false, true]) {
    let g = S0({ tp: P1 }); setBattlefieldCard(g, BF_A, 'Amateur Recital');
    put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
    const vx = put(g, P1, 'unl-150-219', BF_B); control(g, BF_B, P1);
    setRunes(g, P0, funded ? 2 : 0, 'fury');
    g = endTurn(g, P1);
    let offered: string[] | null = null;
    for (let i = 0; i < 30; i++) {
      const d = pend(g); if (d.kind === 'mainAction') break;
      if (d.inStep && d.player === P0 && offered === null && (d.options ?? []).some(o => g.objects[o.id] && g.objects[o.id].zone === 'battlefield' && g.cards[g.objects[o.id].cardId]?.type === 'Unit')) { offered = optionIds(g); }
      if (d.inStep) { const ids = optionIds(g); g = act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : ids.includes(vx) ? vx : ids[0]] }); } else g = pass(g);
    }
    assert.ok(offered, 'Recital asked for a unit');
    assert.equal(offered!.includes(vx), funded, funded ? 'Vex choosable with power for Deflect' : 'no power: Vex not choosable');
    if (funded) assert.equal(locOf(g, vx), 'base');
  }
});

test('RJ#11126 The opponent moves into an empty battlefield; in the showdown I Ride the Wind my stunned 5-Might unit there: it\'s readied but still stunned — it deals no combat damage', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12);
  const m = put(g, P0, 'V(5)', 'base'); g.objects[m].stunned = true; g.objects[m].exhausted = true;
  const e = put(g, P1, 'V(2)', 'base');
  const rw = hand(g, P0, 'Ride the Wind');
  g = move(g, P1, [e], BF_A);
  for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(canPlayNow(g, P0, rw), 'Action with focus in the showdown');
  g = act(g, { type: 'playCard', player: P0, obj: rw } as never);
  g = drive(g, gg => { const ids = optionIds(gg); return ids.includes(m) ? [m] : ids.includes(String(BF_A)) ? [String(BF_A)] : undefined; }).g;
  const t = logText(g);
  assert.ok(/Combat at BF-A/.test(t), 'combat');
  assert.ok(!/deals \d+ to V\(2\)/.test(t), 'my stunned unit dealt no damage');
  assert.equal(zone(g, e), 'base', 'their surviving attacker recalled');
  assert.notEqual(zone(g, m), 'trash');
});

test('RJ#11127 (MISMATCH-RJ, partial) My Assault 2 unit moves into an empty battlefield: a normal Ambush unit (Chakram Dancer) can\'t be played there by the opponent (they control no units there); Rengar, Trophy Hunter can — combat, I\'m the attacker and get Assault', () => {
  let g = S0(); fundAll(g, P1, 12);
  const cd = hand(g, P1, 'Chakram Dancer'); const rt = hand(g, P1, 'Rengar, Trophy Hunter');
  const a = put(g, P0, 'sfd-025-221', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && !(pend(g).player === P1 && !pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, a), 3, 'no combat yet: no Assault');
  assert.equal(canPlayNow(g, P1, cd, BF_A), false, 'Ambush needs their own units there (CR 822.1.b)');
  assert.ok(canPlayNow(g, P1, rt, BF_A), 'Rengar, Trophy Hunter: enemy units suffice');
  g = play(g, P1, rt, { dest: BF_A });
  for (let i = 0; i < 6 && !g.showdown?.isCombat; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.showdown?.isCombat);
  assert.equal(mightOf(g, a), 5, 'attacker: 3 + Assault 2');
});

test('RJ#11132 Dazzling Aurora reveals Rengar, Trophy Hunter: his own permission lets it play him to a battlefield with only enemy units (CR 822.3.a)', () => {
  let g = S0();
  put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  put(g, P0, 'Dazzling Aurora', 'base');
  const r = put(g, P0, 'Rengar, Trophy Hunter', 'deckTop');
  g = endTurn(g, P0);
  let dests: string[] = [];
  for (let i = 0; i < 40 && !(pend(g).kind === 'mainAction' && pend(g).player === P1); i++) {
    const d = pend(g);
    if (d.inStep && d.player === P0 && d.kind === 'chooseDestination' && /Rengar/.test(d.prompt)) { dests = optionIds(g); g = act(g, { type: 'choose', player: P0, optionIds: [String(BF_B)] }); continue; }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.ok(dests.includes(String(BF_B)), `enemy-occupied battlefield offered (${dests})`);
  assert.ok(/P0 plays Rengar to BF-B/.test(logText(g)), 'played there');
});

test('RJ#11134 The opponent attacks my battlefield and my Glasc Mixologist dies in combat: its Deathknell resolves in the combat cleanup, before the result, so I can still play a unit to that battlefield', () => {
  let g = S0({ tp: P1 });
  const mx = put(g, P0, 'Glasc Mixologist', BF_A); control(g, BF_A, P0);
  const v = put(g, P0, 'V(2)', 'trash');
  const a = put(g, P1, 'V(7)', 'base');
  let dests: string[] = [];
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 40 && !(pend(g).kind === 'mainAction'); i++) {
    const d = pend(g);
    if (d.inStep && d.player === P0) { const ids = optionIds(g); if (d.kind === 'chooseDestination') { dests = ids; g = act(g, { type: 'choose', player: P0, optionIds: [ids.includes(String(BF_A)) ? String(BF_A) : ids[0]] }); continue; } if (ids.includes(v)) { g = act(g, { type: 'choose', player: P0, optionIds: [v] }); continue; } if (d.kind === 'optional') { g = yes(g); continue; } }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.equal(zone(g, mx), 'trash');
  assert.ok(dests.includes(String(BF_A)), `the battlefield is still mine when the Deathknell resolves (${dests})`);
  assert.ok(/P0 plays V\(2\) to BF-A/.test(logText(g)), 'played there');
});

test('RJ#11141 Irelia, Fervent attacking alone at Abandoned Hall: En Garde (+1, +1 alone) and its choice (+1), then the Hall\'s +1 choosing her (+1 more from her trigger): 4 + 5 = 9', () => {
  let g = S0({ bfA: 'Abandoned Hall' }); fundAll(g, P0, 12);
  put(g, P1, 'V(12)', BF_A); control(g, BF_A, P1);
  const ir = put(g, P0, 'Irelia, Fervent', 'base');
  g = move(g, P0, [ir], BF_A);
  for (let i = 0; i < 8 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, ir), 4);
  g = play(g, P0, hand(g, P0, 'En Garde'), { targets: [[ir]] });
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) { const d = pend(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g).includes(ir) ? ir : optionIds(g)[0]] }) : pass(g); }
  assert.equal(mightOf(g, ir), 9);
});

test('RJ#11145 A Reflection copying Ekko, Recurrent has his Deathknell, but "Recycle me" can\'t be paid by a token (it ceases to exist): no runes are readied', () => {
  let g = S0(); fundAll(g, P0, 3); tokens(g, 'Reflection');
  const ek = put(g, P0, 'Ekko, Recurrent', 'base');
  const before = new Set(Object.keys(g.objects));
  g = drive(play(g, P0, hand(g, P0, 'Mirror Image'), { targets: [[ek]] })).g;
  const r = g.players[P0].base.find(id => !before.has(id) && g.objects[id].isToken)!;
  g = drive(move(g, P0, [r], BF_A)).g;
  g = drive(play(g, P0, hand(g, P0, 'Hidden Blade'), { targets: [[r]] }), gg => gg.pending!.kind === 'optional' ? ['yes'] : undefined).g;
  assert.ok(!g.objects[r] || g.objects[r].zone !== 'battlefield', 'Reflection died');
  const ex = g.players[P0].runesInPlay.filter(id => g.objects[id].exhausted).length;
  assert.ok(ex > 0, `runes stay exhausted (${ex})`);
  assert.ok(/Deathknell[^\n]*cost can't be paid/.test(logText(g)), 'the copied Deathknell triggered, but its Recycle-me cost failed');
});

test('RJ#11148 The opponent\'s Deadly Flourish on my unit; I kill it first with a hidden Hidden Blade: its "when it dies this turn" Gold never happens', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1, 12); tokens(g, 'Gold');
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const hb = put(g, P0, 'Hidden Blade', { facedown: BF_A });
  g = play(g, P1, hand(g, P1, 'Deadly Flourish'), { targets: [[u]] });
  if (pend(g).player === P1 && !pend(g).inStep) g = pass(g);
  g = play(g, P0, hb, { targets: [[u]] });
  g = drive(g).g;
  assert.equal(zone(g, u), 'trash');
  assert.ok(!Object.values(g.objects).some(o => g.cards[o.cardId]?.name === 'Gold' && o.zone === 'base'), 'no Gold');
});

test('RJ#11149 Azir, Sovereign\'s attack trigger ("move token units to this battlefield"): Star-Crossed returns Azir in response — no "this battlefield", the tokens stay put', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const d = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  control(g, BF_B, P0);
  const t1 = put(g, P0, 'Recruit', BF_B, { token: true }), t2 = put(g, P0, 'Recruit', 'base', { token: true });
  const az = put(g, P0, 'Azir, Sovereign', 'base');
  g = move(g, P0, [az], BF_A);
  const pick = (gg: GameState) => { const x = gg.pending!; if (x.kind === 'optional') return ['yes']; const o = optionIds(gg); if (x.player === P1) return o.includes(d) ? [d] : o.includes(az) ? [az] : undefined; if (o.includes(t1) && o.includes(t2)) return [t1, t2]; return undefined; };
  for (let i = 0; i < 10 && !(chainLabels(g).some(l => /Azir/.test(l)) && pend(g).player === P1 && !pend(g).inStep); i++) { const x = pend(g); g = x.inStep ? act(g, { type: 'choose', player: x.player, optionIds: pick(g) ?? [optionIds(g)[0]] }) : pass(g); }
  assert.ok(chainLabels(g).some(l => /Azir/.test(l)), 'attack trigger on the chain');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Star-Crossed') } as never);
  g = drive(g, pick).g;
  assert.equal(zone(g, az), 'hand');
  assert.equal(locOf(g, t1), BF_B, 'token stayed at BF-B');
  assert.equal(locOf(g, t2), 'base', 'token stayed at base');
});

test('RJ#11151 Void Assault moves my unit and the enemy unit to BF-B; the opponent\'s hidden Emperor\'s Divide moves that enemy unit to base first: it is still the same, legal target — Void Assault moves it from base to BF-B', () => {
  let g = S0(); fundAll(g, P0, 12);
  const f = put(g, P0, 'V(2)', 'base');
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const ed = put(g, P1, "Emperor's Divide", { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Void Assault') } as never);
  for (let i = 0; i < 8 && pend(g).inStep; i++) g = answer(g, { targets: [[f], [e]], locations: [BF_B, BF_B] });
  if (pend(g).player === P0) g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: ed } as never);
  for (let i = 0; i < 4 && pend(g).inStep && pend(g).player === P1; i++) g = act(g, { type: 'choose', player: P1, optionIds: [optionIds(g).includes(e) ? e : optionIds(g)[0]] });
  for (let i = 0; i < 4 && g.chain.length > 1; i++) g = pass(g);
  assert.equal(locOf(g, e), 'base', 'Emperor\'s Divide resolved first');
  g = drive(g).g;
  assert.ok(/Resolving Void Assault\nV\(2\) moves to BF-B\nV\(5\) moves to BF-B/.test(logText(g)), 'both moved by Void Assault');
  assert.equal(locOf(g, e), BF_B, 'moved from base to BF-B (and survives the combat there)');
});

test('RJ#11153 Bewitching Spirit: the opponent can respond to its play trigger (before the discard), not to the discard itself', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const r = hand(g, P1, 'DrawR');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bewitching Spirit'), destination: 'base' } as never);
  for (let i = 0; i < 4 && pend(g).inStep; i++) { const d = pend(g); g = act(g, { type: 'choose', player: d.player, optionIds: [(d.options ?? []).find(o => o.id === String(P1) || /P1|opponent/i.test(o.label))?.id ?? d.options![0].id] }); }
  assert.ok(g.chain.length > 0, 'trigger on the chain');
  if (pend(g).player === P0) g = pass(g);
  assert.equal(pend(g).player, P1);
  assert.ok(canPlayNow(g, P1, r), 'response window before the discard');
  g = drive(g, gg => { const d = gg.pending!; return d.player === P1 && d.kind === 'chooseCards' ? [optionIds(gg).find(id => id !== r) ?? optionIds(gg)[0]] : undefined; }).g;
  assert.equal(g.chain.length, 0);
  assert.equal(pend(g).kind, 'mainAction'); assert.equal(pend(g).player, P0, 'no window after the discard');
});

test('RJ#11155 (MISMATCH-RJ) Faefolk moves into a battlefield with a Scuttle Crab, its trigger will pull a second Crab; I Ambush Kha\'Zix in response: combat (and the attack designation) only starts after the chain is empty — two enemy units, so no +2 / XP', () => {
  let g = S0(); fundAll(g, P0, 12);
  put(g, P1, 'Scuttle Crab', BF_A); control(g, BF_A, P1);
  const c2 = put(g, P1, 'Scuttle Crab', 'base');
  const ff = put(g, P0, 'Irresistible Faefolk', 'base');
  const kz = hand(g, P0, 'unl-143-219');
  g.players[P0].xp = 0;
  g = move(g, P0, [ff], BF_A);
  for (let i = 0; i < 6 && !(pend(g).player === P0 && !pend(g).inStep && chainLabels(g).some(l => /Faefolk/.test(l))); i++) { const d = pend(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g).includes(c2) ? c2 : d.options![0].id] }) : pass(g); }
  assert.ok(chainLabels(g).some(l => /Faefolk/.test(l)));
  assert.ok(!g.showdown?.isCombat, 'no combat (no designations) while the trigger is on the chain');
  g = play(g, P0, kz, { dest: BF_A });
  let combatSeen = false;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) { if (g.showdown?.isCombat && !combatSeen) { combatSeen = true; assert.equal(locOf(g, c2), BF_A, 'the second Crab arrived before combat began'); } const d = pend(g); g = !d.inStep ? pass(g) : d.options?.length ? act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g).includes(c2) ? c2 : d.options[0].id] }) : act(g, legal(g, d.player)[0]); }
  assert.ok(combatSeen);
  assert.ok(!/Kha'Zix[^\n]*\+2|gains? 2 XP/.test(logText(g)), 'no Kha\'Zix bonus');
  assert.equal(g.players[P0].xp ?? 0, 0);
});

test('RJ#11158 A spell played with Fizz, Trickster is countered by Abandon: either order of the two replacements ends with it recycled', () => {
  const g0 = S0(); fundAll(g0, P0); fundAll(g0, P1);
  const enemy = put(g0, P1, 'V(4)', BF_A); control(g0, BF_A, P1);
  const ray = put(g0, P0, 'Hextech Ray', 'trash');
  let g = passAll(play(g0, P0, hand(g0, P0, 'Fizz, Trickster')));
  g = answer(g, { targets: [[ray]] }, P0);
  g = pass(pass(g));
  g = answer(g, { targets: [[enemy]] }, P0);
  g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Abandon') } as never);
  g = drive(g, gg => { const ids = optionIds(gg); return ids.includes(ray) ? [ray] : gg.pending!.kind === 'optional' ? ['no'] : undefined; }).g;
  assert.equal(g.objects[enemy].damage, 0, 'countered');
  assert.equal(zone(g, ray), 'mainDeck', 'recycled, not returned to hand');
});

test('RJ#11164 Deathgrip countered (Defy): its kill is part of the effect, not a cost — my unit survives, nothing happens', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const u = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const o = put(g, P0, 'V(1)', 'base');
  const dg = hand(g, P0, 'Deathgrip');
  const h0 = g.players[P0].hand.length - 1;
  g = act(g, { type: 'playCard', player: P0, obj: dg } as never);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, { type: 'choose', player: P0, optionIds: [optionIds(g).includes(u) ? u : optionIds(g).includes(o) ? o : optionIds(g)[0]] });
  if (pend(g).player === P0 && !pend(g).inStep) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Defy'), { targets: [[dg]] });
  g = drive(g, gg => optionIds(gg).includes(dg) ? [dg] : undefined).g;
  assert.equal(locOf(g, u), BF_A, 'not killed');
  assert.equal(mightOf(g, o), 1);
  assert.equal(g.players[P0].hand.length, h0, 'no draw');
});

test('RJ#11168 Fiora, Peerless defending one on one: Discipline in response to her doubling trigger → (3 + 2) × 2 = 10; Discipline after it resolved → 6 + 2 = 8', () => {
  for (const before of [true, false]) {
    let g = S0({ tp: P1 }); fundAll(g, P0, 12);
    const f = put(g, P0, 'Fiora, Peerless', BF_A); control(g, BF_A, P0);
    const dc = hand(g, P0, 'Discipline');
    g = move(g, P1, [put(g, P1, 'V(1)', 'base')], BF_A);
    for (let i = 0; i < 8 && !(chainLabels(g).some(l => /Fiora/.test(l)) && pend(g).player === P0 && !pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
    assert.ok(chainLabels(g).some(l => /Fiora/.test(l)), 'defend trigger on the chain');
    if (!before) { for (let i = 0; i < 6 && g.chain.length; i++) g = pass(g); assert.equal(mightOf(g, f), 6); for (let i = 0; i < 4 && !(pend(g).player === P0 && !pend(g).inStep); i++) g = pass(g); }
    g = play(g, P0, dc, { targets: [[f]] });
    for (let i = 0; i < 8 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
    assert.equal(mightOf(g, f), before ? 10 : 8);
  }
});

test('RJ#11169 Discipline choosing my Irelia, Fervent is Defied: her "when you choose me" +1 trigger is separate and still resolves', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const ir = put(g, P0, 'Irelia, Fervent', BF_A); control(g, BF_A, P0);
  const dc = hand(g, P0, 'Discipline');
  g = play(g, P0, dc, { targets: [[ir]] });
  for (let i = 0; i < 6 && !(pend(g).player === P1 && !pend(g).inStep); i++) { const d = pend(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g)[0]] }) : pass(g); }
  g = play(g, P1, hand(g, P1, 'Defy'), { targets: [[dc]] });
  g = drive(g, gg => optionIds(gg).includes(dc) ? [dc] : undefined).g;
  assert.equal(mightOf(g, ir), 5, '4 + 1 from her trigger; Discipline\'s +2 countered');
});

test('RJ#11170 (MISMATCH-RJ, partial) Lonely Poro died alone at BF-A, Deathknell on the chain: Vilemaw can\'t Ambush to BF-A (no units of mine left there, CR 822.1.b) — only to a battlefield where I still have units; the draw happens either way', () => {
  let g = S0(); fundAll(g, P0, 12);
  const poro = put(g, P0, 'Lonely Poro', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  const vm = hand(g, P0, 'Vilemaw');
  put(g, P0, 'V(1)', 'deckTop');
  g = play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[poro]] });
  for (let i = 0; i < 8 && !(chainLabels(g).some(l => /Lonely Poro/.test(l)) && pend(g).player === P0 && !pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(zone(g, poro), 'trash');
  assert.ok(chainLabels(g).some(l => /Lonely Poro/.test(l)), 'Deathknell on the chain');
  assert.equal(canPlayNow(g, P0, vm, BF_A), false, 'not to the Poro\'s battlefield');
  assert.ok(canPlayNow(g, P0, vm, BF_B), 'to my other battlefield with units');
  const h0 = g.players[P0].hand.length - 1;
  g = drive(play(g, P0, vm, { dest: BF_B })).g;
  assert.equal(locOf(g, vm), BF_B);
  assert.equal(g.players[P0].hand.length, h0 + 1, 'Lonely Poro still draws');
});

test('RJ#11172 Fiora, Peerless defending alone with the Wuju Bladesman legend: Discipline in response to her trigger (3+2+2 = 7, doubled to 14), then an Ambush unit joins → Yi\'s +2 ends: 12', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); setLegend(g, P0, 'Wuju Bladesman');
  const f = put(g, P0, 'Fiora, Peerless', BF_A); control(g, BF_A, P0);
  const dc = hand(g, P0, 'Discipline'); const amb = hand(g, P0, 'Ambusher(1)');
  g = move(g, P1, [put(g, P1, 'V(1)', 'base')], BF_A);
  for (let i = 0; i < 8 && !(chainLabels(g).some(l => /Fiora/.test(l)) && pend(g).player === P0 && !pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = play(g, P0, dc, { targets: [[f]] });
  for (let i = 0; i < 8 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, f), 14);
  for (let i = 0; i < 4 && !(pend(g).player === P0 && !pend(g).inStep); i++) g = pass(g);
  g = play(g, P0, amb, { dest: BF_A });
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(locOf(g, amb), BF_A);
  assert.equal(mightOf(g, f), 12);
});

test('RJ#11178 Fiora, Peerless attacks one on one; the defender Ambushes a second unit in response to her trigger: the "when" trigger still doubles her (3 → 6)', () => {
  let g = S0(); fundAll(g, P1, 12);
  const f = put(g, P0, 'Fiora, Peerless', 'base');
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const amb = hand(g, P1, 'Ambusher(1)');
  g = move(g, P0, [f], BF_A);
  for (let i = 0; i < 8 && !(chainLabels(g).some(l => /Fiora/.test(l)) && pend(g).player === P1 && !pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(chainLabels(g).some(l => /Fiora/.test(l)), 'attack trigger on the chain, P1 may respond');
  g = play(g, P1, amb, { dest: BF_A });
  for (let i = 0; i < 8 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(locOf(g, amb), BF_A);
  assert.equal(mightOf(g, f), 6);
});

test('RJ#11179 (MISMATCH-RJ, partial) Thousand-Tailed Watcher\'s -3 (min 1) on a 1-Might Mutated Mouser generates -0 (snapshotted, principle 10): 1; when the Watcher then attacks its battlefield, the defending Mouser\'s Shield 2 applies → 3', () => {
  let g = S0(); fundAll(g, P0, 12);
  const m = put(g, P1, 'Mutated Mouser', BF_A); control(g, BF_A, P1);
  const w = hand(g, P0, 'Thousand-Tailed Watcher');
  g = drive(play(g, P0, w, { dest: 'base' })).g;
  assert.equal(locOf(g, w), 'base');
  assert.equal(mightOf(g, m), 1);
  g.objects[w].exhausted = false;
  g = move(g, P0, [w], BF_A);
  for (let i = 0; i < 10 && !g.showdown?.isCombat; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.showdown?.isCombat, 'combat at the Mouser\'s battlefield');
  assert.equal(mightOf(g, m), 3, '1 + Shield 2 while defending');
});

test('RJ#11182 (MISMATCH-RJ, partial) Lonely Poro killed by a spell during a combat showdown, its Deathknell draws Rengar, Trophy Hunter: the showdown goes on, and with focus I may Ambush him to the battlefield with enemy units (CR 346, 822)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const poro = put(g, P0, 'Lonely Poro', BF_A); control(g, BF_A, P0);
  const rg = put(g, P0, 'Rengar, Trophy Hunter', 'deckTop');
  g = move(g, P1, [put(g, P1, 'V(5)', 'base')], BF_A);
  for (let i = 0; i < 10 && !(g.showdown?.isCombat && pend(g).player === P1 && !pend(g).inStep && !g.chain.length); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = play(g, P1, hand(g, P1, 'Hextech Ray'), { targets: [[poro]] });
  for (let i = 0; i < 10 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(zone(g, poro), 'trash'); assert.equal(zone(g, rg), 'hand', 'drawn by the Deathknell (alone)');
  assert.ok(g.showdown?.isCombat, 'the combat showdown continues');
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pass(g);
  assert.ok(canPlayNow(g, P0, rg, BF_A), 'playable with focus');
  g = play(g, P0, rg, { dest: BF_A });
  assert.equal(locOf(g, rg), BF_A);
});

test('RJ#11189 Not So Fast counters the opponent\'s Amateur Recital hold trigger that chose my unit (an enemy ability choosing a friendly unit): my unit stays', () => {
  let g = S0(); setBattlefieldCard(g, BF_A, 'Amateur Recital'); fundAll(g, P0, 12);
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const mine = put(g, P0, 'V(3)', BF_B); control(g, BF_B, P0);
  const nsf = hand(g, P0, 'Not So Fast');
  g = endTurn(g, P0);
  for (let i = 0; i < 20 && !(chainLabels(g).some(l => /Amateur Recital/.test(l)) && pend(g).player === P0 && !pend(g).inStep); i++) {
    const d = pend(g); const o = optionIds(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : o.includes(mine) ? mine : o[0]] }) : pass(g);
  }
  const top = g.chain.at(-1)!;
  assert.ok(/Amateur Recital/.test(String(top.label)), 'hold trigger on the chain');
  g = act(g, { type: 'playCard', player: P0, obj: nsf } as never);
  g = drive(g, gg => optionIds(gg).includes(top.id) ? [top.id] : undefined).g;
  assert.equal(zone(g, nsf), 'trash');
  assert.equal(locOf(g, mine), BF_B, 'not moved to base');
});

test('RJ#11197 Hextech Ray on my Inferna; I respond with hidden Here to Help playing Brynhir Thundersong: his "opponents can\'t play cards" only stops future plays — the Ray still resolves and kills Inferna', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const inf = put(g, P0, 'Inferna', BF_A); control(g, BF_A, P0);
  const hth = put(g, P0, 'Here to Help', { facedown: BF_A });
  const bry = hand(g, P0, 'Brynhir Thundersong');
  g = play(g, P1, hand(g, P1, 'Hextech Ray'), { targets: [[inf]] });
  if (pend(g).player !== P0) g = pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: hth, destination: BF_A } as never);
  g = drive(g, gg => { const o = optionIds(gg); return o.includes(bry) ? [bry] : o.includes(String(BF_A)) ? [String(BF_A)] : gg.pending!.kind === 'optional' ? ['yes'] : undefined; }).g;
  assert.equal(locOf(g, bry), BF_A, 'Brynhir played');
  assert.equal(zone(g, inf), 'trash', 'Hextech Ray still resolved: 3 damage kills Inferna');
});

test('RJ#11198 Not So Fast counters Harnessed Dragon\'s play trigger that chose my unit: it survives', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const u = put(g, P0, 'V(5)', BF_A); control(g, BF_A, P0);
  const nsf = hand(g, P0, 'Not So Fast');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Harnessed Dragon'), destination: 'base' } as never);
  for (let i = 0; i < 12 && !(chainLabels(g).some(l => /trigger:Harnessed Dragon/.test(l)) && pend(g).player === P0 && !pend(g).inStep); i++) { const d = pend(g); const o = optionIds(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [o.includes(u) ? u : o[0]] }) : pass(g); }
  const top = g.chain.at(-1)!;
  assert.ok(/Harnessed Dragon/.test(String(top.label)));
  g = act(g, { type: 'playCard', player: P0, obj: nsf } as never);
  g = drive(g, gg => optionIds(gg).includes(top.id) ? [top.id] : undefined).g;
  assert.equal(locOf(g, u), BF_A, 'not killed');
});

test('RJ#11200 (MISMATCH-RJ) Rift Herald defending dies in combat: its Deathknell plays the unit from hand to my BASE (card text), so it can\'t join the combat — the attacker conquers and scores', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12);
  const rh = put(g, P0, 'Rift Herald', BF_A); control(g, BF_A, P0);
  const u = hand(g, P0, 'V(2)');
  const s0 = g.players[P1].points;
  g = move(g, P1, [put(g, P1, 'V(9)', 'base')], BF_A);
  g = drive(g, gg => { const o = optionIds(gg); return o.includes(u) ? [u] : undefined; }, 60).g;
  assert.equal(zone(g, rh), 'trash');
  assert.equal(locOf(g, u), 'base', 'played to base');
  assert.equal(g.battlefields[BF_A].controller, P1);
  assert.equal(g.players[P1].points, s0 + 1, 'conquer point');
});

test('RJ#11201 Tokens have their tags: The List naming Recruit can give a Recruit token -2', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1, 12); tokens(g, 'Recruit');
  const r = put(g, P0, 'ven-t04', BF_A); control(g, BF_A, P0);
  const other = put(g, P0, 'V(3)', BF_A);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'The List') } as never);
  g = drive(g, gg => { const o = gg.pending!.options?.find(x => /^Recruit$/i.test(x.label)); return o ? [o.id] : undefined; }).g;
  const tl = g.players[P1].base.find(id => g.cards[g.objects[id].cardId].name === 'The List')!;
  g = act(g, legal(g, P1, 'activate').find(a => a.type === 'activate' && a.obj === tl)!);
  g = drive(g, gg => optionIds(gg).includes(r) ? [r] : undefined).g;   // the token is the only legal choice (auto-chosen)
  assert.equal(mightOf(g, r), -1);
  assert.equal(mightOf(g, other), 3, 'the untagged unit is not a legal choice');
});

test('RJ#11206 Baited Hook kills my 3-Might unit in base next to Soraka, Wanderer: the kill is replaced (healed, exhausted, recalled) — no "killed unit", so nothing is played from the top 5', () => {
  let g = S0(); fundAll(g, P0, 12);
  put(g, P0, 'Soraka, Wanderer', 'base');
  const vic = put(g, P0, 'V(3)', 'base');
  const hook = put(g, P0, 'Baited Hook', 'base');
  const top = put(g, P0, 'V(2)', 'deckTop');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && (a as { obj?: ObjId }).obj === hook)!);
  g = answer(g, { targets: [[vic]] }, P0);
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    g = d.kind === 'optional' ? act(g, { type: 'choose', player: d.player, optionIds: ['yes'] }) : optionIds(g).includes(top) ? choose(g, top) : act(g, legal(g, d.player)[0]);
  }
  assert.equal(zone(g, vic), 'base', 'saved by Soraka');
  assert.ok(g.objects[vic].exhausted, 'exhausted by the replacement');
  assert.equal(zone(g, top), 'mainDeck', 'no unit played; the 5 are recycled');
});

test('RJ#11215 Zhonya\'s Hourglass saving my unit doesn\'t "choose" it: the Blade Dancer legend doesn\'t trigger (the unit stays exhausted)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const leg = setLegend(g, P0, 'Blade Dancer');
  put(g, P0, "Zhonya's Hourglass", 'base');
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  g = play(g, P1, hand(g, P1, 'Hextech Ray'), { targets: [[u]] });
  const seen = drive(g).seen; g = drive(g).g;
  assert.equal(zone(g, u), 'base', 'saved and recalled');
  assert.ok(g.objects[u].exhausted);
  assert.ok(!g.objects[leg].exhausted, 'Blade Dancer not used');
  assert.ok(!seen.some(s => /Blade Dancer/.test(s)), 'no Blade Dancer prompt');
});

test('RJ#11217 (MISMATCH-RJ, partial) Spell counters (Defy, Wind Wall) can\'t counter a unit\'s play trigger — but Not So Fast does counter one that chooses my unit (Harnessed Dragon)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const u = put(g, P0, 'V(5)', BF_A); control(g, BF_A, P0);
  const defy = hand(g, P0, 'Defy'); const ww = hand(g, P0, 'Wind Wall'); const nsf = hand(g, P0, 'Not So Fast');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Harnessed Dragon'), destination: 'base' } as never);
  for (let i = 0; i < 12 && !(chainLabels(g).some(l => /trigger:Harnessed Dragon/.test(l)) && pend(g).player === P0 && !pend(g).inStep); i++) { const d = pend(g); const o = optionIds(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [o.includes(u) ? u : o[0]] }) : pass(g); }
  assert.equal(canPlayNow(g, P0, defy), false, 'Defy: no spell to counter');
  assert.equal(canPlayNow(g, P0, ww), false, 'Wind Wall: no spell to counter');
  assert.ok(canPlayNow(g, P0, nsf), 'Not So Fast counters the ability');
});

test('RJ#11221 Bone Skewer plays my Fizz, Trickster into the opponent\'s Teemo, Strategist: Fizz\'s play trigger (choosing Ride the Wind) resolves before combat begins, so before Teemo\'s defend trigger', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const teemo = put(g, P1, 'Teemo, Strategist', BF_A); control(g, BF_A, P1);
  const fizz = hand(g, P0, 'Fizz, Trickster');
  const rtw = put(g, P0, 'Ride the Wind', 'trash');
  const other = put(g, P0, 'V(1)', 'base');   // Ride the Wind moves this one, so Fizz stays for the combat
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Bone Skewer') } as never);
  const order: string[] = [];
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction' && !(g.showdown?.isCombat && !g.chain.length); i++) {
    for (const l of chainLabels(g)) if (/Fizz|Teemo/.test(l) && !order.includes(l)) order.push(l);
    if (chainLabels(g).some(l => /Fizz/.test(l))) assert.ok(!g.showdown?.isCombat, 'no combat while Fizz\'s trigger is pending');
    const d = pend(g); const o = optionIds(g);
    g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [o.includes(other) ? other : o.includes(String(BF_B)) && zone(g, fizz) === 'battlefield' ? String(BF_B) : o.includes(String(BF_A)) ? String(BF_A) : o.includes(fizz) ? fizz : o.includes(rtw) ? rtw : d.kind === 'optional' ? 'yes' : o[0]] }) : pass(g);
  }
  assert.ok(order.some(l => /Fizz/.test(l)), 'Fizz trigger seen: ' + order.join(','));
  const fi = order.findIndex(l => /Fizz/.test(l)), ti = order.findIndex(l => /Teemo/.test(l));
  assert.equal(locOf(g, other), BF_B, 'Ride the Wind was played from the trash by Fizz');
  assert.equal(locOf(g, fizz), locOf(g, teemo));
  assert.ok(ti > fi, 'Teemo\'s trigger only after Fizz\'s: ' + order.join(','));
});

test('RJ#11225 Blue Sentinel holds with the Chem-Baroness legend: her hold trigger triggers twice, but its "exhaust me" is paid when the first is chained — only one Gold', () => {
  let g = S0({ tp: P1 }); const leg = setLegend(g, P0, 'Chem-Baroness'); tokens(g, 'Gold');
  put(g, P0, 'Blue Sentinel', BF_A); control(g, BF_A, P0);
  g = drive(endTurn(g, P1), gg => gg.pending!.kind === 'optional' ? ['yes'] : undefined, 60).g;
  const golds = [...g.players[P0].base].filter(id => g.cards[g.objects[id].cardId]?.name === 'Gold');
  assert.ok(g.objects[leg].exhausted, 'legend exhausted');
  assert.equal(golds.length, 1);
});

test('RJ#11228 Thrill of the Hunt Defied: the banish is part of its effect, not a cost — my unit is never banished (stays in base); the spell\'s cost is still spent', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const u = put(g, P0, 'V(3)', 'base');
  const th = hand(g, P0, 'Thrill of the Hunt');
  const r0 = readyRunes(g, P0);
  g = act(g, { type: 'playCard', player: P0, obj: th } as never);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, { type: 'choose', player: P0, optionIds: [optionIds(g).includes(u) ? u : optionIds(g)[0]] });
  if (pend(g).player === P0 && !pend(g).inStep) g = pass(g);
  assert.ok(readyRunes(g, P0) < r0, 'cost paid');
  g = play(g, P1, hand(g, P1, 'Defy'), { targets: [[th]] });
  g = drive(g, gg => optionIds(gg).includes(th) ? [th] : undefined).g;
  assert.equal(zone(g, th), 'trash');
  assert.equal(zone(g, u), 'base', 'not banished, not replayed');
});

test('RJ#11230 Ezreal, Prodigy ("optional additional costs you pay cost [1] or [A] less") makes Pyke, Dockside Butcher\'s optional [C] free; Pyke still counts it as paid', () => {
  const run = (ez: boolean) => {
    let g = S0(); fundAll(g, P0, 12);
    if (ez) put(g, P0, 'Ezreal, Prodigy', 'base');
    const pk = hand(g, P0, 'Pyke, Dockside Butcher');
    const n = g.log.length;
    g = act(g, { type: 'playCard', player: P0, obj: pk, destination: 'base' } as never);
    g = drive(g, gg => gg.pending!.kind === 'optional' ? ['yes'] : undefined).g;
    return { paid: g.log.slice(n).filter(l => /^P0 pays/.test(l.text)).map(l => l.text).join('; '), might: mightOf(g, pk), ready: !g.objects[pk].exhausted };
  };
  assert.deepEqual(run(false), { paid: 'P0 pays 3 F', might: 4, ready: true });
  assert.deepEqual(run(true), { paid: 'P0 pays 3', might: 4, ready: true }, 'the [C] is reduced to 0');
});

test('RJ#11236 Fiora, Peerless moves to an empty battlefield; in the showdown the opponent Ambushes Rengar, Trophy Hunter there: combat then starts one on one, so her attack trigger doubles her (3 → 6)', () => {
  let g = S0(); fundAll(g, P1, 12);
  const f = put(g, P0, 'Fiora, Peerless', 'base');
  const rg = hand(g, P1, 'Rengar, Trophy Hunter');
  g = move(g, P0, [f], BF_A);
  for (let i = 0; i < 8 && !(g.showdown && pend(g).player === P1 && !pend(g).inStep && !g.chain.length); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.showdown && !g.showdown.isCombat, 'non-combat showdown, P1 has focus');
  g = play(g, P1, rg, { dest: BF_A });
  let sawTrigger = false;
  for (let i = 0; i < 20 && !(g.showdown?.isCombat && !g.chain.length && !pend(g).inStep && chainLabels(g).length === 0 && sawTrigger); i++) { if (chainLabels(g).some(l => /Fiora/.test(l))) sawTrigger = true; g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g); if (mightOf(g, f) === 6) break; }
  assert.equal(locOf(g, rg), BF_A);
  assert.equal(mightOf(g, f), 6);
});

test('RJ#11237 (MISMATCH-RJ) Star-Crossed returns Rift Herald in response to its move trigger: the trigger doesn\'t refer to the Herald, so it still resolves — I may draw a unit from the top 3', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const rh = put(g, P0, 'Rift Herald', 'base');
  const mine = put(g, P1, 'V(1)', 'base');
  const top = put(g, P0, 'V(2)', 'deckTop');
  g = move(g, P0, [rh], BF_A);
  for (let i = 0; i < 8 && !(chainLabels(g).some(l => /Rift Herald/.test(l)) && pend(g).player === P1 && !pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(chainLabels(g).some(l => /Rift Herald/.test(l)), 'move trigger on the chain');
  g = play(g, P1, hand(g, P1, 'Star-Crossed'), { targets: [[mine], [rh]] });
  g = drive(g, gg => { const o = optionIds(gg); return o.includes(mine) ? [mine] : o.includes(rh) ? [rh] : o.includes(top) ? [top] : gg.pending!.kind === 'optional' ? ['yes'] : undefined; }).g;
  assert.equal(zone(g, rh), 'hand', 'Herald returned');
  assert.equal(zone(g, top), 'hand', 'its move trigger still let me draw the unit');
});

test('RJ#11239 Vi, Peacekeeper attacks my Sprite; in response I play Janna, Savior to my (defended) battlefield: Janna moves Vi to base first, so Vi\'s "stun an enemy unit here" does nothing', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); tokens(g, 'Sprite');
  const sp = put(g, P0, 'unl-t07', BF_A); control(g, BF_A, P0);
  const jan = hand(g, P0, 'Janna, Savior');
  const vi = put(g, P1, 'Vi, Peacekeeper', 'base');
  g = move(g, P1, [vi], BF_A);
  for (let i = 0; i < 10 && !(chainLabels(g).some(l => /Vi/.test(l)) && pend(g).player === P0 && !pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(chainLabels(g).some(l => /Vi/.test(l)), 'Vi\'s attack trigger on the chain');
  g = play(g, P0, jan, { dest: BF_A });
  g = drive(g, gg => { const o = optionIds(gg); return o.includes(vi) ? [vi] : gg.pending!.kind === 'optional' ? ['yes'] : undefined; }).g;
  assert.equal(locOf(g, vi), 'base');
  assert.ok(!g.objects[sp].stunned, 'Sprite not stunned');
});

test('RJ#11242 Star-Crossed needs both a friendly and an enemy unit to choose: not playable with no units of mine', () => {
  for (const mine of [false, true]) {
    const g = S0(); fundAll(g, P0, 12);
    put(g, P1, 'V(2)', 'base');
    if (mine) put(g, P0, 'V(1)', 'base');
    assert.equal(canPlayNow(g, P0, hand(g, P0, 'Star-Crossed')), mine);
  }
});

test('RJ#11255 Kato the Arm\'s move trigger gives "another" friendly unit his keywords and Might — never himself', () => {
  for (const other of [false, true]) {
    let g = S0();
    const k = put(g, P0, 'Kato the Arm', 'base');
    const o = other ? put(g, P0, 'V(1)', 'base') : undefined;
    const offered: string[][] = [];
    g = drive(move(g, P0, [k], BF_A), gg => { offered.push(optionIds(gg)); return undefined; }).g;
    for (const ids of offered) assert.ok(!ids.includes(k), 'Kato not offered');
    assert.equal(mightOf(g, k), 3);
    if (o) { assert.equal(mightOf(g, o), 4); assert.ok(hasKeyword(g, o, 'Deflect')); }
  }
});

test('RJ#11256 Piltover Enforcer legend: "3 or more excess damage" = damage assigned beyond lethal (6 into a 3-Might defender: yes, ready a unit; 5 into it: no)', () => {
  for (const [atk, fires] of [[6, true], [5, false]] as const) {
    let g = S0(); const leg = setLegend(g, P0, 'Piltover Enforcer');
    put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
    const a = put(g, P0, `V(${atk})`, 'base');
    g = drive(move(g, P0, [a], BF_A), gg => gg.pending!.kind === 'optional' ? ['yes'] : optionIds(gg).includes(a) ? [a] : undefined, 60).g;
    assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
    assert.equal(g.objects[leg].exhausted, fires, `legend used: ${fires}`);
    assert.equal(g.objects[a].exhausted, !fires, 'attacker readied only with 3+ excess');
  }
});

test('RJ#11261 Stupefy on an enemy unit; its owner responds with Thrill of the Hunt (banished, replayed elsewhere): a new object — no -1 Might, but Stupefy\'s draw still happens', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1); control(g, BF_B, P1); put(g, P1, 'V(1)', BF_B);
  put(g, P0, 'V(1)', 'deckTop');
  const st = hand(g, P0, 'Stupefy');
  const h0 = g.players[P0].hand.length - 1;
  g = play(g, P0, st, { targets: [[e]] });
  if (pend(g).player !== P1) g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Thrill of the Hunt') } as never);
  g = drive(g, gg => { const o = optionIds(gg); return o.includes(e) ? [e] : o.includes(String(BF_B)) ? [String(BF_B)] : undefined; }).g;
  const e2 = Object.values(g.objects).find(o => o.cardId === g.objects[e]?.cardId && o.zone === 'battlefield' && o.controller === P1 && locOf(g, o.id) === BF_B && mightOf(g, o.id) >= 3);
  assert.ok(e2, 'replayed to BF-B');
  assert.equal(mightOf(g, e2!.id), 3, 'no -1');
  assert.equal(g.players[P0].hand.length, h0 + 1, 'Stupefy still drew 1');
});

test('RJ#11269 Cannon Barrage ("all enemy units in combat") during a non-combat showdown at an empty battlefield: no unit is in combat, no damage', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12);
  const dh = put(g, P1, 'Sneaky Deckhand', 'base');
  g = move(g, P1, [dh], BF_A);
  for (let i = 0; i < 8 && !(g.showdown && pend(g).player === P0 && !pend(g).inStep && !g.chain.length); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.showdown && !g.showdown.isCombat, 'non-combat showdown');
  g = drive(play(g, P0, hand(g, P0, 'Cannon Barrage'))).g;
  assert.equal(g.objects[dh].damage, 0);
  assert.equal(locOf(g, dh), BF_A);
});

test('RJ#11276 Flurry of Blades countered by Lilting Lullaby; a second Flurry in response resolves first (1 damage), then the first is countered and I can\'t play spells this turn', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const f1 = hand(g, P0, 'Flurry of Blades'); const f2 = hand(g, P0, 'Flurry of Blades'); const later = hand(g, P0, 'Stupefy');
  g = play(g, P0, f1);
  if (pend(g).player !== P1) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Lilting Lullaby'), { targets: [[f1]] });
  if (pend(g).player !== P0) g = pass(g);
  g = play(g, P0, f2);
  g = drive(g).g;
  assert.equal(g.objects[e].damage, 1, 'only the second Flurry dealt damage');
  assert.equal(zone(g, f1), 'trash'); assert.equal(zone(g, f2), 'trash');
  assert.equal(canPlayNow(g, P0, later), false, 'no more spells this turn');
});

test('RJ#11289 Curtain Call\'s three Repeat costs ([1] / [A] / [1][A]) are separate instances: I may skip the first and pay only the second → two executions', () => {
  let g = S0(); fundAll(g, P0, 12);
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  put(g, P0, 'V(1)', 'deckTop');
  const h0 = g.players[P0].hand.length;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Curtain Call') } as never);
  const pays = ['no', 'yes', 'no']; const modes = ['draw', 'bf2'];
  for (let i = 0; i < 12 && pend(g).inStep; i++) {
    const d = pend(g);
    const ids = d.kind === 'optional' ? [pays.shift()!] : d.kind === 'chooseMode' ? [modes.find(m => optionIds(g).includes(m))!] : optionIds(g).includes(e) ? [e] : [optionIds(g)[0]];
    g = act(g, { type: 'choose', player: d.player, optionIds: ids });
  }
  assert.equal(pays.length, 0, 'three separate Repeat offers');
  g = drive(g).g;
  assert.equal(g.players[P0].hand.length, h0 + 1, 'drew 1');
  assert.equal(g.objects[e].damage, 2, 'second execution dealt 2');
});

test('RJ#11290 Diana, Lunari: declining her "you may pay [1]" means no Predict and no reveal/draw (the cost gates the whole trigger, principle 11)', () => {
  for (const pay of [false, true]) {
    let g = S0({ tp: P1 }); fundAll(g, P0, 12);
    put(g, P0, 'Diana, Lunari', BF_A); control(g, BF_A, P0);
    const sp = put(g, P0, 'Hextech Ray', 'deckTop');
    g = move(g, P1, [put(g, P1, 'V(1)', 'base')], BF_A);
    const r = drive(g, gg => gg.pending!.player === P0 && /pay/i.test(gg.pending!.prompt) ? [pay ? 'yes' : 'no'] : /recycle/i.test(gg.pending!.prompt) ? [] : undefined, 40); g = r.g;
    assert.equal(zone(g, sp), pay ? 'hand' : 'mainDeck', pay ? 'paid: Predict (kept on top), revealed spell drawn' : 'declined: not drawn');
  }
});

test('RJ#11304 I Charm the opponent\'s Hwei from base to BF-A; they respond with a hidden Tideturner at BF-B swapping with Hwei: Tideturner first (Hwei to BF-B, Tideturner to base), then Charm still moves Hwei to BF-A', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const hw = put(g, P1, 'Hwei', 'base');
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  const tt = put(g, P1, 'Tideturner', { facedown: BF_B });
  for (let i = 0; i < 6; i++) { put(g, P1, 'V(1)', 'deckTop'); put(g, P0, 'V(1)', 'deckTop'); }
  g = play(g, P0, put(g, P0, 'ogn-043-298', 'hand'), { targets: [[hw]], locations: [BF_A] });   // real Charm (the harness name 'Charm' is a fixture)
  assert.ok(!pend(g).inStep, 'destination chosen when played');
  if (pend(g).player !== P1) g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: tt, destination: BF_B } as never);
  g = drive(g, gg => { const o = optionIds(gg); return o.includes(hw) ? [hw] : gg.pending!.kind === 'optional' ? ['yes'] : undefined; }, 60).g;
  assert.equal(locOf(g, tt), 'base', 'Tideturner swapped to base');
  assert.equal(locOf(g, hw), BF_A, 'Charm still moved Hwei (from BF-B) to BF-A');
});

test('RJ#11306 (MISMATCH-RJ partial) Deceiver conquer with two other units there: the copy\'s unit is chosen when the reflexive "Then do this" item is chained (principle 4); Star-Crossed on that unit → no copy (no re-pick), on the other unit → copy as chosen, on the Reflection → it ceases to exist', () => {
  for (const hit of ['chosen', 'other', 'token'] as const) {
    let g = S0(); fundAll(g, P0); fundAll(g, P1, 12); setLegend(g, P0, 'Deceiver'); tokens(g, 'Reflection');
    const a = put(g, P0, 'V(3)', 'base'); const b = put(g, P0, 'V(4)', 'base'); hand(g, P0, 'V(1)');
    const mine = put(g, P1, 'V(1)', 'base');
    const sc = hand(g, P1, 'Star-Crossed');
    g = move(g, P0, [a, b], BF_A);
    let refl: string | undefined; let copyPrompt = false;
    for (let i = 0; i < 20 && !(refl && !pend(g).inStep); i++) {
      const d = pend(g); if (d.kind === 'mainAction') break;
      if (d.inStep && d.kind === 'chooseTargets' && /copy/i.test(d.prompt)) { copyPrompt = true; g = choose(g, a); }
      else g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : d.options![0].id) : pass(g);
      refl = Object.keys(g.objects).find(id => g.objects[id].isToken && g.objects[id].zone === 'battlefield');
    }
    assert.ok(copyPrompt && refl && g.chain.length > 0, 'copy target chosen as the reflexive item was chained; it is pending');
    if (pend(g).player !== P1) g = pass(g);
    g = play(g, P1, sc, { targets: [[hit === 'token' ? refl! : hit === 'chosen' ? a : b]] });   // its friendly unit (the lone V(1)) is auto-chosen
    g = drive(g).g;
    assert.equal(zone(g, mine), 'hand');
    if (hit === 'token') assert.ok(!g.objects[refl!] || !['battlefield', 'trash', 'hand'].includes(zone(g, refl!) as string), 'the token ceased to exist');
    else assert.equal(mightOf(g, refl!), hit === 'chosen' ? 0 : 3, hit === 'chosen' ? 'chosen unit gone: no copy' : 'copied V(3) as chosen');
  }
});

test('RJ#11307 Darius, Trifarian played first, then Fizz, Trickster (2nd card) whose trigger plays a trash spell: Darius still gets +2 and readies (the later 3rd card changes nothing)', () => {
  let g = S0(); fundAll(g, P0, 12);
  const enemy = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const ray = put(g, P0, 'Hextech Ray', 'trash');
  const dz = hand(g, P0, 'Darius, Trifarian');
  g = drive(act(g, { type: 'playCard', player: P0, obj: dz, destination: 'base' } as never)).g;
  assert.equal(g.objects[dz].exhausted, true, 'entered exhausted');
  g = passAll(play(g, P0, hand(g, P0, 'Fizz, Trickster')));
  g = drive(g, gg => { const o = optionIds(gg); return o.includes(ray) ? [ray] : o.includes(enemy) ? [enemy] : undefined; }).g;
  assert.ok(g.objects[enemy].damage > 0, 'the trash spell was played (3rd card)');
  assert.equal(mightOf(g, dz), 7, '+2');
  assert.equal(g.objects[dz].exhausted, false, 'readied');
});

test('RJ#11308 Assault attacker survives Ruined Rex\'s Deathknell only thanks to Assault: it conquers and scores first, then dies when the combat ends and Assault goes (CR 468.5 before 468.7.a)', () => {
  let g = S0(); fundAll(g, P0);
  const a = put(g, P0, 'Assault(4,2)', 'base');
  const rex = put(g, P1, 'Ruined Rex', BF_A); control(g, BF_A, P1);
  g.objects[rex].stunned = true; g.timestamp++;   // deals no combat damage
  const pts = g.players[P0].points;
  g = drive(move(g, P0, [a], BF_A), gg => { const o = optionIds(gg); return o.includes(a) ? [a] : undefined; }, 60).g;
  assert.equal(zone(g, rex), 'trash');
  const t = logText(g);
  assert.ok(t.indexOf('P0 conquers BF-A') >= 0 && t.indexOf('P0 conquers BF-A') < t.indexOf('Assault(4,2) died'), 'conquered before dying');
  assert.equal(g.players[P0].points, pts + 1, 'scored');
  assert.equal(zone(g, a), 'trash', '4 damage on 4 Might after Assault ends');
});

test('RJ#11309 Blue Sentinel holding at Power Nexus: the Nexus hold trigger fires twice; paying [A][A][A][A] for each scores 2 (not the once-per-battlefield hold point)', () => {
  let g = S0({ tp: P1, bfA: 'Power Nexus' });
  put(g, P0, 'Blue Sentinel', BF_A); control(g, BF_A, P0);
  setRunes(g, P0, 8, 'fury');
  g = act(g, { type: 'endTurn', player: P1 });
  for (let i = 0; i < 40; i++) {
    const d = g.pending!;
    if (!d || (d.kind === 'mainAction' && d.player === P0)) break;
    g = d.kind === 'optional' ? yes(g) : d.inStep ? choose(g, d.options![0].id) : pass(g);
  }
  assert.equal((logText(g).match(/Resolving Power Nexus/g) ?? []).length, 2, 'two Nexus triggers');
  assert.equal(g.players[P0].points, 3, 'hold 1 + Nexus 1 + Nexus 1');
});

test('RJ#11310 Lotus Trap played from face down: it resolves before Katarina\'s "play a card from face down" trigger, so her 2 damage to the Trapped unit is doubled (4)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12);
  put(g, P0, 'unl-023-219', 'base');
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const lt = put(g, P0, 'Lotus Trap', { facedown: BF_A });
  const e = put(g, P1, 'V(8)', 'base');
  g = move(g, P1, [e], BF_A);
  for (let i = 0; i < 8 && !(pend(g).player === P0 && !pend(g).inStep && canPlayNow(g, P0, lt)); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: lt } as never);
  const seen: string[] = [];
  for (let i = 0; i < 12 && (g.chain.length || pend(g).inStep); i++) { const d = pend(g); if (d.inStep) { seen.push(d.prompt); g = choose(g, d.options!.some(o => o.id === e) ? e : d.options![0].id); } else g = pass(g); }
  assert.equal(g.objects[e].damage, 4, 'Katarina\'s 2 doubled by the resolved Lotus Trap');
  const L = logText(g);
  assert.ok(L.indexOf('Resolving Lotus Trap') < L.indexOf('Resolving Katarina'), 'Lotus Trap resolved first');
});

test('RJ#11312 Atakhan attacks my battlefield; in response I play Janna, Savior there and move him to his base: his "defender must kill one of their units here" now reads his base — none of my units die', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const jan = hand(g, P0, 'Janna, Savior');
  const at = put(g, P1, 'Atakhan', 'base');
  g = move(g, P1, [at], BF_A);
  for (let i = 0; i < 10 && !(chainLabels(g).some(l => /Atakhan/.test(l)) && pend(g).player === P0 && !pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(chainLabels(g).some(l => /Atakhan/.test(l)), 'Atakhan\'s attack trigger on the chain');
  g = play(g, P0, jan, { dest: BF_A });
  g = drive(g, gg => { const o = optionIds(gg); return o.includes(at) ? [at] : gg.pending!.kind === 'optional' ? ['yes'] : undefined; }).g;
  assert.equal(locOf(g, at), 'base');
  assert.equal(zone(g, u), 'battlefield', 'my unit survives');
  assert.equal(zone(g, jan), 'battlefield', 'Janna survives');
});

test('RJ#11314 Vex, Apathetic doesn\'t choose the played unit, so Deflect doesn\'t apply: an enemy Deflect unit played is stunned with no Deflect cost asked', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1, 6);
  put(g, P0, 'Vex, Apathetic', BF_A); control(g, BF_A, P0);
  const d = hand(g, P1, 'Deflect(2,1)');
  const r = drive(play(g, P1, d, { dest: 'base' })); g = r.g;
  assert.ok(!r.seen.some(s => /deflect/i.test(s)), `no Deflect prompt (${r.seen.join(' | ')})`);
  assert.equal(!!g.objects[d].stunned, true);
});

test('RJ#11317 Blade Dancer (Irelia legend) is an optional trigger decided when my spell chooses the unit: declined then, it never goes on the chain and can\'t be used later', () => {
  let g = S0(); fundAll(g, P0);
  const leg = setLegend(g, P0, 'Blade Dancer');
  const u = put(g, P0, 'V(2)', 'base'); g.objects[u].exhausted = true; g.timestamp++;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Discipline') } as never);
  const prompts: string[] = [];
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const d = pend(g); prompts.push(d.kind); g = act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'no' : optionIds(g).includes(u) ? u : optionIds(g)[0]] }); }
  assert.ok(prompts.includes('optional'), `asked while the spell is played (${prompts.join(',')})`);
  assert.ok(!chainLabels(g).some(l => /Blade Dancer/.test(l)), 'declined: not on the chain');
  g = drive(g).g;
  assert.equal(g.objects[u].exhausted, true, 'not readied');
  assert.equal(g.objects[leg].exhausted, false);
});

test('RJ#11318 An Edge of Night already on the board can\'t be hidden (only from hand / Champion Zone, CR 811.1.b)', () => {
  const g = S0(); fundAll(g, P0);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const onBoard = put(g, P0, 'Edge of Night', 'base');
  const inHand = hand(g, P0, 'Edge of Night');
  assert.ok(rejects(g, { type: 'hide', player: P0, obj: onBoard, battlefieldIndex: BF_A } as never), 'board copy can\'t be hidden');
  assert.ok(!rejects(g, { type: 'hide', player: P0, obj: inHand, battlefieldIndex: BF_A } as never), 'hand copy can');
});

test('RJ#11321 Glorious Executioner: attacker and defender both stunned, both survive, attacker recalled → No Result, no draw', () => {
  let g = S0(); setLegend(g, P0, 'Glorious Executioner');
  const a = put(g, P0, 'V(2)', 'base');
  const d = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  g.objects[d].stunned = true; g.timestamp++;
  g = move(g, P0, [a], BF_A);
  g.objects[a].stunned = true; g.timestamp++;
  const h0 = g.players[P0].hand.length;
  g = drive(g, undefined, 60).g;
  assert.equal(locOf(g, a), 'base', 'attacker recalled');
  assert.equal(g.battlefields[BF_A].controller, P1);
  assert.equal(g.players[P0].hand.length, h0, 'no draw');
});

test('RJ#11322 Arachnoid Horror: friendly units may be played to a battlefield where an enemy unit is alone — and more than one (the enemy stays "alone": no other friendly unit of its own); they enter exhausted', () => {
  let g = S0(); fundAll(g, P0, 12);
  put(g, P0, 'Arachnoid Horror', 'base');
  put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const u1 = hand(g, P0, 'V(1)');
  assert.ok(playDests(g, P0, u1).includes(BF_A), 'first unit can go there');
  g = play(g, P0, u1, { dest: BF_A });
  const jan = hand(g, P0, 'Janna, Savior');   // a Reaction unit, playable in the combat showdown that follows
  for (let i = 0; i < 8 && !(pend(g).player === P0 && !pend(g).inStep && canPlayNow(g, P0, jan)); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(locOf(g, u1), BF_A);
  assert.ok(playDests(g, P0, jan).includes(BF_A), 'second unit can go there too');
  const g2 = S0(); fundAll(g2, P0, 12); put(g2, P0, 'Arachnoid Horror', 'base');
  put(g2, P1, 'V(5)', BF_A); put(g2, P1, 'V(5)', BF_A); control(g2, BF_A, P1);
  assert.ok(!playDests(g2, P0, hand(g2, P0, 'V(1)')).includes(BF_A), 'two enemy units: not alone');
  // (checked before the combat: the 1-Might unit dies to the 5-Might defender once the showdown ends — ENGINE-7)
  assert.equal(g.objects[u1].exhausted, true, 'entered exhausted');
  g = drive(g).g;
});

test('RJ#11325 Scuttle Crab (0) defending alone with Wuju Bladesman (+2 while defending alone) vs Ahri, Inquisitive\'s attack -2 (min 1): 1 Might', () => {
  let g = S0(); setLegend(g, P1, 'Wuju Bladesman');
  const crab = put(g, P1, 'Scuttle Crab', BF_A); control(g, BF_A, P1);
  const ah = put(g, P0, 'ogn-119-298', 'base');
  g = move(g, P0, [ah], BF_A);
  let seen = -1;
  for (let i = 0; i < 12 && seen < 0; i++) {
    const d = pend(g); if (d.kind === 'mainAction' || d.kind === 'assignDamage') break;
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
    if (!g.chain.length && g.showdown?.isCombat && logText(g).includes('Resolving Ahri')) seen = mightOf(g, crab);
  }
  assert.equal(seen, 1);
});

test('RJ#11332 Challenge is not a combat: Fiora, Peerless\'s "when I attack or defend one on one" doesn\'t trigger (3 vs 3, both die)', () => {
  let g = S0(); fundAll(g, P0);
  const f = put(g, P0, 'sfd-110-221', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(3)', BF_B); control(g, BF_B, P1);
  g = drive(play(g, P0, hand(g, P0, 'Challenge'), { targets: [[f], [e]] }), gg => gg.pending!.kind === 'chooseTargets' && gg.pending!.options!.some(o => o.id === f) ? [f] : undefined).g;
  assert.ok(!/Resolving Fiora/.test(logText(g)), 'no Fiora trigger');
  assert.equal(zone(g, f), 'trash'); assert.equal(zone(g, e), 'trash');
});

test('RJ#11333 Teemo (ogn-121, "When I defend, choose an enemy unit here and reveal…") defending against a lone Ruin Runner: no legal choice, the trigger is removed — no reveal, no damage', () => {
  let g = S0();
  const t = put(g, P1, 'ogn-121-298', BF_A); control(g, BF_A, P1);
  const rr = put(g, P0, 'Ruin Runner', 'base');
  const deck0 = g.players[P1].mainDeck.length;
  g = drive(move(g, P0, [rr], BF_A), undefined, 60).g;
  assert.ok(/Teemo: When I defend.*no legal targets/.test(logText(g)) && !/Resolving Teemo/.test(logText(g)), 'trigger removed, never resolves');
  assert.equal(g.players[P1].mainDeck.length, deck0);
  assert.equal(zone(g, t), 'trash', 'Teemo dies in combat');
});

test('RJ#11338 Rengar (unl-120, may Ambush to a battlefield with enemy units) can\'t be played to Rockfall Path ("Units can\'t be played here": can\'t beats can)', () => {
  const g = S0({ bfA: 'Rockfall Path' }); fundAll(g, P0, 12);
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  const r = hand(g, P0, 'unl-120-219');
  const ds = playDests(g, P0, r);
  assert.ok(ds.includes(BF_B), `his Ambush permission works elsewhere (${ds.join(',')})`);
  assert.ok(!ds.includes(BF_A), 'not to Rockfall Path');
});

test('RJ#11341 Gearhead (3) equipped with Brutalizer this turn: 3 + doubled base +1 (2) + the attached-this-turn +2 (not doubled) = 7', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'Gearhead', 'base');
  const b = put(g, P0, 'Brutalizer', 'base');
  g = drive(answer(act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === b)!), { targets: [[u]] }, P0)).g;
  assert.equal(g.objects[b].attachedTo, u);
  assert.equal(mightOf(g, u), 7);
});

test('RJ#11346 (AMBIGUOUS, house) Akshan, Mischievous\'s trigger on the opponent\'s equipped Guardian Angel; they Star-Crossed Akshan in response: the move still happens (detached) but I never control it — the cleanup recalls it, unattached, to its controller\'s base', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const holder = put(g, P1, 'V(3)', 'base');
  const ga = put(g, P1, 'Guardian Angel', 'base'); attachNow(g, ga, holder);
  const mine = put(g, P1, 'V(1)', 'base');
  const sc = hand(g, P1, 'Star-Crossed');
  const ak = hand(g, P0, 'Akshan, Mischievous');
  g = act(g, { type: 'playCard', player: P0, obj: ak, destination: 'base' });
  const trig = () => g.chain.some(c => /enemy gear/.test(String(c.label)));
  for (let i = 0; i < 8 && !(trig() && !pend(g).inStep); i++) { const d = pend(g); g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : d.options!.some(o => o.id === ga) ? ga : d.options![0].id) : pass(g); }
  assert.ok(trig(), 'play trigger on the chain');
  if (pend(g).player !== P1) g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: sc });
  for (let i = 0; i < 4 && pend(g).inStep; i++) { const d = pend(g); g = choose(g, d.options!.some(o => o.id === mine) ? mine : ak); }
  g = drive(g, gg => gg.pending!.options?.some(o => o.id === ga) ? [ga] : undefined).g;
  assert.equal(zone(g, ak), 'hand');
  assert.equal(g.objects[ga].controller, P1, 'P1 still controls it');
  assert.ok(!g.objects[ga].attachedTo, 'unattached (moved off its unit)');
  assert.ok(g.players[P1].base.includes(ga), 'recalled to P1\'s base in the cleanup');
});

test('RJ#11347 (MISMATCH-RJ reasoning) Darius attacks and kills a stunned Rift Herald; its Deathknell plays Harnessed Dragon to its controller\'s BASE (not the combat) and the Dragon kills Darius: no attacker left, no conquer', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12);
  const rh = put(g, P0, 'Rift Herald', BF_A); control(g, BF_A, P0);
  g.objects[rh].stunned = true; g.objects[rh].damage = 4; g.timestamp++;
  const hd = hand(g, P0, 'Harnessed Dragon');
  const dz = put(g, P1, 'Darius, Trifarian', 'base');
  const s0 = g.players[P1].points;
  g = move(g, P1, [dz], BF_A);
  g = drive(g, gg => { const o = optionIds(gg); return o.includes(hd) ? [hd] : o.includes(dz) ? [dz] : undefined; }, 60).g;
  assert.equal(zone(g, rh), 'trash');
  assert.equal(locOf(g, hd), 'base', 'Dragon played to base');
  assert.equal(zone(g, dz), 'trash', 'Darius killed by the Dragon');
  assert.equal(g.players[P1].points, s0, 'no conquer');
  assert.notEqual(g.battlefields[BF_A].controller, P1);
});

test('RJ#11348 Void Assault moves my unit, then an enemy unit, to the same empty battlefield: my unit applied Contested, so I am the attacker (principle 18)', () => {
  let g = S0(); fundAll(g, P0);
  const f = put(g, P0, 'V(3)', 'base');
  const e = put(g, P1, 'V(2)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Void Assault') });
  for (let i = 0; i < 8 && pend(g).inStep; i++) g = answer(g, { targets: [[f], [e]], locations: [BF_A, BF_A] });
  for (let i = 0; i < 10 && !g.showdown?.isCombat; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(locOf(g, f), BF_A); assert.equal(locOf(g, e), BF_A);
  assert.ok(g.showdown?.isCombat, 'combat');
  assert.equal(g.showdown?.attacker, P0);
  assert.equal(g.showdown?.defender, P1);
});

test('RJ#11366 Opponent Gusts their own unit at their battlefield; I respond with Rengar (unl-120) Ambushing there: Gust resolves, Rengar is alone → non-combat showdown and I conquer', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const r = hand(g, P0, 'unl-120-219');
  const s0 = g.players[P0].points;
  g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[e]] });
  if (pend(g).player !== P0) g = pass(g);
  assert.ok(playDests(g, P0, r).includes(BF_A), 'Rengar may Ambush there (enemy unit present)');
  g = play(g, P0, r, { dest: BF_A });
  g = drive(g, undefined, 60).g;
  assert.equal(zone(g, e), 'hand');
  assert.equal(locOf(g, r), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, s0 + 1, 'conquered (on the opponent\'s turn)');
  assert.ok(!/Combat at BF-A/.test(logText(g)), 'no combat');
});

test('RJ#11368 (MISMATCH-RJ) Fiora, Peerless (3) defending one on one at Forbidding Waste (-2 while defending alone): doubling adds her CURRENT Might (1, CR 433.1 — its example counts Shield) → 2, not 4', () => {
  let g = S0({ bfA: 'Forbidding Waste' });
  const f = put(g, P1, 'sfd-110-221', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [a], BF_A);
  let seen = -1;
  for (let i = 0; i < 12 && seen < 0; i++) {
    const d = pend(g); if (d.kind === 'mainAction' || d.kind === 'assignDamage') break;
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
    if (!g.chain.length && g.showdown?.isCombat && logText(g).includes('Resolving Fiora')) seen = mightOf(g, f);
  }
  assert.equal(seen, 2);
});

test('RJ#11370/RJ#11371 A Reflection that copied a non-token unit (3 Might) is still a token: Gust can return it and it ceases to exist; a copy of a 4+ unit can\'t be Gusted', () => {
  for (const m of [3, 4]) {
    let g = S0(); fundAll(g, P0); fundAll(g, P1, 12); setLegend(g, P0, 'Deceiver'); tokens(g, 'Reflection');
    const a = put(g, P0, `V(${m})`, 'base'); hand(g, P0, 'V(1)');
    const before = new Set(Object.keys(g.objects));
    g = drive(move(g, P0, [a], BF_A), undefined, 60).g;
    const r = Object.keys(g.objects).find(id => !before.has(id) && g.objects[id].isToken && g.objects[id].zone === 'battlefield');
    assert.ok(r, 'Reflection on the board');
    assert.equal(mightOf(g, r!), m, 'copied');
    assert.ok(g.objects[r!].isToken, 'still a token');
    g = endTurn(g, P0);
    for (let i = 0; i < 20 && !(pend(g).kind === 'mainAction' && pend(g).player === P1); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
    assert.equal(zone(g, r!), 'battlefield', 'Temporary only kills it in MY next Beginning Phase');
    const gust = hand(g, P1, 'Gust');
    assert.equal(canPlayNow(g, P1, gust), m <= 3);
    if (m <= 3) {
      g = drive(play(g, P1, gust, { targets: [[r!]] })).g;
      assert.ok(!g.objects[r!] || !['battlefield', 'hand', 'trash'].includes(zone(g, r!) as string), 'returned → ceased to exist');
    }
  }
});

test('RJ#11384 A Gold token ("Kill this, [T]: [Add] [A]") can pay the [A] to hide a card', () => {
  let g = S0(); tokens(g, 'Gold');
  setRunes(g, P0, 0);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const gold = put(g, P0, 'unl-t05', 'base', { token: true });
  const c = hand(g, P0, 'Hidden Blade');
  assert.ok(!rejects(g, { type: 'hide', player: P0, obj: c, battlefieldIndex: BF_A } as never), 'hide is affordable with the Gold');
  g = act(g, { type: 'hide', player: P0, obj: c, battlefieldIndex: BF_A } as never);
  g = drive(g).g;
  assert.ok(g.objects[c].faceDown, 'hidden');
  assert.ok(!g.objects[gold] || zone(g, gold) !== 'base', 'the Gold was used');
});

test('RJ#11389 Vi, Peacekeeper attacks a battlefield with Overzealous Fan: the defender\'s Fan trigger resolves first (kill me → Vi to base), so Vi\'s "stun an enemy unit here" does nothing', () => {
  let g = S0({ tp: P1 });
  const fan = put(g, P0, 'Overzealous Fan', BF_A); control(g, BF_A, P0);
  const other = put(g, P0, 'V(1)', BF_A);
  const vi = put(g, P1, 'Vi, Peacekeeper', 'base');
  g = drive(move(g, P1, [vi], BF_A), gg => { const d = gg.pending!; if (d.player === P0 && d.kind === 'optional') return ['yes']; const o = optionIds(gg); return o.includes(vi) ? [vi] : undefined; }, 60).g;
  assert.equal(zone(g, fan), 'trash', 'Fan killed itself');
  assert.equal(locOf(g, vi), 'base', 'Vi moved to her base');
  assert.ok(!g.objects[other].stunned, 'no stun');
});

test('RJ#11394 I move into an empty battlefield; the opponent Ambushes Rengar (unl-120) there as a defender; I stun it and don\'t kill it: my attacker is recalled and the opponent conquers (on my turn)', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const a = put(g, P0, 'V(2)', 'base');
  const r = hand(g, P1, 'unl-120-219');
  const s1 = g.players[P1].points;
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 8 && !(pend(g).player === P1 && !pend(g).inStep && canPlayNow(g, P1, r)); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(canPlayNow(g, P1, r), 'Rengar can Ambush in');
  g = play(g, P1, r, { dest: BF_A });
  for (let i = 0; i < 10 && !(g.showdown?.isCombat && pend(g).player === P0 && !pend(g).inStep && !g.chain.length); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.showdown?.isCombat && g.showdown.defender === P1, 'Rengar defends');
  g = play(g, P0, put(g, P0, 'ogn-050-298', 'hand'), { targets: [[r]] });   // Rune Prison: stun
  g = drive(g, undefined, 60).g;
  assert.equal(locOf(g, r), BF_A, 'Rengar survives');
  assert.equal(locOf(g, a), 'base', 'attacker recalled');
  assert.equal(g.battlefields[BF_A].controller, P1);
  assert.equal(g.players[P1].points, s1 + 1, 'opponent conquers');
});

test('RJ#11400 Deceiver with an empty hand: its "discard 1 and exhaust me" cost can\'t be paid, so a conquer plays no Reflection (and a unit dying never triggers it)', () => {
  let g = S0(); setLegend(g, P0, 'Deceiver'); tokens(g, 'Reflection');
  g.players[P0].hand = [];
  const a = put(g, P0, 'V(2)', 'base');
  const before = new Set(Object.keys(g.objects));
  const r = drive(move(g, P0, [a], BF_A), undefined, 60); g = r.g;
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  assert.ok(!Object.keys(g.objects).some(id => !before.has(id) && g.objects[id].isToken && g.objects[id].zone === 'battlefield'), 'no Reflection');
  assert.ok(!r.seen.some(s => /Deceiver|Reflection/i.test(s)), `not offered (${r.seen.join(' | ')})`);
});

test('RJ#11405 Switcheroo on my V(4)+Guardian Angel (5) and a V(2): it becomes 2 (a fixed -3 this turn); killed and saved by Guardian Angel, it loses the gear\'s +1 but keeps the swap → 1 in base', () => {
  let g = S0(); fundAll(g, P0, 12);
  const u = put(g, P0, 'V(4)', BF_A); control(g, BF_A, P0);
  const ga = put(g, P0, 'Guardian Angel', BF_A); attachNow(g, ga, u);
  const v = put(g, P0, 'V(2)', BF_A);
  assert.equal(mightOf(g, u), 5);
  g = drive(play(g, P0, hand(g, P0, 'Switcheroo'), { targets: [[u, v]] }), gg => { const o = optionIds(gg); return o.includes(u) && o.includes(v) ? [u, v] : undefined; }).g;
  assert.equal(mightOf(g, u), 2, 'swapped'); assert.equal(mightOf(g, v), 5);
  g = drive(play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[u]] }), gg => { const o = optionIds(gg); return o.includes(u) ? [u] : undefined; }).g;
  assert.equal(zone(g, ga), 'trash', 'Guardian Angel used');
  assert.equal(locOf(g, u), 'base', 'saved and recalled');
  assert.equal(mightOf(g, u), 1, '4 - 3 (swap modifier stays)');
});

test('RJ#11419 Star Spring can\'t move Determined Sentry ("I can\'t move to base") to base — can\'t beats can', () => {
  let g = S0({ bfA: 'Star Spring' }); fundAll(g, P0, 12);
  const s = put(g, P0, 'Determined Sentry', BF_A); control(g, BF_A, P0);
  const u = hand(g, P0, 'V(1)');
  g = drive(play(g, P0, u, { dest: BF_A }), gg => { const o = optionIds(gg); return o.includes(s) ? [s] : gg.pending!.kind === 'optional' ? ['yes'] : undefined; }).g;
  assert.equal(locOf(g, u), BF_A);
  assert.equal(locOf(g, s), BF_A, 'Sentry stays');
});

test('RJ#11423 (MISMATCH-RJ partial) At 7 on the opponent\'s turn, Thrill of the Hunt conquers a battlefield: with my other battlefield already scored this turn the final point is gained and I win then (at the cleanup, on their turn); otherwise I draw instead', () => {
  for (const scoredOther of [true, false]) {
    let g = S0({ tp: P1 }); fundAll(g, P0, 12); fundAll(g, P1, 12);
    g.players[P0].points = 7;
    put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
    if (scoredOther) g.battlefields[BF_B].scoredThisTurnBy = [P0];
    const u = put(g, P0, 'V(2)', 'base');
    const h0 = g.players[P0].hand.length;
    g = play(g, P1, hand(g, P1, 'DrawR'));
    if (pend(g).player !== P0) g = pass(g);
    g = play(g, P0, hand(g, P0, 'Thrill of the Hunt'), { targets: [[u]] });
    for (let i = 0; i < 30 && g.phase !== 'gameOver' && !(pend(g).kind === 'mainAction'); i++) { const d = pend(g); if (d.inStep) { const o = optionIds(g); g = choose(g, o.includes(u) ? u : o.includes(String(BF_A)) ? String(BF_A) : o[0]); } else g = pass(g); }
    assert.equal(locOf(g, u), BF_A); assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
    if (scoredOther) { assert.equal(g.players[P0].points, 8); assert.equal(g.winner, P0, 'wins on the opponent\'s turn'); }
    else { assert.equal(g.players[P0].points, 7); assert.ok(g.players[P0].hand.length > h0 - 1, 'drew instead of the final point'); assert.notEqual(g.winner, P0); }
  }
});

test('RJ#11426 Moonfall: an enemy unit already at the chosen battlefield can\'t be chosen to move there; the -2 still hits enemy units there', () => {
  let g = S0(); fundAll(g, P0, 12);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const there = put(g, P1, 'V(4)', BF_A);
  const away = put(g, P1, 'V(4)', BF_B); control(g, BF_B, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Moonfall') } as never);
  const offered: string[][] = [];
  g = drive(g, gg => { const o = optionIds(gg); if (o.includes(away) || o.includes(there)) { offered.push(o); return []; } return o.includes(String(BF_A)) ? [String(BF_A)] : undefined; }).g;
  assert.ok(offered.length && offered.every(o => !o.includes(there)), 'the unit already there is not a move choice');
  assert.equal(mightOf(g, there), 2, '-2 anyway');
});

test('RJ#11427 Unsung Hero (2) + Call to Glory (+3): Sacrifice in response is not playable (not Mighty yet); after Call to Glory resolves (5) it is', () => {
  let g = S0(); fundAll(g, P0, 12);
  const h = put(g, P0, 'Unsung Hero', 'base');
  const sac = hand(g, P0, 'Sacrifice');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Call to Glory') } as never);
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const d = pend(g); g = act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'no' : optionIds(g).includes(h) ? h : optionIds(g)[0]] }); }
  assert.ok(g.chain.length > 0, 'Call to Glory on the chain');
  if (pend(g).player !== P0) g = pass(g);
  assert.equal(canPlayNow(g, P0, sac), false, 'Hero is 2: not Mighty');
  g = drive(g).g;
  assert.equal(mightOf(g, h), 5);
  assert.equal(canPlayNow(g, P0, sac), true, 'now Mighty');
});

test('RJ#11433 (MISMATCH-RJ) Attacking Stalwart Poro (2, Shield) gets no Shield (defenders only); Discipline +2 answered by Stupefy -1 → 3 Might: it kills my 1-damage Sprite (3) and dies to its 3', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); fundAll(g, P1, 12); tokens(g, 'Sprite');
  const sp = put(g, P0, 'unl-t07', BF_A); control(g, BF_A, P0);
  g.objects[sp].damage = 1; g.timestamp++;
  const po = put(g, P1, 'Stalwart Poro', 'base');
  g = move(g, P1, [po], BF_A);
  for (let i = 0; i < 8 && !(g.showdown?.isCombat && pend(g).player === P1 && !pend(g).inStep && !g.chain.length); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(g.showdown?.attacker, P1);
  assert.equal(mightOf(g, po), 2, 'no Shield while attacking');
  g = play(g, P1, hand(g, P1, 'Discipline'), { targets: [[po]] });
  if (pend(g).player !== P0) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Stupefy'), { targets: [[po]] });
  for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, po), 3, '2 -1 +2');
  g = drive(g, undefined, 60).g;
  assert.equal(zone(g, sp) === 'battlefield', false, 'Sprite died');
  assert.equal(zone(g, po), 'trash', 'Poro died too');
});

test('RJ#11432 Arachnoid Horror + an Ambush unit (Vi, Peacekeeper): the Horror\'s permission has no Reaction timing — not playable to a lone-enemy battlefield while a chain is open, only at normal timing', () => {
  let g = S0(); fundAll(g, P0, 12);
  put(g, P0, 'Arachnoid Horror', 'base');
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const vi = hand(g, P0, 'Vi, Peacekeeper');
  assert.ok(playDests(g, P0, vi).includes(BF_A), 'open main phase: allowed by the Horror');
  let h = S0({ tp: P1 }); fundAll(h, P0, 12); fundAll(h, P1, 12);
  put(h, P0, 'Arachnoid Horror', 'base');
  put(h, P1, 'V(2)', BF_A); control(h, BF_A, P1);
  const vi2 = hand(h, P0, 'Vi, Peacekeeper');
  h = play(h, P1, hand(h, P1, 'DrawR'));
  if (pend(h).player !== P0) h = pass(h);
  assert.ok(h.chain.length > 0 && pend(h).player === P0, 'P0 has priority over a chain');
  assert.ok(!playDests(h, P0, vi2).includes(BF_A), 'closed state: no Ambush timing there (no units of mine)');
});

test('RJ#11435 A Deceiver Reflection that becomes a copy of Harnessed Dragon doesn\'t fire "When you play me, kill an enemy unit" — it gains the text only after it was played', () => {
  let g = S0(); setLegend(g, P0, 'Deceiver'); tokens(g, 'Reflection');
  const hd = put(g, P0, 'Harnessed Dragon', 'base'); hand(g, P0, 'V(1)');
  const e = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  const before = new Set(Object.keys(g.objects));
  g = drive(move(g, P0, [hd], BF_A), gg => { const o = optionIds(gg); return o.includes(hd) ? [hd] : undefined; }, 60).g;
  const r = Object.keys(g.objects).find(id => !before.has(id) && g.objects[id].isToken && g.objects[id].zone === 'battlefield');
  assert.ok(r && mightOf(g, r) === 6, 'Reflection copied the Dragon');
  assert.equal(zone(g, e), 'battlefield', 'no kill');
});

test('RJ#11440 Responding to the opponent\'s Dark Child (Annie) end-of-turn rune ready with Rengar (unl-120) Ambushed to their battlefield: the trigger resolves first, then (state Neutral Open) the combat happens during that end of turn', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12);
  setLegend(g, P1, 'ogs-017-024');
  addRunes(g, P1, 2, 'calm', false);
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const r = hand(g, P0, 'unl-120-219');
  g = endTurn(g, P1);
  let played = false, chainAtPlay = 0;
  for (let i = 0; i < 40 && g.activePlayer === P1 && g.phase !== 'gameOver'; i++) {
    const d = pend(g);
    if (d.kind === 'mainAction') break;
    if (d.inStep) { g = act(g, legal(g, d.player)[0]); continue; }
    if (!played && d.player === P0 && g.chain.length > 0 && playDests(g, P0, r).includes(BF_A)) { chainAtPlay = g.chain.length; g = play(g, P0, r, { dest: BF_A }); played = true; continue; }
    g = pass(g);
  }
  assert.ok(played && chainAtPlay > 0, 'Rengar played in response to the Annie trigger');
  assert.ok(/Combat at BF-A/.test(logText(g)), `combat at the battlefield (${logText(g).split('\n').slice(-12).join(' / ')})`);
  assert.equal(zone(g, e), 'trash', 'the defender died in that end-of-turn combat');
});

test('RJ#11441 Bellows Breath + Repeat on the enemy Carrion Dredger in their base: both executions\' targets are chosen when it is played, so the Bird token from the Deathknell can\'t be hit by the second execution', () => {
  let g = S0(); fundAll(g, P0, 12); tokens(g, 'Bird');
  const cd = put(g, P1, 'Carrion Dredger', 'base');
  const before = new Set(Object.keys(g.objects));
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bellows Breath') });
  g = drive(g, gg => { const d = gg.pending!; if (d.kind === 'optional') return d.player === P0 ? ['yes'] : undefined; if (d.kind === 'chooseTargets' || d.kind === 'chooseCards') return d.options!.some(o => o.id === cd) ? [cd] : []; return undefined; }, 60).g;
  assert.equal(zone(g, cd), 'trash');
  const bird = Object.keys(g.objects).find(id => !before.has(id) && g.objects[id].isToken && g.objects[id].zone === 'base');
  assert.ok(bird, 'Bird token played to their base');
  assert.equal(g.objects[bird!].damage, 0, 'the second execution could not choose the Bird');
});

test('RJ#11454 Ornn, Forge God (Deflect 2) at a battlefield with Allay, Eager Admirer ("your other units here have Deflect"): Deflect adds up → Deflect 3', () => {
  const g = S0();
  const o = put(g, P0, 'sfd-085-221', BF_A); control(g, BF_A, P0);
  put(g, P0, 'unl-041-219', BF_A);
  assert.equal(kwValue(g, o, 'Deflect'), 3);
  const h = S0(); const o2 = put(h, P0, 'sfd-085-221', BF_A); control(h, BF_A, P0); put(h, P0, 'unl-041-219', 'base');
  assert.equal(kwValue(h, o2, 'Deflect'), 2, 'Allay in base grants nothing');
});

test('RJ#11459 Forbidding Waste (-2 defending alone) and the Wuju Bladesman legend (+2 defending alone) cancel out: my lone defender (damaged or not) has its printed Might', () => {
  let g = S0({ bfA: 'Forbidding Waste' }); setLegend(g, P1, 'ogs-019-024');
  const d0 = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g.objects[d0].damage = 1; g.timestamp++;
  const a = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [a], BF_A);
  let seen = -1;
  for (let i = 0; i < 12; i++) {
    const d = pend(g); if (d.kind === 'mainAction' || d.kind === 'assignDamage') break;
    if (g.showdown?.isCombat && !g.chain.length) { seen = mightOf(g, d0); break; }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.equal(seen, 3, '3 + 2 - 2');
});

test('RJ#11461 (OUTDATED) Dazzling Aurora plays a unit at end of turn while an enemy Vex, Apathetic is at a battlefield: it is stunned, but Stun ends in step 3d of that turn\'s end-of-turn cleanup (CR 1.5 424.1.a.2) — not stunned on the next turn', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'Dazzling Aurora', 'base');
  const u = put(g, P0, 'V(3)', 'deckTop');
  put(g, P1, 'unl-150-219', BF_A); control(g, BF_A, P1);
  g = endTurn(g, P0);
  let stunnedSeen = false;
  for (let i = 0; i < 30 && g.turn === 2 && g.phase !== 'gameOver'; i++) {
    const d = pend(g); if (d.kind === 'mainAction') break;
    if (g.objects[u].zone === 'base' && g.objects[u].stunned) stunnedSeen = true;
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  if (g.objects[u].zone === 'base' && g.objects[u].stunned && g.turn === 2) stunnedSeen = true;
  for (let i = 0; i < 20 && g.activePlayer === P0; i++) { const d = pend(g); g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g); }
  void stunnedSeen;
  assert.ok(/V\(3\) is stunned/.test(logText(g)), 'Aurora played it and Vex stunned it');
  assert.equal(locOf(g, u), 'base');
  assert.equal(g.activePlayer, P1, 'next turn');
  assert.ok(!g.objects[u].stunned, 'stun expired at the end of the turn it was applied');
});

test('RJ#11462 Cull the Weak ("Each player kills one of their units") killing my unit does not "choose a friendly unit" for Spirit Wheel — no draw offer', () => {
  let g = S0(); fundAll(g, P0, 12);
  put(g, P0, 'Spirit Wheel', 'base');
  const mine = put(g, P0, 'V(2)', 'base'); put(g, P0, 'V(3)', 'base');
  put(g, P1, 'V(2)', 'base');
  const h0 = g.players[P0].hand.length;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Cull the Weak') } as never);
  const r = drive(g, gg => { const o = optionIds(gg); if (gg.pending!.kind === 'optional') return ['no']; return o.includes(mine) ? [mine] : undefined; }, 40);
  g = r.g;
  assert.equal(zone(g, mine), 'trash');
  assert.ok(!r.seen.some(s => /Spirit Wheel|draw 1/i.test(s)), `no Spirit Wheel prompt (${r.seen.join(' | ')})`);
  assert.equal(g.players[P0].hand.length, h0, 'no draw');
});

test('RJ#11464 Lucian, Gunslinger + Warwick, Hunter attack together: I order the attack triggers so Lucian\'s Assault damage resolves first, then Warwick kills the damaged defender', () => {
  let { g, def } = attackSetup(['sfd-028-221', 'ogn-159-298'], ['V(12)']);
  const d0 = def[0];
  // the first trigger chosen goes on the chain first (resolves last): Warwick first, so Lucian resolves first
  for (let i = 0; i < 10 && pend(g).kind !== 'orderTriggers'; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  const w = pend(g).options!.find(o => /Warwick/.test(o.label ?? ''))!;
  g = act(g, { type: 'choose', player: P0, optionIds: [w.id] } as never);
  for (let i = 0; i < 20 && g.chain.length + (pend(g).inStep ? 1 : 0) > 0 && g.objects[d0].zone === 'battlefield'; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(logText(g).indexOf('Resolving Lucian') < logText(g).indexOf('Resolving Warwick'), 'Lucian first');
  assert.equal(zone(g, d0), 'trash', 'Lucian damaged the 12-Might defender, then Warwick killed it (before combat damage)');
  assert.ok(!/Effect deals \d+ to V\(12\)/.test(logText(g)), 'no combat damage was needed');
});

test('RJ#11470 Rengar, Trophy Hunter can\'t be played (as a Reaction or otherwise) to an open battlefield: no enemy units there for his Ambush, and units are only played to base / controlled battlefields', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const r = hand(g, P0, 'unl-120-219');
  g = play(g, P1, hand(g, P1, 'DrawR'));
  if (pend(g).player !== P0) g = pass(g);
  assert.ok(g.chain.length > 0 && pend(g).player === P0);
  const ds = playDests(g, P0, r);
  assert.ok(!ds.includes(BF_A) && !ds.includes(BF_B), `no open battlefield (${JSON.stringify(ds)})`);
});

test('RJ#11481 (MISMATCH-RJ, partial) Wages of Pain (3) on a 4-Might enemy at Forbidding Waste: not defending yet, so it survives the spell (RJ: 2 Might, dies to it); when I move in it becomes the lone defender and dies — a Zhonya\'s Hourglass revealed earlier (in response to Wages) saves it then', () => {
  let g = S0(); fundAll(g, P0, 12); setBattlefieldCard(g, BF_A, 'Forbidding Waste');
  const e = put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  const zh = put(g, P1, "Zhonya's Hourglass", 'base');   // as if revealed from Hidden while Wages was on the chain
  const a = put(g, P0, 'V(3)', 'base');
  g = drive(play(g, P0, hand(g, P0, 'Wages of Pain'), { targets: [[e]] }), gg => { const o = optionIds(gg); return o.includes(e) ? [e] : undefined; }).g;
  assert.equal(zone(g, e), 'battlefield', 'survives Wages of Pain (4 Might, 3 damage)');
  assert.equal(g.objects[e].damage, 3); assert.equal(mightOf(g, e), 4);
  assert.equal(zone(g, zh), 'base', 'Zhonya\'s not used yet');
  g = move(g, P0, [a], BF_A);
  g = drive(g, gg => gg.pending!.kind === 'optional' ? ['yes'] : undefined, 60).g;
  assert.equal(zone(g, zh), 'trash', 'Zhonya\'s replaced the death when it became the lone defender');
  assert.equal(locOf(g, e), 'base', 'healed, exhausted and recalled');
  assert.equal(g.objects[e].damage, 0);
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#11483 Exhausted Irelia, Fervent at base, En Garde on her + Blade Dancer readying her: +1 chosen, +1 readied, En Garde +1 (+1 more if she is my only unit there) → 8 alone, 7 with another unit at base', () => {
  for (const other of [false, true]) {
    let g = S0(); fundAll(g, P0, 12); setLegend(g, P0, 'Blade Dancer');
    const ir = put(g, P0, 'Irelia, Fervent', 'base', { ready: false });
    if (other) put(g, P0, 'V(1)', 'base');
    g = play(g, P0, hand(g, P0, 'En Garde'), { targets: [[ir]] });
    for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) { const d = pend(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g).includes(ir) ? ir : optionIds(g)[0]] }) : pass(g); }
    assert.equal(g.objects[ir].exhausted, false, 'readied by Blade Dancer');
    assert.equal(mightOf(g, ir), other ? 7 : 8);
  }
});

test('RJ#11485 Hand of Noxus (Darius legend: "[T]: [Reaction], [Legion] — [Add] [1]") helps pay Hard Bargain\'s [2] while it resolves: 1 rune + the legend\'s [1] → Cleave is not countered', () => {
  let g = S0(); fundAll(g, P1, 12);
  const l = setLegend(g, P0, 'ogn-253-298');
  setRunes(g, P0, 2, 'fury');
  const u = put(g, P0, 'V(2)', 'base');
  g = play(g, P0, hand(g, P0, 'Cleave'), { targets: [[u]] });
  for (let i = 0; i < 5 && !(pend(g).player === P1 && pend(g).kind === 'chainResponse'); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(readyRunes(g, P0), 1, 'one rune left after Cleave');
  g = play(g, P1, hand(g, P1, 'Hard Bargain'));
  let offered = false;
  for (let i = 0; i < 12 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.inStep && d.player === P1) { g = act(g, { type: 'choose', player: P1, optionIds: ['no'] } as never); continue; }   // no Repeat
    if (d.inStep && d.player === P0 && /Hard Bargain: pay/.test(d.prompt)) { offered = optionIds(g).includes('yes'); g = act(g, { type: 'choose', player: P0, optionIds: ['yes'] } as never); continue; }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.ok(offered, 'paying [2] was offered with 1 rune + the legend');
  assert.ok(/Resolving Cleave/.test(logText(g)), 'Cleave resolved');
  assert.equal(kwValue(g, u, 'Assault'), 3);
  assert.equal(g.objects[l].exhausted, true, 'the legend was used for the payment');
});

test('RJ#11486 Alpha Strike split among several chosen enemies: each must be dealt at least 1 (4 among two → 1..3 to the first, never 0)', () => {
  let g = S0(); fundAll(g, P0);
  const f = put(g, P0, 'V(4)', BF_A); control(g, BF_A, P0);
  const e1 = put(g, P1, 'V(5)', BF_B), e2 = put(g, P1, 'V(5)', BF_B); control(g, BF_B, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Alpha Strike') });
  let split: string[] | undefined;
  for (let i = 0; i < 12; i++) {
    const d = pend(g); if (d.kind === 'mainAction') break;
    if (!d.inStep) { g = pass(g); continue; }
    const ids = d.options!.map(o => o.id);
    if (ids.includes(f)) g = choose(g, f);
    else if (ids.includes(e1)) g = choose(g, e1, e2);
    else { if (d.kind === 'chooseNumber' && !split) split = ids; g = choose(g, ids[0]); }
  }
  assert.deepEqual(split, ['1', '2', '3'], 'no 0 option; at least 1 left for the other target');
  assert.ok(g.objects[e1].damage! >= 1 && g.objects[e2].damage! >= 1);
  assert.equal(g.objects[e1].damage! + g.objects[e2].damage!, 4);
});

test('RJ#11488 Buffed Fiora, Peerless (3 + 1 buff) defending one on one: doubling adds her current Might 4 → 8', () => {
  let g = S0();
  const f = put(g, P1, 'sfd-110-221', BF_A, { buff: true }); control(g, BF_A, P1);
  const a = put(g, P0, 'V(1)', 'base');
  assert.equal(mightOf(g, f), 4);
  g = move(g, P0, [a], BF_A);
  let seen = -1;
  for (let i = 0; i < 12 && seen < 0; i++) {
    const d = pend(g); if (d.kind === 'mainAction' || d.kind === 'assignDamage') break;
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
    if (!g.chain.length && g.showdown?.isCombat && logText(g).includes('Resolving Fiora')) seen = mightOf(g, f);
  }
  assert.equal(seen, 8);
});

test('RJ#11490 Shadow\'s Call whose chosen unit leaves the board in response (Gust): Temporary is not given, but "Draw 2" still happens', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const h0 = g.players[P0].hand.length;
  g = play(g, P0, hand(g, P0, "Shadow's Call"), { targets: [[u]] });
  for (let i = 0; i < 4 && !(pend(g).player === P1 && pend(g).kind === 'chainResponse'); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[u]] });
  g = drive(g).g;
  assert.equal(zone(g, u), 'hand');
  assert.equal(g.players[P0].hand.length, h0 + 1 + 2, 'the Gusted unit back in hand + 2 drawn');
});

test('RJ#11493 (MISMATCH-RJ, partial) My lone Lonely Poro dies to a spell: I may play my hidden Zhonya\'s Hourglass there in response to its Deathknell (control kept while it is pending), but it can\'t save the Poro; Zhonya\'s stays on the board (recalled to base — RJ: "then dies itself") and the Poro draws 1', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 4); fundAll(g, P1, 4);
  const po = put(g, P0, 'Lonely Poro', BF_A); control(g, BF_A, P0);
  const zh = put(g, P0, "Zhonya's Hourglass", { facedown: BF_A });
  const h0 = g.players[P0].hand.length;
  g = play(g, P1, hand(g, P1, 'KillA'), { targets: [[po]] });
  let played = false;
  for (let i = 0; i < 20; i++) {
    const d = pend(g); if (d.kind === 'mainAction') break;
    if (!played && d.player === P0 && !d.inStep && g.chain.length && zone(g, po) === 'trash') {
      assert.ok(canPlayNow(g, P0, zh), 'playable in response to the Deathknell');
      g = act(g, { type: 'playCard', player: P0, obj: zh } as never); played = true; continue;
    }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.ok(played);
  assert.equal(zone(g, po), 'trash', 'not saved');
  assert.equal(zone(g, zh), 'base', 'Zhonya\'s is on the board, unused');
  assert.equal(g.players[P0].hand.length, h0 + 1, 'Deathknell: died alone → draw 1');
});

test('RJ#11501 Opponent\'s Lucian, Gunslinger (2, Assault) moves into an empty battlefield; I play Rengar, Trophy Hunter there in response: no Assault during the non-combat showdown, +1 once the combat begins (he is the Attacker)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12);
  const r = hand(g, P0, 'Rengar, Trophy Hunter');
  const a = put(g, P1, 'sfd-028-221', 'base');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 8 && !(pend(g).player === P0 && !pend(g).inStep && canPlayNow(g, P0, r, BF_A)); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.showdown && !g.showdown.isCombat, 'non-combat showdown');
  assert.equal(mightOf(g, a), 2, 'no Assault outside combat');
  g = play(g, P0, r, { dest: BF_A });
  for (let i = 0; i < 8 && !g.showdown?.isCombat; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.showdown?.isCombat && g.showdown.attacker === P1, 'combat, Lucian attacking');
  assert.equal(mightOf(g, a), 3, 'Assault 1 applies in combat');
});

test('RJ#11502 Fiora, Peerless defends against two attackers; one is removed during the showdown (Star-Crossed / Gust): her "one on one" defend trigger is checked only when she becomes a Defender — it never triggers', () => {
  let g = S0(); fundAll(g, P1, 12);
  const f = put(g, P1, 'sfd-110-221', BF_A); control(g, BF_A, P1);
  const a1 = put(g, P0, 'V(1)', 'base'), a2 = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [a1, a2], BF_A);
  let gusted = false;
  for (let i = 0; i < 20 && pend(g).kind !== 'assignDamage' && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!gusted && d.player === P1 && !d.inStep && g.showdown?.isCombat && !g.chain.length) { g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[a2]] }); gusted = true; continue; }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.ok(gusted && zone(g, a2) === 'hand', 'one attacker removed');
  assert.ok(!/Resolving Fiora|Trigger: Fiora/.test(logText(g)), 'no Fiora trigger');
  assert.equal(mightOf(g, f), 3);
});

test('RJ#11503 (AMBIGUOUS, RJ adopted — CR 373.1) Both combatants would die at Altar of Blood: the two players\' replacement choices ("its controller may pay [A][A][A]…") are made in turn order — the turn player first', () => {
  let { g, atk, def } = attackSetup(['V(3)'], ['V(3)'], { bfA: 'Altar of Blood' });
  fundAll(g, P0, 6); fundAll(g, P1, 6);
  const order: number[] = [];
  for (let i = 0; i < 20; i++) {
    const d = pend(g); if (d.kind === 'mainAction') break;
    if (d.inStep && /Altar of Blood/.test(d.prompt)) order.push(d.player);
    g = d.inStep ? act(g, d.kind === 'optional' ? { type: 'choose', player: d.player, optionIds: ['yes'] } as never : legal(g, d.player)[0]) : pass(g);
  }
  assert.equal(locOf(g, atk[0]), 'base'); assert.equal(locOf(g, def[0]), 'base');
  assert.deepEqual(order, [P0, P1]);
});

test('RJ#11504 Enemy Mageseeker Warden at a battlefield ("opponents can only play units to their base"): my Deceiver conquer can\'t play its Reflection token to the conquered battlefield — no token', () => {
  let g = S0(); fundAll(g, P0); setLegend(g, P0, 'Deceiver'); tokens(g, 'Reflection');
  put(g, P1, 'Mageseeker Warden', BF_B); control(g, BF_B, P1);
  const x = put(g, P0, 'V(3)', 'base'); hand(g, P0, 'V(1)');
  const before = new Set(Object.keys(g.objects));
  g = drive(move(g, P0, [x], BF_A), undefined, 60).g;
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  assert.ok(!Object.keys(g.objects).some(id => !before.has(id) && g.objects[id].isToken && ['battlefield', 'base'].includes(g.objects[id].zone)), 'no Reflection played');
});

test('RJ#11507 Switcheroo between my defending Blue Sentinel (4 + Shield 2 = 6) and an equal 6-Might attacker: equal Mights — the swap changes nothing; each keeps its own Shield / sources', () => {
  let g = S0(); fundAll(g, P1, 12);
  const s = put(g, P1, 'Blue Sentinel', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(6)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 12 && !(g.showdown?.isCombat && pend(g).player === P1 && !pend(g).inStep && !g.chain.length); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, s), 6, 'Shield 2 while defending');
  g = play(g, P1, hand(g, P1, 'Switcheroo'), { targets: [[s, a]] });
  for (let i = 0; i < 10 && (g.chain.length || pend(g).inStep); i++) { const d = pend(g); if (d.inStep) { const o = optionIds(g); g = act(g, { type: 'choose', player: d.player, optionIds: o.includes(s) && o.includes(a) ? [s, a] : [o[0]] }); } else g = pass(g); }
  assert.ok(/Resolving Switcheroo/.test(logText(g)));
  assert.equal(mightOf(g, s), 6); assert.equal(mightOf(g, a), 6);
  assert.equal(kwValue(g, s, 'Shield'), 2, 'Shield stays with the Sentinel');
});

test('RJ#11508 Elder Dragon\'s "choose up to one enemy unit at each location" includes the enemy base: an enemy unit in their base may be chosen (and dies to the 1)', () => {
  let g = S0(); fundAll(g, P0, 12);
  const eb = put(g, P1, 'V(4)', 'base');
  const offered: string[][] = [];
  g = drive(play(g, P0, hand(g, P0, 'Elder Dragon')), gg => { const o = optionIds(gg); if (o.includes(eb)) { offered.push(o); return [eb]; } return undefined; }).g;
  assert.ok(offered.length > 0, 'the base unit was offered');
  assert.equal(zone(g, eb), 'trash');
});

test('RJ#11509 Hunt ("When I conquer or hold, gain XP") does not trigger when the unit dies: my Wuju Apprentice (Hunt) dies attacking, nobody conquers → no XP; conquering → +1 XP', () => {
  for (const big of [true, false]) {
    let g = S0();
    put(g, P1, big ? 'V(3)' : 'V(1)', BF_A); control(g, BF_A, P1);
    const w = put(g, P0, 'Wuju Apprentice', 'base');
    if (!big) put(g, P0, 'V(2)', 'base');
    const xs = Object.keys(g.objects).filter(id => g.objects[id].zone === 'base' && g.objects[id].owner === P0);
    const x0 = g.players[P0].xp ?? 0;
    g = drive(move(g, P0, xs, BF_A), undefined, 60).g;
    if (big) { assert.equal(zone(g, w), 'trash'); assert.equal(g.players[P0].xp ?? 0, x0, 'died: no Hunt'); }
    else { assert.equal(g.battlefields[BF_A].controller, P0); assert.equal(g.players[P0].xp ?? 0, x0 + 1, 'conquered: Hunt 1'); }
  }
});

test('RJ#11513 Ferrous Forerunner\'s Mech tokens already in base stay exhausted when Rek\'Sai, Breacher is played afterwards (Accelerate applies only as a unit is played)', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const ff = put(g, P0, 'Ferrous Forerunner', BF_A); control(g, BF_A, P0);
  const before = new Set(Object.keys(g.objects));
  g = drive(play(g, P0, hand(g, P0, 'KillA'), { targets: [[ff]] }), gg => { const o = optionIds(gg); return o.includes(ff) ? [ff] : undefined; }).g;
  const mechs = Object.keys(g.objects).filter(id => !before.has(id) && g.objects[id].isToken && g.objects[id].zone === 'base');
  assert.equal(mechs.length, 2);
  assert.ok(mechs.every(m => g.objects[m].exhausted), 'tokens enter exhausted');
  g = drive(play(g, P0, hand(g, P0, 'sfd-029-221')), gg => gg.pending!.kind === 'optional' ? ['no'] : undefined).g;
  assert.ok(mechs.every(m => g.objects[m].exhausted), 'still exhausted (no retroactive Accelerate)');
});

test('RJ#11516 Lucian, Merciless (Weaponmaster) with Shepherd\'s Heirloom in base: its Equip "Spend 1 XP" has no [A] to reduce — with 0 XP it can\'t be attached; with 1 XP it is (XP spent)', () => {
  for (const xp of [0, 1]) {
    let g = S0(); fundAll(g, P0, 12);
    g.players[P0].xp = xp; g.timestamp++;
    const sh = put(g, P0, "Shepherd's Heirloom", 'base');
    const lu = hand(g, P0, 'Lucian, Merciless');
    g = drive(play(g, P0, lu), gg => { const d = gg.pending!; if (d.kind === 'optional') return ['yes']; if (d.kind === 'chooseCards' || d.kind === 'chooseTargets') return d.options!.some(o => o.id === sh) ? [sh] : undefined; return undefined; }).g;
    if (xp === 0) assert.ok(!g.objects[sh].attachedTo, 'not attached without XP');
    else { assert.equal(g.objects[sh].attachedTo, lu, 'attached'); assert.equal(g.players[P0].xp, 0, 'XP spent'); }
  }
});

test('RJ#11525 Hidden Bone Skewer in response to the opponent\'s Challenge forces their unit onto my Sneaky Deckhand\'s battlefield: combat waits for the chain — Challenge resolves first (Deckhand 1 damage, Recruit dies), then combat starts', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const dh = put(g, P0, 'Sneaky Deckhand', BF_A); control(g, BF_A, P0);
  const bs = put(g, P0, 'Bone Skewer', { facedown: BF_A });
  const rec = put(g, P1, 'V(1)', 'base');
  const py = hand(g, P1, 'unl-145-219');
  g = play(g, P1, hand(g, P1, 'Challenge'), { targets: [[rec, dh]] });
  if (pend(g).player !== P0) g = pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: bs });
  let combatBeforeChallenge = false;
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (g.showdown?.isCombat && g.chain.some(c => g.objects[c.source] && g.cards[g.objects[c.source].cardId]?.name === 'Challenge')) combatBeforeChallenge = true;
    if (d.inStep) { const o = optionIds(g); g = choose(g, d.kind === 'optional' ? 'yes' : o.includes(py) ? py : o.includes(String(BF_A)) ? String(BF_A) : o.includes(g.battlefields[BF_A].objId) ? g.battlefields[BF_A].objId : o[0]); continue; }
    g = pass(g);
  }
  assert.ok(!combatBeforeChallenge, 'no combat while Challenge is on the chain');
  assert.equal(locOf(g, py), BF_A, 'Pyke was played to the Deckhand\'s battlefield');
  assert.equal(zone(g, rec), 'trash', 'the Recruit died to the Challenge');
  assert.equal(g.objects[dh].damage, 1, 'the Deckhand survived with 1 damage');
  assert.ok(g.showdown?.isCombat, 'combat begins after the chain');
});

test('RJ#11526 Hidden Hostile Takeover on an attacking Laurent Duelist (Assault 2): after the steal it becomes a defender and loses the Assault bonus (3, not 5)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const ht = put(g, P0, 'Hostile Takeover', { facedown: BF_A });
  const ld = put(g, P1, 'Laurent Duelist', 'base');
  g = move(g, P1, [ld], BF_A);
  for (let i = 0; i < 12 && !(g.showdown?.isCombat && pend(g).player === P0 && !pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, ld), 5, 'attacking: 3 + Assault 2');
  g = act(g, { type: 'playCard', player: P0, obj: ht });
  g = answer(g, { targets: [[ld]] });
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(g.objects[ld].controller, P0);
  assert.equal(g.objects[ld].combatRole, 'defender');
  assert.equal(mightOf(g, ld), 3, 'no Assault bonus as a defender');
});

test('RJ#11529 Void Assault may choose my unit that Vex, Apathetic stunned ("can\'t move it this turn"): that move does nothing, the enemy unit is still moved', () => {
  let g = S0(); fundAll(g, P0, 8);
  put(g, P1, 'Vex, Apathetic', BF_B); control(g, BF_B, P1);
  const f = hand(g, P0, 'V(2)');
  g = drive(play(g, P0, f)).g;
  assert.ok(g.objects[f].stunned, 'stunned by Vex');
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Void Assault') });
  let dests = 0;
  for (let i = 0; i < 8 && pend(g).inStep; i++) { const o = optionIds(g); g = choose(g, o.includes(f) ? f : o.includes(e) ? e : pend(g).kind === 'chooseDestination' ? (dests++ === 0 ? String(BF_A) : 'base') : o[0]); }
  g = resolveChain(g);
  assert.equal(locOf(g, f), 'base', 'my unit can\'t move');
  assert.equal(locOf(g, e), 'base', 'the enemy unit is still moved');
});

test('RJ#11535 Dazzling Aurora plays Rengar, Trophy Hunter to a battlefield with only enemy units: he applied Contested, so his controller is the Attacker (RJ\'s "he is the Defender" aside → MISMATCH-RJ, CR 466.2.c.1)', () => {
  let g = S0();
  put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  put(g, P0, 'Dazzling Aurora', 'base');
  const r = put(g, P0, 'Rengar, Trophy Hunter', 'deckTop');
  g = endTurn(g, P0);
  let attacker: number | undefined, role: string | undefined;
  for (let i = 0; i < 40 && !(pend(g).kind === 'mainAction' && pend(g).player === P1); i++) {
    if (g.showdown?.isCombat && attacker === undefined) { attacker = g.showdown.attacker; role = g.objects[r].combatRole; }
    const d = pend(g);
    if (d.inStep && d.player === P0 && d.kind === 'chooseDestination' && /Rengar/.test(d.prompt)) { g = act(g, { type: 'choose', player: P0, optionIds: [String(BF_B)] }); continue; }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.equal(attacker, P0, 'Rengar\'s controller attacks');
  assert.equal(role, 'attacker');
});

test('RJ#11540 Baited Hook looks at Nocturne, Horrifying and Trifarian Gloryseeker: the Hook\'s unit is played as the ability resolves and Nocturne only after it (DECISIONS #3918) — with nothing else finalized this turn, Gloryseeker\'s Legion is off (RJ "yes" → MISMATCH-RJ)', () => {
  let g = S0(); fundAll(g, P0, 8);
  const hook = put(g, P0, 'Baited Hook', 'base');
  const v = put(g, P0, 'V(2)', 'base');
  const gs = put(g, P0, 'Trifarian Gloryseeker', 'deckTop');
  const noc = put(g, P0, 'Nocturne, Horrifying', 'deckTop');
  g = activate(g, P0, hook, 0);
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    if (pend(g).inStep) { const o = optionIds(g); g = choose(g, o.includes(v) ? v : o.includes(gs) ? gs : o.includes('yes') ? 'yes' : o[0]); continue; }
    g = pass(g);
  }
  const t = g.log.map(l => l.text);
  assert.ok(t.findIndex(x => /plays Trifarian Gloryseeker/.test(x)) < t.findIndex(x => /plays Nocturne/.test(x)), 'Gloryseeker first');
  assert.equal(zone(g, noc), 'base'); assert.equal(zone(g, gs), 'base');
  assert.ok(!g.objects[gs].counters.buff, 'no Legion buff');
});

test('RJ#11548 Grand Duelist (Fiora legend) triggers when my unit becomes Mighty; the opponent\'s Stupefy in response drops it to 4 — the trigger still channels 1 rune (no re-check on resolution)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  setLegend(g, P0, 'Grand Duelist');
  const u = put(g, P0, 'V(3)', 'base');
  const runes0 = g.players[P0].runesInPlay.length;
  g = play(g, P0, hand(g, P0, 'Dragon Form'), { targets: [[u]] });
  let stupefied = false;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.inStep) { g = choose(g, d.kind === 'optional' ? 'yes' : optionIds(g).includes(u) ? u : optionIds(g)[0]); continue; }
    if (!stupefied && d.player === P1 && g.chain.some(c => /Grand Duelist/.test(g.cards[g.objects[c.source]?.cardId]?.name ?? ''))) { g = play(g, P1, hand(g, P1, 'Stupefy'), { targets: [[u]] }); stupefied = true; continue; }
    g = pass(g);
  }
  assert.ok(stupefied, 'Stupefy was played in response to the Grand Duelist trigger');
  assert.equal(mightOf(g, u), 4);
  assert.equal(g.players[P0].runesInPlay.length, runes0 + 1, 'channelled 1 rune');
});

test('RJ#11552 Azir, Ascendant\'s swap: only the friendly unit is chosen; "its location" / "my original location" are read on resolution — my unit moved to base in response (hidden Fight or Flight) → Azir goes to base, the unit to Azir\'s battlefield', () => {
  let g = S0(); fundAll(g, P0, 8);
  const az = put(g, P0, 'Azir, Ascendant', BF_B); control(g, BF_B, P0);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const fof = put(g, P0, 'Fight or Flight', { facedown: BF_A });
  g = activate(g, P0, az, 0);
  for (let i = 0; i < 4 && pend(g).inStep; i++) { const o = optionIds(g); g = choose(g, o.includes(u) ? u : o[0]); }
  assert.equal(g.chain.length, 1, 'Azir\'s ability on the chain');
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  if (!canPlayNow(g, P0, fof)) { g = pass(g); for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g); }
  g = act(g, { type: 'playCard', player: P0, obj: fof });
  for (let i = 0; i < 4 && pend(g).inStep; i++) { const o = optionIds(g); g = choose(g, o.includes(u) ? u : o[0]); }
  for (let i = 0; i < 12 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(locOf(g, az), 'base', 'Azir moved to the unit\'s current location');
  assert.equal(locOf(g, u), BF_B, 'the unit moved to Azir\'s original location');
});

test('RJ#11558 Piltover Enforcer legend: excess damage is pooled across attackers — 2 + 3 Might into one 2-Might defender = 3 excess → the legend readies a unit', () => {
  let g = S0(); const leg = setLegend(g, P0, 'Piltover Enforcer');
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(2)', 'base'), b = put(g, P0, 'V(3)', 'base');
  g = drive(move(g, P0, [a, b], BF_A), gg => gg.pending!.kind === 'optional' ? ['yes'] : optionIds(gg).includes(a) ? [a] : undefined, 60).g;
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  assert.equal(g.objects[leg].exhausted, true, 'legend used (3 excess)');
});

test('RJ#11565 Mirror Image while my Zilean, Time Mage is at a battlefield: Zilean doubles the Reflection — two ready tokens in base, both copies of the chosen unit with Temporary', () => {
  let g = S0(); fundAll(g, P0, 12); tokens(g, 'Reflection');
  put(g, P0, 'Zilean, Time Mage', BF_A); control(g, BF_A, P0);
  const x = put(g, P0, 'V(3)', 'base');
  const before = new Set(Object.keys(g.objects));
  g = drive(play(g, P0, hand(g, P0, 'Mirror Image'), { targets: [[x]] }), gg => { const d = gg.pending!; if (d.kind === 'optional') return ['yes']; return optionIds(gg).includes(x) ? [x] : undefined; }).g;
  const toks = Object.keys(g.objects).filter(id => !before.has(id) && g.objects[id].isToken && g.objects[id].zone === 'base');
  assert.equal(toks.length, 2, 'two Reflections');
  for (const t of toks) {
    assert.equal(g.objects[t].exhausted, false, 'ready');
    assert.equal(mightOf(g, t), 3, `copy of the V(3): ${toks.map(k => chars(g, k).name + "/" + mightOf(g, k))} ${logText(g).split("\n").slice(-12).join(" | ")}`);
    assert.ok(hasKeyword(g, t, 'Temporary'));
  }
});

test('RJ#11566 Yasuo, Remorseful (6) kills the lone defender with his attack trigger and conquers Trapping Grounds: no combat damage was assigned → no Bird token', () => {
  let g = S0(); setBattlefieldCard(g, BF_A, 'Trapping Grounds'); tokens(g, 'Bird');
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const y = put(g, P0, 'ogn-076-298', 'base');
  const before = new Set(Object.keys(g.objects));
  g = drive(move(g, P0, [y], BF_A), undefined, 60).g;
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  assert.ok(!Object.keys(g.objects).some(id => !before.has(id) && g.objects[id].isToken), 'no Bird');
});

test('RJ#11573 (house: RJ#299 kept) In response to my Faefolk\'s move trigger at an empty battlefield, Rengar, Pouncing ("a battlefield you\'re attacking") can only go to base — no combat yet, so I am not attacking it (RJ#11573 says yes → MISMATCH-RJ, DECISIONS #11573; verified RJ#299 agrees)', () => {
  let g = S0(); fundAll(g, P0, 12);
  const ff = put(g, P0, 'Irresistible Faefolk', 'base');
  const e = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  const rp = hand(g, P0, 'sfd-025-221');
  g = move(g, P0, [ff], BF_A);
  for (let i = 0; i < 6 && !(pend(g).player === P0 && !pend(g).inStep && chainLabels(g).some(l => /Faefolk/.test(l))); i++) { const d = pend(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g).includes(e) ? e : d.options![0].id] }) : pass(g); }
  assert.ok(chainLabels(g).some(l => /Faefolk/.test(l)), 'Faefolk trigger on the chain');
  assert.deepEqual(playDests(g, P0, rp), ['base'], 'base only');
});

test('RJ#11579 Temporary units: each triggers separately in its controller\'s Beginning Phase (two items, ordered by me); the opponent\'s Temporary unit does not trigger in my Beginning Phase (RJ\'s "both players\' triggers" aside → MISMATCH-RJ)', () => {
  let g = S0();
  const a = put(g, P1, 'Temp(2)', 'base'), b = put(g, P1, 'Temp(3)', 'base');
  const mine = put(g, P0, 'Temp(1)', 'base');
  g = endTurn(g, P0);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, optionIds(g)[0]);
  assert.equal(g.chain.length, 2, 'two separate Temporary items');
  assert.equal(zone(g, mine), 'base');
  g = passAll(g);
  assert.equal(zone(g, a), 'trash'); assert.equal(zone(g, b), 'trash');
  assert.equal(zone(g, mine), 'base', 'P0\'s Temporary unit waits for P0\'s own Beginning Phase');
});

test('RJ#11581 Dancing Grenade can bounce back and forth as long as each damaged unit\'s controller pays [A] and has a target: 2, then 3, then 4 damage', () => {
  let g = S0(); fundAll(g, P0, 6); fundAll(g, P1, 6);
  const f = put(g, P0, 'V(9)', 'base'), e = put(g, P1, 'V(9)', 'base');
  let replays = 0;
  g = play(g, P0, hand(g, P0, 'Dancing Grenade'), { targets: [[e]] });
  for (let i = 0; i < 60 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'optional') { const go = replays < 2; if (go) replays++; g = choose(g, go ? 'yes' : 'no'); continue; }
    if (d.inStep) { const o = optionIds(g); const want = d.player === P1 ? f : e; g = choose(g, o.includes(want) ? want : o[0]); continue; }
    g = pass(g);
  }
  assert.equal(replays, 2, 'replayed twice');
  assert.equal(g.objects[e].damage, 2 + 4, 'enemy: 2 then 4');
  assert.equal(g.objects[f].damage, 3, 'mine: 3');
});

test('RJ#11584 Defy ("no more than [4] and no more than [A]") can\'t choose Lilting Lullaby (printed [A][A])', () => {
  let g = S0(); fundAll(g, P0, 8); fundAll(g, P1, 8);
  const v = put(g, P1, 'V(3)', 'base');
  const st = hand(g, P0, 'Stupefy');
  g = play(g, P0, st, { targets: [[v]] });
  if (pend(g).player !== P1) g = pass(g);
  const ll = hand(g, P1, 'Lilting Lullaby');
  g = play(g, P1, ll, { targets: [[st]] });
  if (pend(g).player !== P0) g = pass(g);
  const df = hand(g, P0, 'Defy');
  const can = canPlayNow(g, P0, df);
  if (can) {
    const g2 = act(g, { type: 'playCard', player: P0, obj: df });
    assert.ok(!optionIds(g2).includes(ll), `Lullaby not a legal Defy target (${optionIds(g2)})`);
  }
});

test('RJ#11597 Stacked Deck with 2 cards left: look at both, put 1 in hand, recycle the other; with an empty Main Deck it is still playable and does nothing (no Burn Out, CR 432.1.c — RJ\'s "can\'t play it" aside → MISMATCH-RJ)', () => {
  let g = S0(); fundAll(g, P0);
  clearDeck(g, P0);
  const a = put(g, P0, 'V(1)', 'deckTop'), b = put(g, P0, 'V(2)', 'deckTop');
  g = drive(play(g, P0, hand(g, P0, 'Stacked Deck')), gg => optionIds(gg).includes(b) ? [b] : undefined).g;
  assert.ok(g.players[P0].hand.includes(b));
  assert.deepEqual(g.players[P0].mainDeck, [a], 'the other recycled');
  let h = S0(); fundAll(h, P0); clearDeck(h, P0);
  const sd = hand(h, P0, 'Stacked Deck');
  assert.ok(canPlayNow(h, P0, sd), 'playable with an empty Main Deck');
  const s0 = h.players[P1].points;
  h = drive(play(h, P0, sd)).g;
  assert.equal(zone(h, sd), 'trash');
  assert.equal(h.players[P1].points, s0, 'no Burn Out point for the opponent either way');
  assert.ok(!h.winner, 'game continues');
});

test('RJ#11599 Two hidden Hidden Blades on my unit wearing Guardian Angel: the first to resolve is replaced by the Angel (healed, recalled to base) — the second then mistargets ("a unit at a battlefield"), no second kill/draw (RJ\'s "a saved unit stays a valid target" exception → MISMATCH-RJ)', () => {
  let g = S0(); fundAll(g, P0, 8);
  const u = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const ga = put(g, P0, 'Guardian Angel', BF_A); attachNow(g, ga, u);
  const h1 = put(g, P0, 'Hidden Blade', { facedown: BF_A }), h2 = put(g, P0, 'Hidden Blade', { facedown: BF_A });
  const hand0 = g.players[P0].hand.length;
  g = act(g, { type: 'playCard', player: P0, obj: h1 });
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, optionIds(g).includes(u) ? u : optionIds(g)[0]);
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: h2 });
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, optionIds(g).includes(u) ? u : optionIds(g)[0]);
  assert.equal(g.chain.length, 2, 'both Hidden Blades on the chain');
  g = drive(g).g;
  assert.equal(zone(g, ga), 'trash', 'the Angel was killed instead');
  assert.equal(locOf(g, u), 'base', 'the unit survived in base');
  assert.equal(g.players[P0].hand.length, hand0 + 2, 'drew 2 once');
});

test('RJ#11607 Flame Chompers killed on the board is not "discarded": no "pay [C] to play me" offer, it stays in the trash', () => {
  let g = S0(); fundAll(g, P0, 8);
  const fc = put(g, P0, 'Flame Chompers', 'base');
  let offered = false;
  put(g, P0, 'V(1)', 'base');
  g = drive(play(g, P0, hand(g, P0, 'Deathgrip'), { targets: [[fc]] }), gg => { if (gg.pending!.kind === 'optional' && /Chompers/.test(gg.pending!.prompt)) offered = true; return undefined; }).g;
  assert.equal(zone(g, fc), 'trash');
  assert.ok(!offered, 'no discard trigger');
});

test('RJ#11608 Yasuo, Remorseful\'s attack trigger kills a defending Glasc Mixologist: its Deathknell resolves in the combat showdown, before combat damage (the unit it plays takes part in the damage step)', () => {
  let g = S0();
  const mx = put(g, P1, 'Glasc Mixologist', BF_A); put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const back = put(g, P1, 'V(2)', 'trash');
  const y = put(g, P0, 'ogn-076-298', 'base');
  g = move(g, P0, [y], BF_A);
  for (let i = 0; i < 60 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'assignDamage') { g = act(g, legal(g, d.player)[0]); continue; }
    if (d.inStep) { const o = optionIds(g); g = choose(g, d.kind === 'optional' ? 'yes' : o.includes(mx) ? mx : o.includes(back) ? back : o.includes(String(BF_A)) ? String(BF_A) : o[0]); continue; }
    g = pass(g);
  }
  const t = g.log.map(l => l.text);
  const played = t.findIndex(x => /P1 plays V\(2\) to BF-A/.test(x));
  const dmg = t.findIndex(x => /deals \d+ to Yasuo/.test(x));
  assert.equal(zone(g, mx), 'trash');
  assert.ok(played > 0 && dmg > played, 'the Deathknell unit arrived before combat damage');
  assert.ok(t.some(x => /deals .*\d+ to V\(2\)/.test(x)), 'it was dealt combat damage');
});

test('RJ#11622 Discipline\'s +2 "this turn" still applies when my Glowstone deals 5 to my units at end of turn: a 4-Might unit (6) survives; without it, it dies', () => {
  for (const disc of [true, false]) {
    let g = S0(); fundAll(g, P0);
    put(g, P0, 'Glowstone', 'base');
    const u = put(g, P0, 'V(4)', 'base');
    if (disc) g = drive(play(g, P0, hand(g, P0, 'Discipline'), { targets: [[u]] })).g;
    g = endTurn(g, P0);
    for (let i = 0; i < 30 && !(pend(g).kind === 'mainAction' && pend(g).player === P1); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
    assert.ok(/deals 5/.test(logText(g)), 'Glowstone dealt 5');
    assert.equal(zone(g, u), disc ? 'base' : 'trash', disc ? 'survived with +2' : 'died');
  }
});

test('RJ#11631 Blue Sentinel wearing Svellsongur holds: two "trigger an additional time" passives and two "When I hold" abilities → each hold ability triggers three times (6 Sentinel hold triggers)', () => {
  let g = S0({ tp: P1 });
  const bs = put(g, P0, 'Blue Sentinel', BF_A); control(g, BF_A, P0);
  const sv = put(g, P0, 'Svellsongur', BF_A); attachNow(g, sv, bs);
  const n = g.log.length;
  g = endTurn(g);
  for (let i = 0; i < 40; i++) { const d = g.pending!; if (d.kind === 'mainAction') break; g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : d.options![0].id) : pass(g); }
  const trig = g.log.slice(n).map(l => l.text).filter(t => /^Trigger:/.test(t) && /Blue Sentinel|Svellsongur/.test(t));
  assert.equal(trig.length, 6, `six hold triggers (${trig})`);
});

test('RJ#11640 Imperial Decree + the opponent\'s Unyielding Spirit: prevented spell damage means the unit never "takes damage" — no Decree kill (RJ: "even if the damage is blocked the trigger still fires" → MISMATCH-RJ; cf. RJ#10471)', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 8);
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  g = drive(play(g, P0, hand(g, P0, 'Imperial Decree'))).g;
  g = play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[e]] });
  if (pend(g).player !== P1) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Unyielding Spirit'));
  g = drive(g).g;
  assert.ok(/Resolving Hextech Ray/.test(logText(g)), 'Hextech Ray resolved');
  assert.equal(g.objects[e].damage, 0, 'damage prevented');
  assert.equal(zone(g, e), 'battlefield', 'not killed by the Decree');
});

test('RJ#11648 / RJ#11650 Fizz plays Bushwhack from the trash: not retroactive — Fizz (already on the board) stays exhausted; a unit played afterwards enters ready; the Gold enters exhausted', () => {
  const g0 = S0(); fundAll(g0, P0);
  tokens(g0, 'Gold');
  const bw = put(g0, P0, 'Bushwhack', 'trash');
  const fizz = hand(g0, P0, 'Fizz, Trickster');
  let g = passAll(play(g0, P0, fizz));
  g = answer(g, { targets: [[bw]], cards: [[bw]] }, P0);
  g = drive(g).g;
  assert.notEqual(zone(g, bw), 'trash', 'Bushwhack was played (then recycled)');
  assert.equal(zone(g, fizz), 'base');
  assert.equal(g.objects[fizz].exhausted, true, 'Fizz was already on the board: not readied');
  const gold = Object.values(g.objects).find(o => o.zone === 'base' && g.cards[o.cardId]?.name === 'Gold');
  assert.ok(gold, 'Gold token played');
  assert.equal(gold!.exhausted, true, 'Gold exhausted');
  const u = hand(g, P0, 'V(2)');
  g = drive(act(g, { type: 'playCard', player: P0, obj: u, destination: 'base' })).g;
  assert.equal(g.objects[u].exhausted, false, 'a unit entering later this turn enters ready');
});

test('RJ#11652 Azir, Ascendant swaps with a Pendulum Blade unit and takes the Blade: he moves first, then attaches — the Blade\'s "When I move to a battlefield" (+2) doesn\'t trigger for him (only its +1 applies)', () => {
  let g = S0(); fundAll(g, P0);
  control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_A);
  const az = put(g, P0, 'Azir, Ascendant', 'base');
  const u = put(g, P0, 'V(2)', BF_A);
  const pb = put(g, P0, 'Pendulum Blade', 'base'); attachNow(g, pb, u);
  const m0 = mightOf(g, az);
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === az)!);
  for (let i = 0; i < 16 && (g.chain.length || g.pending?.inStep); i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'optional') { g = yes(g); continue; }
    const ids = optionIds(g);
    g = ids.includes(u) ? choose(g, u) : ids.includes(pb) ? choose(g, pb) : act(g, legal(g, d.player)[0]);
  }
  assert.equal(locOf(g, az), BF_A); assert.equal(locOf(g, u), 'base');
  assert.equal(g.objects[pb].attachedTo, az, 'Blade taken');
  assert.equal(mightOf(g, az), m0 + 1, 'only the Blade\'s +1 equipment Might — no +2: it was attached after his move');
});

test('RJ#11659 Fiora, Peerless at negative Might attacking one on one: doubling adds 0 (no negative increase, CR 479.4.c) — -2 stays -2 (+5 later → 3)', () => {
  let g = S0(); fundAll(g, P0);
  const f = put(g, P0, 'sfd-110-221', 'base');
  mod(g, f, { might: -5 });
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [f], BF_A);
  assert.ok(chainLabels(g).some(l => /Fiora/.test(l)), `her trigger fires: ${chainLabels(g)}`);
  g = resolveChain(g);
  mod(g, f, { might: 5 });
  assert.equal(mightOf(g, f), 3, '3 - 5 + 0 (doubling) + 5; doubling -2 to -4 would give 1');
});

test('RJ#11661 a Defied spell still counts as "played another spell this turn" for Crumbling Sands (only play triggers ignore countered spells, DECISIONS #4138): the second spell can be countered', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', 'base');
  const st = hand(g, P0, 'Stupefy');
  g = play(g, P0, st, { targets: [[u]] });
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Defy'), { targets: [[st]] });
  g = drive(g).g;
  assert.equal(zone(g, st), 'trash', 'Stupefy countered');
  const cl = hand(g, P0, 'Cleave');
  g = play(g, P0, cl, { targets: [[u]] });
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  const cs = hand(g, P1, 'Crumbling Sands');
  assert.ok(canPlayNow(g, P1, cs), 'Crumbling Sands playable: the Defied Stupefy counts');
  g = play(g, P1, cs, { targets: [[cl]] });
  g = drive(g).g;
  assert.equal(hasKeyword(g, u, 'Assault'), false, 'Cleave countered');
});

test('RJ#11663 Siphoning Strike taken by Rebuttal: "if you control 7 or more runes" reads the NEW controller on resolution — the thief (≤6 runes) deals 4, though the caster has 12', () => {
  let g = S0(); fundAll(g, P0, 2); fundAll(g, P1, 1);
  const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const m = put(g, P0, 'V(9)', BF_B); control(g, BF_B, P0);
  const ss = hand(g, P0, 'Siphoning Strike');
  g = play(g, P0, ss, { targets: [[e]] });
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Rebuttal') });
  g = drive(g, x => { const d = x.pending!; const ids = (d.options ?? []).map(o => o.id); if (ids.includes(ss)) return [ss]; if (ids.includes(m)) return [m]; return undefined; }).g;
  assert.ok(g.players[P1].runesInPlay.length < 7, 'the thief controls fewer than 7 runes');
  assert.equal(g.objects[e].damage ?? 0, 0, 'retargeted away from the thief\'s unit');
  assert.equal(g.objects[m].damage, 4, '4, not 7');
});

test('RJ#11664 Rebuttal (paid, new choices) on a Rampage played without its optional [C]: the new controller can\'t pay it now, so no +2', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const a = put(g, P0, 'V(3)', 'base'); const b = put(g, P1, 'V(4)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Rampage') });
  const prompts: string[] = []; let rebutted = false;
  for (let i = 0; i < 30; i++) {
    const d = g.pending; if (!d || d.kind === 'mainAction') break;
    if (d.kind === 'chainResponse' && d.player === P1 && !rebutted) { g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Rebuttal') }); rebutted = true; continue; }
    if (d.inStep) {
      prompts.push(`P${d.player}:${d.prompt}`);
      const o = d.options!.map(x => x.id);
      g = act(g, { type: 'choose', player: d.player, optionIds: [d.player === P0 && o.includes('no') ? 'no' : o.includes('yes') ? 'yes' : o[0]] });
      continue;
    }
    g = act(g, { type: 'pass', player: d.player });
  }
  assert.ok(rebutted);
  assert.ok(!prompts.some(p => p.startsWith('P1:') && /additional cost|\[C\]/i.test(p)), `no additional-cost choice for the new controller (${prompts.join(' | ')})`);
  assert.equal(mightOf(g, b), 4, 'no +2 for the new controller\'s friendly unit');
  assert.equal(g.objects[b].damage, 3, 'Rampage still resolved under P1: mutual damage');
  assert.equal(zone(g, a), 'trash');
});

test('RJ#11667 Elder Dragon enters with my damage already on Irelia, Fervent: she dies, Guardian Angel recalls her, then the play trigger (chosen after) kills her in base', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1);
  const ir = put(g, P1, 'Irelia, Fervent', BF_A); control(g, BF_A, P1);
  const ga = put(g, P1, 'Guardian Angel', BF_A); attachNow(g, ga, ir);
  const dr = put(g, P0, 'Elder Dragon', 'hand');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'ZapR') });
  for (let i = 0; i < 30; i++) { const d = g.pending; if (!d || d.kind === 'mainAction') break; if (d.inStep) { const o = d.options!.map(x => x.id); g = act(g, { type: 'choose', player: d.player, optionIds: [o.includes(ir) ? ir : o[0]] }); continue; } g = act(g, { type: 'pass', player: d.player }); }
  assert.ok((g.objects[ir].damage ?? 0) > 0 && zone(g, ir) === 'battlefield', 'damaged, alive');
  g = act(g, { type: 'playCard', player: P0, obj: dr, destination: 'base' } as never);
  let chosenAtBase = false;
  for (let i = 0; i < 30; i++) {
    const d = g.pending; if (!d || d.kind === 'mainAction') break;
    if (d.inStep) {
      const o = d.options!.map(x => x.id);
      if (d.kind === 'chooseTargets' && o.includes(ir)) { assert.equal(locOf(g, ir), 'base', 'GA already recalled her'); assert.equal(zone(g, ga), 'trash'); chosenAtBase = true; }
      g = act(g, { type: 'choose', player: d.player, optionIds: d.kind === 'optional' ? ['yes'] : o.includes(ir) ? [ir] : [] });
      continue;
    }
    g = act(g, { type: 'pass', player: d.player });
  }
  assert.ok(chosenAtBase, 'Irelia chosen in her base');
  assert.equal(zone(g, ir), 'trash', 'dies to the 1 damage (any amount of my damage is lethal)');
});

test('RJ#11666 a Recruit token made a copy of Illaoi by Shady Spectacles is still a token unit: counted by both Illaoi abilities', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const t = put(g, P0, 'Recruit', 'base');
  const il = put(g, P0, 'Illaoi', 'base');
  const base = mightOf(g, il) - 1;              // +1 for the Recruit
  const sp = put(g, P0, 'Shady Spectacles', 'base');
  g = drive11(act(g, { type: 'activate', player: P0, obj: sp, abilityIndex: 900 }), [[t], [il]]);
  assert.equal(g.objects[sp].attachedTo, t);
  assert.equal(chars(g, t).name ?? g.cards[g.objects[t].cardId].name, 'Illaoi');
  assert.equal(mightOf(g, t), base + 1, 'the copy counts itself as a token unit');
  assert.equal(mightOf(g, il), base + 1, 'the real Illaoi still counts it');
  assert.ok(g.objects[t].isToken, 'still a token (CR 185.1.a)');
});

test('RJ#11669 Astral Heron\'s discount isn\'t used by hiding a card (hiding is not playing): the hide still costs [A], the next played card is discounted', () => {
  let g = S0(); fundAll(g, P0, 10);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const h = hand(g, P0, 'Astral Heron');
  const n = hand(g, P0, 'V(3)');
  const hid = put(g, P0, 'HidU(2)', 'hand');
  g = drive11(act(g, { type: 'playCard', player: P0, obj: h, destination: BF_A }));
  assert.equal(locOf(g, h), BF_A);
  const runes = g.players[P0].runesInPlay.length;
  g = drive11(act(g, { type: 'hide', player: P0, obj: hid, battlefieldIndex: BF_A } as never));
  assert.equal(zone(g, hid), 'facedown');
  assert.equal(g.players[P0].runesInPlay.length, runes - 1, 'the hide cost [A] was paid (a rune recycled)');
  assert.equal(playCostOf(g, P0, n)!.energy, 1, 'discount still waiting for the next played card (3 - 2)');
});

test('RJ#11673 Temporal Breach on a unit at Rockfall Path ("Units can\'t be played here"): banished, the replay can\'t happen — it stays banished', () => {
  let g = S0({ bfA: 'Rockfall Path' }); fundAll(g, P0);
  const u = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  g = drive11(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Temporal Breach') }), [[u]], x => x.pending?.kind === 'mainAction');
  assert.equal(unitsNamed11(g, 'V(3)').length, 0, 'not on the board');
  assert.ok(Object.values(g.objects).some(o => o.zone === 'banishment' && g.cards[o.cardId]?.name === 'V(3)'), 'in banishment');
});

test('RJ#11675 Alpha Strike on Akali, Silent; Resonating Strike in response moves her (+2, and her own +2): the damage is her Might on resolution — 8, split 4/4 kills both', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1);
  const ak = put(g, P0, 'Akali, Silent', 'base'); put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const e1 = put(g, P1, 'V(4)', BF_B); const e2 = put(g, P1, 'V(4)', BF_B); control(g, BF_B, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Alpha Strike') });
  let rs = false; let total = 0;
  for (let i = 0; i < 40; i++) {
    const d = g.pending; if (!d || d.kind === 'mainAction') break;
    if (d.kind === 'chainResponse' && d.player === P0 && !rs) { rs = true; g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Resonating Strike') }); continue; }
    if (d.inStep) {
      const o = d.options!.map(x => x.id);
      if (d.kind === 'chooseNumber') { const m = /\((\d+) left\)/.exec(d.prompt ?? ''); if (m) total = Number(m[1]); g = act(g, { type: 'choose', player: d.player, optionIds: ['4'] }); continue; }
      g = act(g, { type: 'choose', player: d.player, optionIds: o.includes(e1) ? [e1, e2] : o.includes(ak) ? [ak] : o.includes(String(BF_A)) ? [String(BF_A)] : [o[0]] });
      continue;
    }
    g = act(g, { type: 'pass', player: d.player });
  }
  assert.ok(rs);
  assert.equal(locOf(g, ak), BF_A);
  assert.equal(mightOf(g, ak), 8, '4 + 2 (Resonating Strike) + 2 (her move trigger)');
  assert.equal(total, 8, 'Alpha Strike splits 8');
  assert.equal(zone(g, e1), 'trash'); assert.equal(zone(g, e2), 'trash');
});

test('RJ#11683 a second Astral Heron played (first card) to Star Spring where a Heron already is: both Herons trigger, Star Spring may move the old one; two discounts on the next card', () => {
  let g = S0(); fundAll(g, P0, 12);
  setBattlefieldCard(g, BF_A, 'Star Spring');
  const h1 = put(g, P0, 'Astral Heron', BF_A); control(g, BF_A, P0);
  const h2 = hand(g, P0, 'Astral Heron');
  const n = hand(g, P0, 'V(4)');
  g = act(g, { type: 'playCard', player: P0, obj: h2, destination: BF_A });
  let heronTriggers = 0;
  for (let i = 0; i < 40; i++) {
    const d = g.pending; if (!d || d.kind === 'mainAction') break;
    if (d.inStep) {
      const o = d.options!.map(x => x.id);
      if (d.kind === 'orderTriggers') heronTriggers = Math.max(heronTriggers, d.options!.filter(x => /Astral Heron/.test(x.label)).length);
      g = act(g, { type: 'choose', player: d.player, optionIds: o.includes(h1) ? [h1] : d.kind === 'optional' ? ['yes'] : [o[0]] });
      continue;
    }
    g = act(g, { type: 'pass', player: d.player });
  }
  assert.equal(g.log.filter(l => /^Trigger: Astral Heron/.test(l.text)).length, 2, `both Herons triggered (order prompt showed ${heronTriggers})`);
  assert.equal(locOf(g, h1), 'base', 'Star Spring moved the old Heron');
  assert.equal(playCostOf(g, P0, n)!.energy, 0, '4 - 2 - 2');
});

test('RJ#11687 Lonely Poro alone in base killed by Baited Hook: it died alone (checked at death), the hooked unit is played, and the Poro\'s Deathknell still draws', () => {
  let g = S0(); fundAll(g, P0);
  const bh = put(g, P0, 'Baited Hook', 'base');
  const poro = put(g, P0, 'Lonely Poro', 'base');
  const top = put(g, P0, 'V(2)', 'deckTop');
  const h0 = g.players[P0].hand.length;
  g = act(g, { type: 'activate', player: P0, obj: bh, abilityIndex: 0 });
  for (let i = 0; i < 40; i++) {
    const d = g.pending; if (!d || d.kind === 'mainAction') break;
    if (d.inStep) { const o = d.options!.map(x => x.id); g = act(g, { type: 'choose', player: d.player, optionIds: o.includes(poro) ? [poro] : o.includes(top) ? [top] : d.kind === 'optional' ? ['yes'] : [o[0]] }); continue; }
    g = act(g, { type: 'pass', player: d.player });
  }
  assert.equal(zone(g, poro), 'trash');
  assert.ok(['base', 'battlefield'].includes(zone(g, top)), `hooked unit played (${zone(g, top)})`);
  assert.equal(g.players[P0].hand.length, h0 + 1, 'Deathknell drew 1');
});

test('RJ#11692 / RJ#11693 Applied Researchers (Empowered: spells cost [1][A] less) also reduces a Flow cost: Public Execution from the trash [5][A][A] → [4][A]', () => {
  const g = S0(); fundAll(g, P0);
  const pe = put(g, P0, 'Public Execution', 'trash');
  assert.deepEqual([playCostOf(g, P0, pe)!.energy, playCostOf(g, P0, pe)!.power.length], [5, 2], 'Flow cost without the reduction');
  const ar = put(g, P0, 'Applied Researchers', 'base'); g.objects[ar].empowered = 3; g.timestamp++;
  assert.deepEqual([playCostOf(g, P0, pe)!.energy, playCostOf(g, P0, pe)!.power.length], [4, 1], 'reduced Flow cost');
});

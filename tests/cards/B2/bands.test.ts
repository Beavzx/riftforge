// SCRIPT-FIX: Equipment bands (data/cards.json `attachedText`, the printed bottom band = what the equipped unit has while
// the Equipment is attached). One test per band; batch-B2.ts BAND.
import { test } from 'node:test';
import {
  game, mana, run, play, playNew, activate, put, handCard, zoneOf, assert, expectDecision, setController, canMove, handSize, m,
  act, EQUIP, attachNow, hasKw, kwVal, real, setBattlefieldCard,
} from './util.ts';
import { attachNow as attachWithEvents, setXp, touch } from '../../../src/engine/testkit.ts';
import { detach, moveUnits } from '../../../src/engine/actions.ts';
import { chars } from '../../../src/engine/chars.ts';
import { moveToZone } from '../../../src/engine/state.ts';
import type { GameState, ObjId } from '../../../src/engine/types.ts';

const endTurn = (g: GameState, ...answers: string[]) => run(act(g, { type: 'endTurn', player: g.pending!.player }), ...answers);
const move = (g: GameState, units: ObjId[], to: number | 'base', ...answers: string[]) => run(act(g, { type: 'move', player: 0, units, to }), ...answers);

test('every Equipment with a printed band has a band ability (section effect) except Shady Spectacles (reminder only)', async () => {
  const { getScript } = await import('../../../src/cards/registry.ts');
  const withBand = Object.values(real).filter(d => d.attachedText !== undefined);
  assert.equal(withBand.length, 34);
  for (const d of withBand) {
    const s = getScript(d.id)!;
    assert.ok(s, `${d.name} has a script`);
    const n = s.abilities.filter(a => a.section === 'effect').length;
    if (d.id === 'ven-137-166') continue;           // Shady Spectacles: "(I am a copy of the chosen unit.)" — its rules text does it
    assert.ok(n > 0, `${d.name} (${d.id}): band "${d.attachedText}" has no effect-section ability`);
  }
});

// ---------------------------------------------------------------------------------------------
// keyword bands
// ---------------------------------------------------------------------------------------------
const KW: [string, string, number][] = [
  ['rad-071-167', 'Shield', 2], ['sfd-064-221', 'Shield', 2], ['rad-123-167', 'Tank', 1], ['sfd-033-221', 'Tank', 1],
  ['rad-150-167', 'Ganking', 1], ['sfd-133-221', 'Ganking', 1], ['sfd-009-221', 'Assault', 2], ['sfd-102-221', 'Deflect', 1],
  ['unl-096-219', 'Hunt', 1],
];
for (const [id, kw, n] of KW) {
  test(`${real[id].name} (${id}): the equipped unit has [${kw}${n > 1 ? ` ${n}` : ''}] only while it is attached`, () => {
    const g = game();
    const u = put(g, 0, 't-u2', 'base');
    const eq = put(g, 0, id, 'base');
    assert.ok(!hasKw(g, u, kw));
    attachNow(g, eq, u);
    assert.ok(hasKw(g, u, kw), `${kw} on the equipped unit`);
    assert.equal(kwVal(g, u, kw), n);
    assert.ok(!hasKw(g, eq, kw), 'the Equipment itself does not have it');
    detach(g, eq); touch(g);
    assert.ok(!hasKw(g, u, kw), 'gone once detached');
  });
}

test('Nazuman Ntofo: Shield 2 gives the equipped defender +2', () => {
  let g = game();
  setController(g, 0, 0);
  const d = put(g, 0, 't-u2', 0);
  attachNow(g, put(g, 0, 'rad-071-167', 'base'), d);
  g = endTurn(g);
  const a = put(g, 1, 't-u3', 'base');
  g = run(act(g, { type: 'move', player: 1, units: [a], to: 0 }));
  assert.equal(zoneOf(g, a), 'trash', '2 Might + Shield 2 = 4 kills the 3-Might attacker');
  assert.equal(zoneOf(g, d), 'battlefield', 'and survives its 3 damage');
});

test("Hunter's Machete: [Hunt] — the equipped unit gains 1 XP when it conquers", () => {
  let g = game();
  const u = put(g, 0, 't-u2', 'base');
  attachNow(g, put(g, 0, 'unl-096-219', 'base'), u);
  g = move(g, [u], 0);
  assert.equal(g.battlefields[0].controller, 0);
  assert.equal(g.players[0].xp, 1);
});

test('Boots of Swiftness: [Ganking] lets the equipped unit move battlefield to battlefield', () => {
  const g = game();
  const u = put(g, 0, 't-u2', 0);
  assert.ok(!canMove(g, 0, u, 1));
  attachNow(g, put(g, 0, 'sfd-133-221', 'base'), u);
  assert.ok(canMove(g, 0, u, 1));
});

// ---------------------------------------------------------------------------------------------
// triggered / static bands
// ---------------------------------------------------------------------------------------------
test('Pendulum Blade: when the equipped unit moves to a battlefield it gets +2 this turn (not when it moves to base)', () => {
  let g = game();
  const u = put(g, 0, 't-u2', 'base');
  attachNow(g, put(g, 0, 'ven-011-166', 'base'), u);
  assert.equal(m(g, u), 3);
  g = move(g, [u], 0);
  assert.equal(m(g, u), 5);
});

test('Hand Hammer: +2 while at a battlefield with exactly one other unit you control', () => {
  const g = game();
  const u = put(g, 0, 't-u2', 0);
  attachNow(g, put(g, 0, 'ven-027-166', 'base'), u);
  assert.equal(m(g, u), 3, 'alone: 2 + 1');
  const o1 = put(g, 0, 't-u1', 0); touch(g);
  put(g, 1, 't-u1', 0); touch(g);                    // enemy units don't count
  assert.equal(m(g, u), 5, 'exactly one other friendly unit there');
  put(g, 0, 't-u1', 0); touch(g);
  assert.equal(m(g, u), 3, 'two other friendly units');
  void o1;
});

test("Jagged Cutlass: the equipped unit can't be moved by an opponent's spells and abilities (its controller's still can)", () => {
  const g = game();
  const u = put(g, 0, 't-u2', 0);
  attachNow(g, put(g, 0, 'ven-073-166', 'base'), u);
  assert.deepEqual(moveUnits(g, [u], 'base', 'effect', 1), [], 'an enemy effect does not move it');
  assert.equal(g.objects[u].battlefieldIndex, 0);
  assert.deepEqual(moveUnits(g, [u], 'base', 'effect', 0), [u], 'a friendly effect does');
});

test('Blighted Battleaxe: at the end of your turn, if the unit did not conquer, unattach it and deal 4 to the unit', () => {
  let g = game();
  const u = put(g, 0, 't-u3', 'base');
  const ax = put(g, 0, 'unl-019-219', 'base');
  attachNow(g, ax, u);
  assert.equal(m(g, u), 7);
  g = endTurn(g);
  assert.equal(g.objects[ax].attachedTo, undefined, 'unattached');
  assert.equal(zoneOf(g, u), 'trash', '3-Might unit takes 4');
  assert.equal(zoneOf(g, ax), 'base');
});

test('Blighted Battleaxe: nothing happens if the unit conquered this turn (even before it was equipped)', () => {
  let g = game();
  const u = put(g, 0, 't-u3', 'base');
  const ax = handCard(g, 0, 'unl-019-219');          // in hand while the unit conquers (hidden deck cards can't observe it)
  g = move(g, [u], 0);
  assert.equal(g.battlefields[0].controller, 0);
  moveToZone(g, ax, 'base'); touch(g);
  attachNow(g, ax, u);
  g = endTurn(g);
  assert.equal(g.objects[ax].attachedTo, u);
  assert.equal(zoneOf(g, u), 'battlefield');
  assert.equal(g.objects[u].damage, 0);
});

test('Soul Sword: [Level 3] — the equipped unit has an additional +1 while you have 3+ XP', () => {
  const g = game();
  const u = put(g, 0, 't-u2', 'base');
  attachNow(g, put(g, 0, 'unl-039-219', 'base'), u);
  assert.equal(m(g, u), 3);
  setXp(g, 0, 3); touch(g);
  assert.equal(m(g, u), 4);
});

test('Hextech Gauntlets: when the equipped unit conquers after assigning 3+ excess damage, draw 1 (not with less)', () => {
  for (const [enemy, draws] of [['t-u1', 1], ['t-u5', 0]] as const) {
    let g = game();
    setController(g, 1, 1);
    put(g, 1, enemy, 1);
    const u = put(g, 0, 't-u3', 'base');
    attachNow(g, put(g, 0, 'unl-188-219', 'base'), u);   // 3 + 3 = 6 Might
    const before = handSize(g, 0);
    g = move(g, [u], 1);
    assert.equal(g.battlefields[1].controller, 0, 'conquered');
    assert.equal(handSize(g, 0), before + draws, `${enemy}: excess ${enemy === 't-u1' ? 5 : 1}`);
  }
});

test('Hextech Gauntlets: conquering an empty battlefield (no combat) does not draw', () => {
  let g = game();
  const u = put(g, 0, 't-u3', 'base');
  attachNow(g, put(g, 0, 'unl-188-219', 'base'), u);
  const before = handSize(g, 0);
  g = move(g, [u], 0);
  assert.equal(g.battlefields[0].controller, 0);
  assert.equal(handSize(g, 0), before);
});

test('Recurve Bow: when the equipped unit attacks, deal 2 to an enemy unit here (chosen as the trigger goes on the chain)', () => {
  let g = game();
  setController(g, 1, 1);
  const a = put(g, 1, 't-u2', 1), b = put(g, 1, 't-u5', 1);
  const u = put(g, 0, 't-u4', 'base');
  attachNow(g, put(g, 0, 'sfd-016-221', 'base'), u);
  g = act(g, { type: 'move', player: 0, units: [u], to: 1 });
  assert.deepEqual(expectDecision(g, 'chooseTargets', 0).sort(), [a, b].sort());
  g = run(g, a);
  assert.equal(zoneOf(g, a), 'trash', 'the 2-Might unit dies to the Bow');
});

test('Recurve Bow: also when the equipped unit defends', () => {
  let g = game();
  setController(g, 0, 0);
  const u = put(g, 0, 't-u2', 0);
  attachNow(g, put(g, 0, 'sfd-016-221', 'base'), u);
  g = endTurn(g);
  const x = put(g, 1, 't-u2', 'base');
  g = run(act(g, { type: 'move', player: 1, units: [x], to: 0 }));
  assert.equal(zoneOf(g, x), 'trash', 'the attacker took 2 from the Bow (only one enemy: auto-chosen)');
  assert.equal(zoneOf(g, u), 'battlefield');
});

test('Forgefire Cape: when the equipped unit attacks, deal 2 to all enemy units here', () => {
  let g = game();
  setController(g, 1, 1);
  const a = put(g, 1, 't-u1', 1), b = put(g, 1, 't-u2', 1);
  const u = put(g, 0, 't-u1', 'base');
  attachNow(g, put(g, 0, 'sfd-190-221', 'base'), u);
  g = move(g, [u], 1);
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(zoneOf(g, b), 'trash');
  assert.equal(g.battlefields[1].controller, 0);
});

test('Skyfall of Areion: the equipped unit\'s hold effects are also conquer effects (Trinity Force scores on a conquest)', () => {
  for (const withSkyfall of [false, true]) {
    let g = game();
    const u = put(g, 0, 't-u2', 'base');
    attachNow(g, put(g, 0, 'sfd-115-221', 'base'), u);             // Trinity Force: "When I hold, score 1 point."
    if (withSkyfall) attachNow(g, put(g, 0, 'sfd-030-221', 'base'), u);
    const p0 = g.players[0].points;
    g = move(g, [u], 0);
    assert.equal(g.players[0].points, p0 + 1 + (withSkyfall ? 1 : 0), withSkyfall ? 'conquer point + Trinity Force' : 'conquer point only');
  }
});

test('Skyfall of Areion: ... and vice versa (Warmog\'s Armor buffs on a hold); "conquer or hold" effects trigger once', () => {
  let g = game();
  setController(g, 0, 0);
  const u = put(g, 0, 't-u2', 0);
  attachNow(g, put(g, 0, 'sfd-108-221', 'base'), u);             // Warmog's: "When I conquer, buff me."
  attachNow(g, put(g, 0, 'sfd-030-221', 'base'), u);
  attachNow(g, put(g, 0, 'unl-096-219', 'base'), u);             // Hunter's Machete: Hunt (conquer or hold)
  g = endTurn(g);
  g = endTurn(g);                                                 // back to player 0: hold at the start of the turn
  assert.equal(g.objects[u].counters.buff, 1, 'Warmog\'s conquer effect triggered on the hold');
  assert.equal(g.players[0].xp, 1, 'Hunt gave 1 XP, not 2');
});

test("Reckoner's Arena activates the equipped unit's Equipment conquer effects (Warmog's Armor) when you hold there (RJ#1341)", () => {
  let g = game();
  setBattlefieldCard(g, 0, 'ogn-286-298');
  setController(g, 0, 0);
  const u = put(g, 0, 't-u2', 0);
  attachNow(g, put(g, 0, 'sfd-108-221', 'base'), u);          // Warmog's: "When I conquer, buff me."
  g = endTurn(g); g = endTurn(g);
  assert.equal(g.objects[u].counters.buff, 1);
});

test('Brutalizer: +2 more while it was attached to the unit this turn; ends next turn and when detached', () => {
  let g = game();
  mana(g, 0, 0, 'Calm');
  const u = put(g, 0, 't-u2', 'base');
  const br = put(g, 0, 'sfd-042-221', 'base');
  g = run(activate(g, 0, br, EQUIP));
  assert.equal(g.objects[br].attachedTo, u);
  assert.equal(m(g, u), 2 + 1 + 2);
  g = endTurn(g); g = endTurn(g);
  assert.equal(m(g, u), 2 + 1, 'not attached this turn');
  // re-attach this turn, then detach: the +2 goes with it
  const h = put(g, 0, 'ts-sword', 'base'); void h;
  detach(g, br); touch(g);
  assert.equal(m(g, u), 2);
  attachWithEvents(g, br, u);
  assert.equal(m(g, u), 5);
  detach(g, br); touch(g);
  assert.equal(m(g, u), 2);
});

test('Guardian Angel: if the equipped unit would die, kill Guardian Angel instead; heal, exhaust and recall the unit', () => {
  let g = game();
  mana(g, 0, 1);
  const u = put(g, 0, 't-u2', 0);
  const ga = put(g, 0, 'sfd-051-221', 'base');
  attachNow(g, ga, u);
  [g] = playNew(g, 0, 'ts-bolt');
  g = run(g);
  assert.equal(zoneOf(g, u), 'base', 'recalled');
  assert.equal(g.objects[u].damage, 0, 'healed');
  assert.equal(g.objects[u].exhausted, true, 'exhausted');
  assert.equal(zoneOf(g, ga), 'trash', 'Guardian Angel died instead');
});

test('Experimental Hexplate: the equipped unit is a Mech', () => {
  const g = game();
  const u = put(g, 0, 't-u2', 'base');
  const hp = put(g, 0, 'sfd-073-221', 'base');
  assert.ok(!chars(g, u).tags.includes('Mech'));
  attachNow(g, hp, u);
  assert.ok(chars(g, u).tags.includes('Mech'));
});

test('World Atlas: when the equipped unit holds, play two Gold gear tokens exhausted', () => {
  let g = game();
  setController(g, 0, 0);
  const u = put(g, 0, 't-u2', 0);
  attachNow(g, put(g, 0, 'sfd-086-221', 'base'), u);
  g = endTurn(g); g = endTurn(g);
  const gold = g.players[0].base.filter(id => g.objects[id].cardId === 'unl-t05');
  assert.equal(gold.length, 2);
  assert.ok(gold.every(id => g.objects[id].exhausted));
});

test('The Zero Drive: Deathknell — Banish me; the unit is "banished with" the Zero Drive, which can play it back', () => {
  let g = game();
  mana(g, 0, 1);
  const u = put(g, 0, 't-u2', 0);
  const zd = put(g, 0, 'sfd-090-221', 'base');
  attachNow(g, zd, u);
  g.objects[u].damage = 5; touch(g);
  [g] = playNew(g, 0, 'ts-pump');            // any action: cleanup kills the unit
  g = run(g);
  assert.equal(zoneOf(g, u), 'banishment', 'banished from the trash');
  assert.equal(g.ex.links[u]?.by, zd, 'linked to the Zero Drive');
  assert.equal(g.objects[zd].attachedTo, undefined);
  mana(g, 0, 3, 'Mind');
  const before = g.players[0].base.length;
  g = run(activate(g, 0, zd, 0));
  assert.equal(zoneOf(g, u), 'base', 'played back ignoring its cost');
  assert.equal(zoneOf(g, zd), 'banishment');
  assert.ok(g.players[0].base.length >= before - 1);
});

test('Warmog\'s Armor / Boneshiver / Doran\'s Ring / Cull: conquer bands of the equipped unit', () => {
  // Warmog's: buff me
  let g = game();
  let u = put(g, 0, 't-u2', 'base');
  attachNow(g, put(g, 0, 'sfd-108-221', 'base'), u);
  g = move(g, [u], 0);
  assert.equal(g.objects[u].counters.buff, 1);
  // Boneshiver: channel 1 rune exhausted
  g = game();
  u = put(g, 0, 't-u2', 'base');
  attachNow(g, put(g, 0, 'sfd-118-221', 'base'), u);
  const runesBefore = g.players[0].runesInPlay.length;
  g = move(g, [u], 0);
  assert.equal(g.players[0].runesInPlay.length, runesBefore + 1);
  assert.ok(g.objects[g.players[0].runesInPlay.at(-1)!].exhausted);
  // Doran's Ring: discard 1, then draw 1
  g = game();
  u = put(g, 0, 't-u2', 'base');
  const junk = handCard(g, 0, 't-u1');
  attachNow(g, put(g, 0, 'sfd-124-221', 'base'), u);
  g = move(g, [u], 0);
  assert.equal(zoneOf(g, junk), 'trash');
  assert.equal(handSize(g, 0), 1);
  // Cull: a Gold exhausted
  g = game();
  u = put(g, 0, 't-u2', 'base');
  attachNow(g, put(g, 0, 'sfd-134-221', 'base'), u);
  g = move(g, [u], 0);
  const gold = g.players[0].base.filter(id => g.objects[id].cardId === 'unl-t05');
  assert.equal(gold.length, 1);
  assert.ok(g.objects[gold[0]].exhausted);
});

test('Trinity Force: when the equipped unit holds, score 1 point', () => {
  let g = game();
  setController(g, 0, 0);
  const u = put(g, 0, 't-u2', 0);
  attachNow(g, put(g, 0, 'sfd-115-221', 'base'), u);
  g = endTurn(g); g = endTurn(g);
  assert.equal(g.players[0].points, 2, 'hold point + Trinity Force');
});

test('Last Rites: when the equipped unit conquers, you may play a unit from your trash (paying its cost; chosen on the chain)', () => {
  let g = game();
  mana(g, 0, 3);
  const dead = put(g, 0, 't-u3', 'trash');
  const u = put(g, 0, 't-u2', 'base');
  attachNow(g, put(g, 0, 'sfd-150-221', 'base'), u);
  g = run(act(g, { type: 'move', player: 0, units: [u], to: 0 }));     // showdown, then the conquer trigger
  assert.deepEqual(expectDecision(g, 'chooseTargets', 0), [dead]);
  g = run(g, dead, 'base');                      // then where to play it
  assert.equal(zoneOf(g, dead), 'base', 'played from the trash');
  assert.equal(g.players[0].runesInPlay.filter(r => !g.objects[r].exhausted).length, 0, 'its cost was paid');
});

test('Eye of the Herald: when the equipped unit moves, play a 1 Might Recruit token here', () => {
  let g = game();
  const u = put(g, 0, 't-u2', 'base');
  attachNow(g, put(g, 0, 'sfd-153-221', 'base'), u);
  g = move(g, [u], 0);
  const rec = Object.values(g.objects).filter(o => o.isToken && o.zone === 'battlefield' && o.battlefieldIndex === 0 && g.cards[o.cardId]?.name === 'Recruit');
  assert.equal(rec.length, 1);
  assert.equal(m(g, rec[0].id), 1);
});

test('Sacred Shears: Deathknell — draw 1 when the equipped unit dies', () => {
  let g = game();
  mana(g, 0, 1);
  const u = put(g, 0, 't-u2', 0);
  attachNow(g, put(g, 0, 'sfd-172-221', 'base'), u);
  const before = handSize(g, 0);
  [g] = playNew(g, 0, 'ts-bolt');
  g = run(g);
  assert.equal(zoneOf(g, u), 'trash');
  assert.equal(handSize(g, 0), before + 1);
});

test("Rabadon's Deathcrown: while attached, your spells deal 3 Bonus Damage (not combat damage)", () => {
  let g = game();
  mana(g, 0, 1);
  const u = put(g, 0, 't-u2', 'base');
  const rc = put(g, 0, 'sfd-191-221', 'base');
  const e = put(g, 1, 't-u5', 0);
  [g] = playNew(g, 0, 'ts-bolt');
  g = run(g);
  assert.equal(g.objects[e].damage, 3, 'unattached: no bonus');
  g = game();
  mana(g, 0, 1);
  const u2 = put(g, 0, 't-u2', 'base');
  attachNow(g, put(g, 0, 'sfd-191-221', 'base'), u2);
  const e2 = put(g, 1, 't-u5', 0);
  [g] = playNew(g, 0, 'ts-bolt');
  g = run(g);
  assert.equal(zoneOf(g, e2), 'trash', '3 + 3 Bonus Damage kills a 5-Might unit');
  void u; void rc;
});

test("Shurelya's Requiem: units you control at the equipped unit's location have [Ganking]", () => {
  const g = game();
  const u = put(g, 0, 't-u2', 0);
  const other = put(g, 0, 't-u1', 0), away = put(g, 0, 't-u1', 'base'), enemy = put(g, 1, 't-u1', 0);
  attachNow(g, put(g, 0, 'sfd-192-221', 'base'), u);
  assert.ok(hasKw(g, u, 'Ganking'));
  assert.ok(hasKw(g, other, 'Ganking'));
  assert.ok(!hasKw(g, away, 'Ganking'));
  assert.ok(!hasKw(g, enemy, 'Ganking'));
});

test('Shady Spectacles: band is reminder text only (copy handled by its rules text)', () => {
  assert.equal(real['ven-137-166'].attachedText, '');
  assert.equal(real['ven-137-166'].attachedReminderText, '(I am a copy of the chosen unit.)');
});

void play;

// PILOT-A: Azir competence puzzles (docs/ai-pilots/azir.md). Real meta decks and cards; positions where a strong player's
// best move is clear. The AI under test is the default SearchAI with the registered deck plans.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { puzzle, aiTurn, aiAction } from '../core/puzzle.ts';
import type { GameState, ObjId, PlayerId } from '../../../src/engine/types.ts';
import { applyAction, getLegalActions } from '../../../src/engine/index.ts';
import { fastPolicy } from '../../../src/ai/index.ts';
import { place, type PlaceOpts } from '../../../src/engine/testkit.ts';

/** a Sand Soldier token (tokens are not in data/cards.json, so puzzle.token cannot name them) */
/** move the champion-zone Azir into the deck (puzzles that put Azir on the board, or where he is not the point) */
const noChampion = (z: { g: GameState }, p: PlayerId = 0) => { const pl = z.g.players[p]; for (const id of pl.championZone) { z.g.objects[id].zone = 'mainDeck'; pl.mainDeck.push(id); } pl.championZone = []; };
const soldier = (z: { g: GameState }, loc: 'base' | number, o: PlaceOpts = {}, p: PlayerId = 0) => place(z.g, p, 'tok-sand-soldier', loc, { ...o, token: true });

const soldiers = (g: GameState, p: PlayerId = 0) => Object.values(g.objects).filter(o => o.controller === p && (o.zone === 'base' || o.zone === 'battlefield') && g.cards[o.cardId]?.name === 'Sand Soldier');
const nameOf = (g: GameState, id: ObjId) => g.cards[g.objects[id]?.cardId]?.name;
const equipPlays = (g: GameState, names: string[]) => names.filter(n => /^play (Doran's Shield|Eye of the Herald|Soul Sword|Brutalizer|Hand Hammer|B\.F\. Sword)/.test(n)).length;
const legendUses = (names: string[]) => names.filter(n => /^activate Emperor of the Sands#/.test(n)).length;

test('Azir T1 line: exactly one 1-cost Equipment, then the legend for a Sand Soldier', () => {
  const z = puzzle({ me: '01-azir.json', opp: '04-rek-sai.json', turn: 1 });
  z.runes(0, { Calm: 1, Order: 1 });
  z.hand(0, ["Doran's Shield", 'Soul Sword', 'Eye of the Herald', 'Guards!', 'Defy']);
  const t = aiTurn(z.g, 0);
  assert.equal(equipPlays(z.g, t.names), 1, t.names.join(' | '));
  assert.equal(legendUses(t.names), 1, t.names.join(' | '));
  assert.equal(soldiers(t.state).length, 1);
});

test('Azir mid-game: Equipment -> legend Soldier -> Azir attacks pulling every Soldier in, conquering', () => {
  const z = puzzle({ me: '01-azir.json', opp: '04-rek-sai.json', turn: 7, bfs: ['Trifarian War Camp', 'Forbidding Waste'] });
  noChampion(z);
  z.runes(0, { Calm: 3, Order: 2 });
  z.hand(0, ['Eye of the Herald', 'Discipline']);
  z.base(0, 'Azir, Sovereign');
  soldier(z, 'base');
  soldier(z, 'base');
  z.at(1, 'Undertitan', 1);                                  // 5 Might enemy holding battlefield 1
  z.control(1, 1);
  z.points(1, 3);
  const t = aiTurn(z.g, 0);
  assert.ok(legendUses(t.names) >= 1, t.names.join(' | '));
  assert.ok(t.names.some(n => /^move .*Azir/.test(n)), 'Azir attacks: ' + t.names.join(' | '));
  assert.equal(t.state.battlefields[1].controller, 0, 'conquered battlefield 1: ' + t.names.join(' | '));
});

test('Weaponmaster: the new Soldier picks up the unattached Equipment, not the one a Soldier already wears', () => {
  const z = puzzle({ me: '01-azir.json', opp: '02-vex.json', turn: 6 });
  noChampion(z);
  z.runes(0, { Calm: 2, Order: 2 });
  z.hand(0, ['Eye of the Herald']);
  const s = soldier(z, 0);
  z.control(0, 0);
  const bf = z.base(0, 'B.F. Sword');
  z.equip(bf, s);
  const ds = z.base(0, "Doran's Shield");
  const t = aiTurn(z.g, 0);
  assert.equal(t.state.objects[bf].attachedTo, s, 'B.F. Sword stays: ' + t.names.join(' | '));
  const fresh = soldiers(t.state).filter(o => o.id !== s);
  assert.equal(fresh.length, 1, t.names.join(' | '));
  assert.equal(t.state.objects[ds].attachedTo, fresh[0].id, "Doran's Shield on the new Soldier: " + t.names.join(' | '));
});

test('Hide Guards! at a held battlefield when the spare rune has nothing better to do', () => {
  const z = puzzle({ me: '08-azir.json', opp: '04-rek-sai.json', turn: 6 });
  noChampion(z);
  z.runes(0, { Order: 1, Calm: 1 });
  z.hand(0, ['Guards!']);
  soldier(z, 0);
  z.control(0, 0);
  z.base(1, 'Inferna');
  z.base(1, 'Carrion Dredger');
  const t = aiTurn(z.g, 0);
  assert.ok(t.names.some(n => /^hide Guards! @0/.test(n)), t.names.join(' | '));
});

test('Hidden Guards! is played as a Reaction when the opponent attacks that battlefield', () => {
  const z = puzzle({ me: '01-azir.json', opp: '04-rek-sai.json', turn: 6 });
  noChampion(z);
  z.runes(0, { Calm: 2, Order: 1 });
  soldier(z, 0);
  z.control(0, 0);
  const fd = z.facedown(0, 'Guards!', 0, 5);
  z.runes(1, { Fury: 3 });
  const atk1 = z.base(1, 'Bilgewater Tracker');
  // opponent's turn: they attack battlefield 0 with a 3-Might unit
  let g = z.g;
  g.activePlayer = 1; g.turn = 7; g.pending = { kind: 'mainAction', player: 1, prompt: 'Your turn', inStep: false };
  g = applyAction(g, { type: 'move', player: 1, units: [atk1], to: 0 }).state;
  let played = false;
  for (let i = 0; i < 30 && g.winner === null; i++) {
    const d = g.pending!;
    if (!d.inStep && d.kind === 'mainAction') break;
    const a = d.player === 0 ? aiAction(g, 0) : fastPolicy(g, d.player);
    if (!a) break;
    if (a.type === 'playCard' && a.obj === fd) played = true;
    g = applyAction(g, a).state;
  }
  assert.ok(played, 'Guards! played from facedown');
  assert.equal(g.battlefields[0].controller, 0, 'battlefield 0 defended');
});

test('Lethal: at 7 points, Azir attacks with the Soldiers to conquer the 8th point', () => {
  const z = puzzle({ me: '10-azir.json', opp: '06-kai-sa.json', turn: 11 });
  noChampion(z);
  z.runes(0, { Calm: 2, Order: 2 });
  z.hand(0, ['Hidden Blade']);
  z.points(0, 7);
  z.points(1, 6);
  z.base(0, 'Azir, Sovereign');
  soldier(z, 'base');
  soldier(z, 0, { ready: false });
  z.control(0, 0);
  z.at(1, 'Lecturing Yordle', 1);
  z.at(1, 'Plundering Poro', 1);
  z.control(1, 1);
  z.g.battlefields[0].scoredThisTurnBy = [0];                // held battlefield 0 this turn: the final point may be a conquer
  const t = aiTurn(z.g, 0);
  assert.equal(t.state.winner, 0, t.names.join(' | '));
});

test('Arise! with 4 Equipment (two unattached): play it, the ready Soldiers pick up the free Equipment', () => {
  const z = puzzle({ me: '14-azir.json', opp: '02-vex.json', turn: 12 });
  noChampion(z);
  z.runes(0, { Calm: 5, Order: 3 });
  z.hand(0, ['Arise!']);
  const u = soldier(z, 'base');
  const v = soldier(z, 'base');
  z.equip(z.base(0, 'Soul Sword'), u);
  z.equip(z.base(0, "Doran's Shield"), v);
  z.base(0, 'B.F. Sword');
  z.base(0, 'Brutalizer');
  const t = aiTurn(z.g, 0);
  assert.ok(t.names.some(n => /^play Arise!/.test(n)), t.names.join(' | '));
  assert.ok(soldiers(t.state).length >= 6, `soldiers ${soldiers(t.state).length}: ` + t.names.join(' | '));
  const free = Object.values(t.state.objects).filter(o => o.controller === 0 && (o.zone === 'base' || o.zone === 'battlefield') && ['B.F. Sword', 'Brutalizer'].includes(nameOf(t.state, o.id)!) && !o.attachedTo);
  assert.equal(free.length, 0, 'both free Equipment picked up: ' + t.names.join(' | '));
});

test("Don't overpay [C]: with nothing to fight, one Equipment + legend, no Equip churn, at most one rune recycled", () => {
  const z = puzzle({ me: '01-azir.json', opp: '06-kai-sa.json', turn: 4 });
  noChampion(z);
  z.runes(0, { Calm: 2, Order: 1 });
  z.hand(0, ['Soul Sword', "Doran's Shield"]);
  const s = soldier(z, 'base');
  const ds = z.base(0, "Doran's Shield");
  z.equip(ds, s);
  const r0 = z.g.players[0].runesInPlay.length;
  const t = aiTurn(z.g, 0);
  assert.equal(equipPlays(z.g, t.names), 1, t.names.join(' | '));
  assert.equal(legendUses(t.names), 1, t.names.join(' | '));
  assert.equal(t.state.objects[ds].attachedTo, s, 'no churn');
  assert.ok(r0 - t.state.players[0].runesInPlay.length <= 1, `recycled ${r0 - t.state.players[0].runesInPlay.length}: ` + t.names.join(' | '));
});

test('Defy counters the opponent\'s Void Seeker on Azir', () => {
  const z = puzzle({ me: '01-azir.json', opp: '07-kai-sa.json', turn: 8 });
  noChampion(z);
  z.runes(0, { Calm: 2 });
  z.hand(0, ['Defy']);
  const az = z.at(0, 'Azir, Sovereign', 0);
  z.control(0, 0);
  z.runes(1, { Fury: 2, Mind: 1 });
  const ray = z.hand(1, ['Void Seeker'])[0];                  // 4 damage: kills Azir
  let g = z.g;
  g.activePlayer = 1; g.turn = 9; g.pending = { kind: 'mainAction', player: 1, prompt: 'Your turn', inStep: false };
  const play = getLegalActions(g, 1).find(a => a.type === 'playCard' && a.obj === ray)!;
  g = applyAction(g, play).state;
  for (let i = 0; i < 6 && g.pending?.inStep && g.pending.player === 1; i++) {
    const d = g.pending;
    const opt = (d.options ?? []).find(o => o.id === az) ? [az] : [(d.options ?? [])[0]?.id].filter(Boolean) as string[];
    g = applyAction(g, d.kind === 'chooseTargets' ? { type: 'choose', player: 1, optionIds: opt } : fastPolicy(g, 1)!).state;
  }
  let countered = false;
  for (let i = 0; i < 20 && g.winner === null; i++) {
    const d = g.pending!;
    if (!d.inStep && d.kind === 'mainAction') break;
    const a = d.player === 0 ? aiAction(g, 0) : fastPolicy(g, d.player);
    if (!a) break;
    if (a.type === 'playCard' && nameOf(g, a.obj) === 'Defy') countered = true;
    g = applyAction(g, a).state;
  }
  assert.ok(countered, 'Defy played');
  assert.equal(g.objects[az].zone, 'battlefield', 'Azir survives');
});

test('Azir is not Accelerated when he has no attack this turn (keeps the rune)', () => {
  const z = puzzle({ me: '01-azir.json', opp: '02-vex.json', turn: 7 });
  z.runes(0, { Calm: 3, Order: 3 });
  z.hand(0, ['Azir, Sovereign']);
  soldier(z, 0);
  soldier(z, 1);
  z.control(0, 0); z.control(1, 0);
  const r0 = z.g.players[0].runesInPlay.length;
  const t = aiTurn(z.g, 0);
  assert.ok(t.names.some(n => /^play Azir/.test(n)), t.names.join(' | '));
  assert.equal(t.state.players[0].runesInPlay.length, r0, 'no Accelerate recycle: ' + t.names.join(' | '));
});

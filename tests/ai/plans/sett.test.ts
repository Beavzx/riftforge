// PILOT-A: Sett competence puzzles (docs/ai-pilots/sett.md). Real meta deck and cards; the AI under test is the default
// SearchAI with the registered deck plans.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { puzzle, aiTurn, aiAction, type Puzzle } from '../core/puzzle.ts';
import type { GameState, PlayerId } from '../../../src/engine/types.ts';
import { applyAction, getLegalActions } from '../../../src/engine/index.ts';
import { fastPolicy } from '../../../src/ai/index.ts';

const noChampion = (z: Puzzle, p: PlayerId = 0) => { const pl = z.g.players[p]; for (const id of pl.championZone) { z.g.objects[id].zone = 'mainDeck'; pl.mainDeck.push(id); } pl.championZone = []; };
const zoneOf = (g: GameState, id: string) => g.objects[id]?.zone ?? 'gone';
const buffed = (g: GameState, id: string) => !!g.objects[id]?.counters?.buff;
const BFS: [string, string] = ['Frozen Fortress', 'Rockfall Path'];

/** the opponent (player 1) takes a turn starting with `first`; the AI answers its own decisions */
function oppTurn(z: Puzzle, first: (g: GameState) => GameState): { g: GameState; mine: string[] } {
  let g = z.g;
  g.activePlayer = 1; g.turn += 1; g.pending = { kind: 'mainAction', player: 1, prompt: 'Your turn', inStep: false };
  g = first(g);
  const mine: string[] = [];
  for (let i = 0; i < 40 && g.winner === null; i++) {
    const d = g.pending!;
    if (!d.inStep && d.kind === 'mainAction') break;
    const a = d.player === 0 ? aiAction(g, 0) : fastPolicy(g, d.player);
    if (!a) break;
    if (d.player === 0 && a.type === 'playCard') mine.push('play ' + g.cards[g.objects[a.obj].cardId].name);
    if (d.player === 0 && a.type === 'choose') mine.push(`${d.prompt.slice(0, 30)}: ${a.optionIds.join(',')}`);
    g = applyAction(g, a).state;
  }
  return { g, mine };
}

test('Sett: a unit first, then Pit Rookie buffs it', () => {
  const z = puzzle({ me: '13-sett.json', opp: '02-vex.json', turn: 3, bfs: BFS });
  noChampion(z);
  z.runes(0, { Body: 3, Order: 1 });
  z.hand(0, ['Pit Rookie', 'Irresistible Faefolk']);
  const t = aiTurn(z.g, 0);
  const iF = t.names.findIndex(n => /^play Irresistible Faefolk/.test(n)), iR = t.names.findIndex(n => /^play Pit Rookie/.test(n));
  assert.ok(iF >= 0 && iR > iF, t.names.join(' | '));
  const fae = Object.values(t.state.objects).find(o => t.state.cards[o.cardId]?.name === 'Irresistible Faefolk' && o.controller === 0 && (o.zone === 'base' || o.zone === 'battlefield'))!;
  assert.ok(buffed(t.state, fae.id), 'Faefolk buffed');
});

test('The Boss saves a buffed unit from removal on the opponent\'s turn (pay [A], recall it)', () => {
  const z = puzzle({ me: '13-sett.json', opp: '06-kai-sa.json', turn: 6, bfs: BFS });
  noChampion(z);
  z.runes(0, { Body: 1 });
  const f = z.at(0, 'Fiora, Victorious', 0, { buff: true });
  z.control(0, 0);
  z.runes(1, { Fury: 4 });
  const fs = z.hand(1, ['Falling Star'])[0];
  const r = oppTurn(z, g => {
    g = applyAction(g, getLegalActions(g, 1).find(a => a.type === 'playCard' && a.obj === fs)!).state;
    for (let i = 0; i < 4 && g.pending?.inStep && g.pending.player === 1; i++) g = applyAction(g, { type: 'choose', player: 1, optionIds: [f] }).state;
    return g;
  });
  assert.ok(['base', 'battlefield'].includes(zoneOf(r.g, f)), 'Fiora saved: ' + r.mine.join(' | '));
});

test('Sett: Showstopper buffs the best base unit and moves it in to conquer', () => {
  const z = puzzle({ me: '13-sett.json', opp: '04-rek-sai.json', turn: 6, bfs: BFS });
  noChampion(z);
  z.runes(0, { Body: 2, Order: 1 });
  z.hand(0, ['Showstopper']);
  const k = z.base(0, 'Kinkou Initiate', { ready: false });         // exhausted: can't move on its own
  z.at(1, 'Carrion Dredger', 0);
  z.control(0, 1);
  const t = aiTurn(z.g, 0);
  assert.ok(t.names.some(n => /^play Showstopper/.test(n)), t.names.join(' | '));
  assert.equal(t.state.objects[k].zone, 'battlefield', t.names.join(' | '));
  assert.ok(t.state.players[0].points >= 1, 'conquered: ' + t.names.join(' | '));
});

test('Sett, Kingpin goes to the battlefield where the buffed units are', () => {
  const z = puzzle({ me: '13-sett.json', opp: '02-vex.json', turn: 8, bfs: BFS });
  z.runes(0, { Body: 3, Order: 2 });
  z.at(0, 'Pit Rookie', 0, { buff: true });
  z.at(0, 'Kinkou Initiate', 0, { buff: true });
  z.control(0, 0);
  z.at(0, 'Trifarian Captain', 1);
  z.control(1, 0);
  const t = aiTurn(z.g, 0);
  const sett = Object.values(t.state.objects).find(o => t.state.cards[o.cardId]?.name === 'Sett' && o.controller === 0 && (o.zone === 'base' || o.zone === 'battlefield'));
  assert.ok(sett, 'Sett played: ' + t.names.join(' | '));
  assert.equal(sett!.battlefieldIndex, 0, 'with the buffed units: ' + t.names.join(' | '));
});

test('Sett: Punch First (+5) wins the attack on a bigger defender', () => {
  const z = puzzle({ me: '13-sett.json', opp: '01-azir.json', turn: 8, bfs: BFS });
  noChampion(z);
  z.runes(0, { Body: 3 });
  z.hand(0, ['Punch First']);
  z.base(0, 'Kinkou Initiate');                                      // 3 Might
  const az = z.at(1, 'Azir, Sovereign', 0);                          // 4 Might
  z.control(0, 1);
  z.points(1, 4);
  const t = aiTurn(z.g, 0);
  assert.ok(t.names.some(n => /^play Punch First/.test(n)), t.names.join(' | '));
  assert.notEqual(zoneOf(t.state, az), 'battlefield', t.names.join(' | '));
  assert.ok(t.state.players[0].points >= 1, t.names.join(' | '));
});

test('Sett: Irresistible Faefolk pulls a lone enemy unit into a fight our buffed unit wins', () => {
  const z = puzzle({ me: '13-sett.json', opp: '06-kai-sa.json', turn: 6, bfs: BFS });
  noChampion(z);
  z.runes(0, { Body: 1 });
  z.at(0, 'Fiora, Victorious', 0, { buff: true });               // 5 Might (Mighty)
  z.control(0, 0);
  const fae = z.base(0, 'Irresistible Faefolk');
  const e = z.base(1, 'The Empyrean');                           // not at a battlefield yet: pull it into Fiora
  const eKai = z.at(1, 'Plundering Poro', 1);
  z.control(1, 1);
  const t = aiTurn(z.g, 0);
  void fae; void eKai;
  assert.ok(t.state.players[0].points >= 1 || zoneOf(t.state, e) !== 'base', t.names.join(' | '));
});

test('Sett lethal: at 7 points with battlefield 0 scored this turn, conquer battlefield 1', () => {
  const z = puzzle({ me: '13-sett.json', opp: '02-vex.json', turn: 11, bfs: BFS });
  noChampion(z);
  z.runes(0, { Body: 2 });
  z.points(0, 7); z.points(1, 7);
  z.at(0, 'Pit Rookie', 0); z.control(0, 0);
  z.g.battlefields[0].scoredThisTurnBy = [0];
  z.base(0, 'Fiora, Victorious', { buff: true });
  z.at(1, 'Scuttle Crab', 1);
  z.control(1, 1);
  const t = aiTurn(z.g, 0);
  assert.equal(t.state.winner, 0, t.names.join(' | '));
});

test('Sett: Rampage (+2 with [C]) kills the bigger enemy unit and our unit survives', () => {
  const z = puzzle({ me: '13-sett.json', opp: '04-rek-sai.json', turn: 8, bfs: BFS });
  noChampion(z);
  z.runes(0, { Body: 4 });
  z.hand(0, ['Rampage']);
  const f = z.at(0, 'Fiora, Victorious', 0);                     // 4 (+2 = 6)
  z.control(0, 0);
  const e = z.at(1, 'Undertitan', 1);                            // 5
  z.control(1, 1);
  const t = aiTurn(z.g, 0);
  assert.ok(t.names.some(n => /^play Rampage/.test(n)), t.names.join(' | '));
  assert.equal(zoneOf(t.state, e), 'trash', t.names.join(' | '));
  assert.equal(zoneOf(t.state, f), 'battlefield', t.names.join(' | '));
});

// PILOT-A: Rek'Sai competence puzzles (docs/ai-pilots/reksai.md). Real meta decks and cards; the AI under test is the
// default SearchAI with the registered deck plans.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { puzzle, aiTurn, aiAction, type Puzzle } from '../core/puzzle.ts';
import type { GameState, PlayerId } from '../../../src/engine/types.ts';
import { applyAction } from '../../../src/engine/index.ts';
import { fastPolicy } from '../../../src/ai/index.ts';
import { place } from '../../../src/engine/testkit.ts';

const noChampion = (z: Puzzle, p: PlayerId = 0) => { const pl = z.g.players[p]; for (const id of pl.championZone) { z.g.objects[id].zone = 'mainDeck'; pl.mainDeck.push(id); } pl.championZone = []; };
const zoneOf = (g: GameState, id: string) => g.objects[id]?.zone ?? 'gone';
const runes = (g: GameState, p: PlayerId = 0) => g.players[p].runesInPlay.length;
const BFS: [string, string] = ['Rockfall Path', 'Frozen Fortress'];

test("Rek'Sai: conquer, then the legend reveals the top 2 and plays one (Breacher gives it Accelerate)", () => {
  const z = puzzle({ me: '04-rek-sai.json', opp: '06-kai-sa.json', turn: 6, bfs: BFS });
  noChampion(z);
  z.runes(0, { Fury: 3, Order: 2 });
  z.base(0, 'Inferna');
  z.base(0, 'Rek\'Sai, Breacher');
  z.at(1, 'Watchful Sentry', 0);
  z.control(0, 1);
  z.deckTop(0, ['Bilgewater Tracker', 'Long Sword']);
  const t = aiTurn(z.g, 0);
  assert.ok(t.state.players[0].points >= 1, 'conquered: ' + t.names.join(' | '));
  assert.equal(t.state.objects[z.legend(0)].exhausted, true, 'legend used: ' + t.names.join(' | '));
  const revealed = Object.values(t.state.objects).filter(o => ['Bilgewater Tracker', 'Long Sword'].includes(t.state.cards[o.cardId]?.name ?? '') && o.controller === 0 && (o.zone === 'base' || o.zone === 'battlefield'));
  assert.equal(revealed.length, 1, 'one revealed card played: ' + t.names.join(' | '));
});

test("Rek'Sai: a 2-drop first, then Noxus Hopeful for [2] (Legion)", () => {
  const z = puzzle({ me: '04-rek-sai.json', opp: '02-vex.json', turn: 4, bfs: BFS });
  noChampion(z);
  z.runes(0, { Fury: 3, Order: 1 });
  z.hand(0, ['Noxus Hopeful', 'Carrion Dredger']);
  const t = aiTurn(z.g, 0);
  const iP = t.names.findIndex(n => /^play Carrion Dredger/.test(n)), iH = t.names.findIndex(n => /^play Noxus Hopeful/.test(n));
  assert.ok(iP >= 0 && iH > iP, t.names.join(' | '));
});

test("Rek'Sai: Undertitan (+2 to the others) then everyone attacks the enemy battlefield", () => {
  const z = puzzle({ me: '04-rek-sai.json', opp: '01-azir.json', turn: 12, bfs: BFS });
  noChampion(z);
  z.runes(0, { Fury: 4, Order: 3 });
  z.hand(0, ['Undertitan']);
  z.base(0, 'Inferna');
  z.base(0, 'Trifarian Captain');
  z.base(0, 'Carrion Dredger');
  z.at(1, 'Azir, Sovereign', 1);
  place(z.g, 1, 'tok-sand-soldier', 1, { token: true });
  z.control(1, 1);
  const t = aiTurn(z.g, 0);
  assert.ok(t.names.some(n => /^play Undertitan/.test(n)), t.names.join(' | '));
  assert.ok(t.state.players[0].points >= 2, 'conquered both battlefields: ' + t.names.join(' | '));
});

test("Rek'Sai: Cull the Weak when we can sacrifice a Recruit and they have one big unit", () => {
  const z = puzzle({ me: '04-rek-sai.json', opp: '13-sett.json', turn: 8, bfs: BFS });
  noChampion(z);
  z.runes(0, { Fury: 2, Order: 2 });
  z.hand(0, ['Cull the Weak']);
  const rec = z.token(0, 'Recruit', 'base');
  const mine = z.base(0, 'Rek\'Sai, Breacher');
  const sett = z.at(1, 'Sett, Kingpin', 0);
  z.control(0, 1);
  z.g.objects[z.legend(0)].exhausted = true;          // no conquer reveal this turn (its random value is not the point here)
  const t = aiTurn(z.g, 0);
  assert.ok(t.names.some(n => /^play Cull the Weak/.test(n)), t.names.join(' | '));
  assert.notEqual(zoneOf(t.state, sett), 'battlefield', 'Sett died');
  assert.notEqual(zoneOf(t.state, rec), 'base', 'we sacrificed the Recruit');
  assert.ok(['base', 'battlefield'].includes(zoneOf(t.state, mine)), "Rek'Sai kept");
});

test("Rek'Sai: Shimmering Swimmer sacrifices a Recruit to kill a 2-Might enemy", () => {
  const z = puzzle({ me: '04-rek-sai.json', opp: '06-kai-sa.json', turn: 6, bfs: BFS });
  noChampion(z);
  z.runes(0, { Fury: 3 });
  z.hand(0, ['Shimmering Swimmer']);
  const rec = z.token(0, 'Recruit', 'base');
  const e = z.at(1, 'Lecturing Yordle', 0);
  z.control(0, 1);
  z.g.objects[z.legend(0)].exhausted = true;          // no conquer reveal this turn (its random value is not the point here)
  const t = aiTurn(z.g, 0);
  assert.equal(zoneOf(t.state, e), 'trash', t.names.join(' | '));
  assert.notEqual(zoneOf(t.state, rec), 'base');
});

test("Rek'Sai: Falling Star 3 + 3 kills two 3-Might units", () => {
  const z = puzzle({ me: '04-rek-sai.json', opp: '13-sett.json', turn: 8, bfs: BFS });
  noChampion(z);
  z.runes(0, { Fury: 4 });
  z.hand(0, ['Falling Star']);
  const a = z.at(1, 'Kinkou Initiate', 0);
  const b = z.at(1, 'First Mate', 0);
  z.control(0, 1);
  const t = aiTurn(z.g, 0);
  assert.equal(zoneOf(t.state, a), 'trash', t.names.join(' | '));
  assert.equal(zoneOf(t.state, b), 'trash', t.names.join(' | '));
});

test("Rek'Sai lethal: at 7 points (battlefield 0 already scored this turn), conquer battlefield 1", () => {
  const z = puzzle({ me: '04-rek-sai.json', opp: '01-azir.json', turn: 11, bfs: BFS });
  noChampion(z);
  z.runes(0, { Fury: 2, Order: 1 });
  z.points(0, 7); z.points(1, 6);
  z.at(0, 'Noxus Hopeful', 0); z.control(0, 0);
  z.g.battlefields[0].scoredThisTurnBy = [0];
  z.base(0, 'Bilgewater Tracker');
  z.base(0, 'Inferna');
  place(z.g, 1, 'tok-sand-soldier', 1, { token: true });
  z.control(1, 1);
  const t = aiTurn(z.g, 0);
  assert.equal(t.state.winner, 0, t.names.join(' | '));
});

test("Rek'Sai, Breacher is not Accelerated when she has nothing to attack", () => {
  const z = puzzle({ me: '04-rek-sai.json', opp: '02-vex.json', turn: 6, bfs: BFS });
  z.runes(0, { Fury: 3, Order: 2 });
  z.at(0, 'Carrion Dredger', 0); z.control(0, 0);
  z.at(0, 'Trifarian Captain', 1); z.control(1, 0);
  const r0 = runes(z.g);
  const t = aiTurn(z.g, 0);
  assert.ok(t.names.some(n => /^play Rek'Sai/.test(n)), t.names.join(' | '));
  assert.equal(runes(t.state), r0, 'no Accelerate: ' + t.names.join(' | '));
});

test("Rek'Sai on the opponent's turn: Inferna ambushes into the defended battlefield", () => {
  const z = puzzle({ me: '04-rek-sai.json', opp: '13-sett.json', turn: 6, bfs: ['Frozen Fortress', 'Rockfall Path'] });   // units can be played at 0
  noChampion(z);
  z.runes(0, { Fury: 2 });
  z.hand(0, ['Inferna']);
  z.at(0, 'Carrion Dredger', 0);
  z.control(0, 0);
  z.runes(1, { Body: 3 });
  const atk = z.base(1, 'Pit Rookie');                 // 2 Might attacker vs our 1-Might Dredger
  let g = z.g;
  g.activePlayer = 1; g.turn += 1; g.pending = { kind: 'mainAction', player: 1, prompt: 'Your turn', inStep: false };
  g = applyAction(g, { type: 'move', player: 1, units: [atk], to: 0 }).state;
  let ambushed = false;
  for (let i = 0; i < 40 && g.winner === null; i++) {
    const d = g.pending!;
    if (!d.inStep && d.kind === 'mainAction') break;
    const a = d.player === 0 ? aiAction(g, 0) : fastPolicy(g, d.player);
    if (!a) break;
    if (d.player === 0 && a.type === 'playCard' && g.cards[g.objects[a.obj].cardId].name === 'Inferna') ambushed = true;
    g = applyAction(g, a).state;
  }
  assert.ok(ambushed, 'Inferna played as a Reaction');
  assert.notEqual(g.battlefields[0].controller, 1, 'not conquered');
  assert.equal(g.players[1].points, 0, 'no conquer point for them');
});

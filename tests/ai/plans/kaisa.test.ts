// PILOT-A: Kai'Sa competence puzzles (docs/ai-pilots/kaisa.md). Real meta decks and cards; the AI under test is the
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

/** play out the opponent's (player 1's) turn from a fresh main phase: `opp` acts first, then everyone answers with AI (0) / bot (1) */
function oppTurn(z: Puzzle, first: (g: GameState) => GameState, steps = 40): { g: GameState; mine: string[] } {
  let g = z.g;
  g.activePlayer = 1; g.turn += 1; g.pending = { kind: 'mainAction', player: 1, prompt: 'Your turn', inStep: false };
  g = first(g);
  const mine: string[] = [];
  for (let i = 0; i < steps && g.winner === null; i++) {
    const d = g.pending!;
    if (!d.inStep && d.kind === 'mainAction') break;
    const a = d.player === 0 ? aiAction(g, 0) : fastPolicy(g, d.player);
    if (!a) break;
    if (d.player === 0 && a.type === 'playCard') mine.push('play ' + g.cards[g.objects[a.obj].cardId].name);
    if (d.player === 0 && a.type === 'activate') mine.push('activate ' + g.cards[g.objects[a.obj].cardId].name);
    g = applyAction(g, a).state;
  }
  return { g, mine };
}

test("Kai'Sa: the legend's [A] pays Hextech Ray's power — kill a 3-Might unit with one rune, no rune recycled", () => {
  const z = puzzle({ me: '06-kai-sa.json', opp: '04-rek-sai.json', turn: 4, bfs: ['Frozen Fortress', 'Rockfall Path'] });
  noChampion(z);
  z.runes(0, { Fury: 1 });
  z.hand(0, ['Hextech Ray']);
  const e = z.at(1, 'Bilgewater Tracker', 0);
  z.control(0, 1);
  const t = aiTurn(z.g, 0);
  assert.equal(zoneOf(t.state, e), 'trash', t.names.join(' | '));
  assert.equal(runes(t.state), 1, 'no rune recycled: ' + t.names.join(' | '));
});

test("Kai'Sa: Hextech Ray + Stupefy kill a 4-Might unit (legend pays one power)", () => {
  const z = puzzle({ me: '06-kai-sa.json', opp: '01-azir.json', turn: 6, bfs: ['Frozen Fortress', 'Rockfall Path'] });
  noChampion(z);
  z.runes(0, { Fury: 1, Mind: 1 });
  z.hand(0, ['Hextech Ray', 'Stupefy']);
  const e = z.at(1, 'Azir, Sovereign', 1);
  z.control(1, 1);
  const t = aiTurn(z.g, 0);
  assert.equal(zoneOf(t.state, e), 'trash', t.names.join(' | '));
});

test("Kai'Sa: Thousand-Tailed Watcher (-3 to every enemy) then attack the enemy battlefield", () => {
  const z = puzzle({ me: '06-kai-sa.json', opp: '04-rek-sai.json', turn: 12, bfs: ['Void Gate', 'Forbidding Waste'] });
  noChampion(z);
  z.runes(0, { Fury: 4, Mind: 4 });
  z.hand(0, ['Thousand-Tailed Watcher']);
  z.base(0, 'Bilgewater Tracker');
  z.base(0, 'Noxus Hopeful');
  z.at(1, 'Undertitan', 1);
  z.at(1, 'Faithful Manufactor', 1);
  z.control(1, 1);
  const t = aiTurn(z.g, 0);
  assert.ok(t.names.some(n => /^play Thousand-Tailed Watcher/.test(n)), t.names.join(' | '));
  assert.equal(t.state.battlefields[1].controller, 0, 'conquered after the -3: ' + t.names.join(' | '));
});

test("Kai'Sa: a cheap card first, then Noxus Hopeful for [2] (Legion)", () => {
  const z = puzzle({ me: '06-kai-sa.json', opp: '02-vex.json', turn: 4 });
  noChampion(z);
  z.runes(0, { Fury: 3, Mind: 1 });
  z.hand(0, ['Noxus Hopeful', 'Plundering Poro']);
  const t = aiTurn(z.g, 0);
  const iP = t.names.findIndex(n => /^play Plundering Poro/.test(n)), iH = t.names.findIndex(n => /^play Noxus Hopeful/.test(n));
  assert.ok(iP >= 0 && iH > iP, t.names.join(' | '));
});

test("Kai'Sa: Falling Star splits 3 + 3 to kill two 3-Might units", () => {
  const z = puzzle({ me: '06-kai-sa.json', opp: '04-rek-sai.json', turn: 8, bfs: ['Rockfall Path', 'Frozen Fortress'] });
  noChampion(z);
  z.runes(0, { Fury: 4 });
  z.hand(0, ['Falling Star']);
  const a = z.at(1, 'Bilgewater Tracker', 0);
  const b = z.at(1, 'Shimmering Swimmer', 0);
  z.control(0, 1);
  const t = aiTurn(z.g, 0);
  assert.equal(zoneOf(t.state, a), 'trash', t.names.join(' | '));
  assert.equal(zoneOf(t.state, b), 'trash', t.names.join(' | '));
});

test("Kai'Sa: Bellows Breath (+Repeat) wipes three Sand Soldiers at one battlefield", () => {
  const z = puzzle({ me: '06-kai-sa.json', opp: '01-azir.json', turn: 8, bfs: ['Rockfall Path', 'Frozen Fortress'] });
  noChampion(z);
  z.runes(0, { Fury: 2, Mind: 2 });
  z.hand(0, ['Bellows Breath']);
  const s = [0, 1, 2].map(() => place(z.g, 1, 'tok-sand-soldier', 0, { token: true }));
  z.control(0, 1);
  const t = aiTurn(z.g, 0);
  assert.ok(s.every(id => zoneOf(t.state, id) !== 'battlefield'), t.names.join(' | '));
});

test("Kai'Sa on the opponent's turn: Hextech Ray (paid by the legend) kills the attacker in the showdown", () => {
  const z = puzzle({ me: '06-kai-sa.json', opp: '04-rek-sai.json', turn: 6, bfs: ['Rockfall Path', 'Frozen Fortress'] });
  noChampion(z);
  z.runes(0, { Fury: 1 });
  z.hand(0, ['Hextech Ray']);
  z.at(0, 'Plundering Poro', 0);
  z.control(0, 0);
  z.runes(1, { Fury: 3 });
  const atk = z.base(1, 'Bilgewater Tracker');
  const r = oppTurn(z, g => applyAction(g, { type: 'move', player: 1, units: [atk], to: 0 }).state);
  assert.ok(r.mine.includes('play Hextech Ray'), r.mine.join(' | '));
  assert.equal(zoneOf(r.g, atk), 'trash');
  assert.equal(r.g.battlefields[0].controller, 0, 'battlefield kept');
});

test("Kai'Sa, Survivor is not Accelerated when she cannot attack this turn", () => {
  const z = puzzle({ me: '06-kai-sa.json', opp: '02-vex.json', turn: 6, bfs: ['Rockfall Path', 'Frozen Fortress'] });
  z.runes(0, { Fury: 4, Mind: 2 });
  z.at(0, 'Plundering Poro', 0); z.control(0, 0);
  z.at(0, 'Watchful Sentry', 1); z.control(1, 0);
  const r0 = runes(z.g);
  const t = aiTurn(z.g, 0);
  assert.ok(t.names.some(n => /^play Kai'Sa/.test(n)), t.names.join(' | '));
  assert.equal(runes(t.state), r0, 'no Accelerate: ' + t.names.join(' | '));
});

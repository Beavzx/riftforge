// PILOT-B: Evelynn, Agony's Embrace competence puzzles (docs/ai-pilots/evelynn.md). Real meta decks / cards; positions where a strong
// player's move is clear. The AI under test is the default SearchAI with the registered deck plans.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { puzzle, aiTurn, aiAction, describe } from '../core/puzzle.ts';
import type { Action, CardDef, CardId, DeckList, GameState, ObjId, PlayerId } from '../../../src/engine/types.ts';
import { applyAction, createGame } from '../../../src/engine/index.ts';
import { fastPolicy } from '../../../src/ai/index.ts';

// ---- helpers (opponent-turn positions, mulligans) ----
const DB: Record<CardId, CardDef> = JSON.parse(readFileSync(new URL('../../../data/cards.json', import.meta.url), 'utf8'));
const nameOf = (g: GameState, id: ObjId) => g.cards[g.objects[id]?.cardId]?.name;
/** make it the opponent's (player 1) main phase */
function oppTurn(g: GameState): void { g.activePlayer = 1; g.pending = { kind: 'mainAction', player: 1, prompt: 'Your turn', inStep: false }; }
/** the opponent does `a`; its own follow-up windows are passed / bot-answered until player 0 must decide */
function oppDoes(g: GameState, a: Action): GameState {
  let s = applyAction(g, a).state;
  for (let i = 0; i < 30 && s.pending && s.pending.player === a.player && s.pending.kind !== 'mainAction'; i++)
    s = applyAction(s, s.pending.inStep ? fastPolicy(s, a.player)! : { type: 'pass', player: a.player }).state;
  return s;
}
/** player 0 answers with the AI until the opponent's next main-phase decision (or `cap`); returns the AI's actions */
function aiUntilOppMain(g: GameState, cap = 40): { state: GameState; names: string[] } {
  const names: string[] = [];
  for (let i = 0; i < cap && g.winner === null && g.pending; i++) {
    const d = g.pending;
    if (d.player === 1 && d.kind === 'mainAction' && !d.inStep) break;
    const a = d.player === 0 ? aiAction(g, 0) : (d.inStep ? fastPolicy(g, 1) : { type: 'pass', player: 1 } as Action);
    if (!a) break;
    if (d.player === 0) names.push(describe(g, a));
    g = applyAction(g, a).state;
  }
  return { state: g, names };
}
/** a fresh game at player 0's mulligan with this opening hand (by name) */
function mulliganWith(file: string, names: string[]): { g: GameState; ids: Record<string, ObjId> } {
  const deck = (JSON.parse(readFileSync(new URL(`../../../data/meta-decks/${file}`, import.meta.url), 'utf8')) as { deck: DeckList }).deck;
  let g = createGame({ seed: 3, cardDb: DB, battlefieldSelection: 'random', firstPlayer: 0, validateDecks: false, includeAllCards: true,
    players: [{ name: 'AI', deck }, { name: 'OPP', deck: (JSON.parse(readFileSync(new URL('../../../data/meta-decks/04-rek-sai.json', import.meta.url), 'utf8')) as { deck: DeckList }).deck }] });
  for (let i = 0; i < 10 && g.pending && !(g.pending.kind === 'mulligan' && g.pending.player === 0); i++) g = applyAction(g, fastPolicy(g, g.pending.player)!).state;
  assert.equal(g.pending?.kind, 'mulligan');
  const ids: Record<string, ObjId> = {};
  g.players[0].hand.forEach((id, i) => { const want = names[i]; const def = Object.values(DB).find(d => d.name === want && d.type !== 'Legend')!; g.objects[id].cardId = def.id; ids[want] = id; });
  return { g, ids };
}
const sent = (a: Action | null) => (a && a.type === 'choose' ? a.optionIds : []);

// ---- puzzles ----

const facedownPlays = (names: string[], g: GameState, ids: ObjId[]) => names.filter(n => ids.some(id => n === `play ${nameOf(g, id)} @${g.objects[id].battlefieldIndex}`)).length;

test('Evelynn: on our turn the facedown card is played (free card + legend draw)', () => {
  const z = puzzle({ me: '03-evelynn.json', opp: '04-rek-sai.json', turn: 7 });
  z.runes(0, { Chaos: 2, Body: 2 });
  z.at(0, 'Gutter Guardian', 0); z.control(0, 0);
  const fd = z.facedown(0, 'Bedeviling Stranger', 0, 6);
  z.hand(0, ['Pyke', 'Punch First']);
  const hand0 = z.g.players[0].hand.length;
  const t = aiTurn(z.g, 0);
  assert.ok(t.names.includes('play Bedeviling Stranger @0'), t.names.join(' | '));
  assert.notEqual(t.state.objects[fd].zone, 'facedown');
  assert.ok(t.state.players[0].hand.length + t.names.filter(n => /^(play|hide) /.test(n)).length - 1 >= hand0 + 1, 'legend drew');
});

test('Evelynn: with a battlefield under control and spare power, a Hidden card is hidden there', () => {
  const z = puzzle({ me: '03-evelynn.json', opp: '06-kai-sa.json', turn: 5 });
  z.runes(0, { Chaos: 2, Body: 1 });
  z.at(0, 'Bedeviling Stranger', 0); z.control(0, 0);
  z.hand(0, ['Pyke', 'Rampage', 'Ruin Runner']);
  const t = aiTurn(z.g, 0);
  assert.ok(t.names.some(n => /^hide (Pyke|Switcheroo|Evelynn|Bedeviling Stranger|Gutter Guardian) @0/.test(n)), t.names.join(' | '));
});

test('Evelynn from face down pulls the lone defender off battlefield 1, then a unit conquers it', () => {
  const z = puzzle({ me: '03-evelynn.json', opp: '04-rek-sai.json', turn: 9 });
  z.runes(0, { Chaos: 2, Body: 1 });
  z.at(0, 'Vex, Apathetic', 0); z.at(0, 'Gutter Guardian', 0); z.control(0, 0);
  z.facedown(0, 'Evelynn, Entrancing', 0, 8);
  z.base(0, 'Pyke');
  z.at(1, 'Noxus Hopeful', 1); z.control(1, 1);
  z.g.battlefields[0].scoredThisTurnBy = [0];
  const t = aiTurn(z.g, 0);
  assert.ok(t.names.some(n => /^play Evelynn @0/.test(n)), t.names.join(' | '));
  assert.equal(t.state.battlefields[1].controller, 0, t.names.join(' | '));
});

test('Evelynn: Rengar ambushes the attacked battlefield as a Reaction and holds it', () => {
  const z = puzzle({ me: '03-evelynn.json', opp: '04-rek-sai.json', turn: 8 });
  z.runes(0, { Body: 3, Chaos: 3 }); z.runes(1, { Fury: 3, Order: 2 });
  z.at(0, 'Gutter Guardian', 0); z.control(0, 0);
  z.hand(0, ['Rengar, Trophy Hunter']);
  const titan = z.base(1, 'Undertitan');
  oppTurn(z.g);
  const g = oppDoes(z.g, { type: 'move', player: 1, units: [titan], to: 0 });
  const r = aiUntilOppMain(g);
  assert.ok(r.names.some(n => /^play Rengar @0/.test(n)), r.names.join(' | '));
  assert.equal(r.state.battlefields[0].controller, 0, r.names.join(' | '));
});

test('Evelynn: Gutter Guardian shows off a Hidden card for the extra [A] and hides it with that [A]', () => {
  const z = puzzle({ me: '03-evelynn.json', opp: '06-kai-sa.json', turn: 5 });
  z.runes(0, { Chaos: 3 });
  z.at(0, 'Bedeviling Stranger', 0); z.control(0, 0);
  z.hand(0, ['Gutter Guardian', 'Pyke']);
  const t = aiTurn(z.g, 0);
  // 3 runes: Gutter Guardian (3) showing off Pyke adds [A], which pays for hiding Pyke
  const i = t.names.findIndex(n => /^play Gutter Guardian/.test(n));
  assert.ok(i >= 0, t.names.join(' | '));
  assert.ok(t.names.slice(i + 1, i + 4).includes('choose Pyke'), t.names.join(' | '));
  assert.ok(t.names.includes('hide Pyke @0'), t.names.join(' | '));
});

test('Evelynn: at 7 points, attack the 4-Might holder and Punch First for the winning conquer', () => {
  const z = puzzle({ me: '03-evelynn.json', opp: '06-kai-sa.json', turn: 11 });
  z.runes(0, { Body: 2, Chaos: 1 });
  z.points(0, 7); z.points(1, 6);
  z.base(0, 'Pyke');
  z.at(0, 'Gutter Guardian', 0); z.control(0, 0);
  z.g.battlefields[0].scoredThisTurnBy = [0];            // held this turn: conquering battlefield 1 is the final point
  z.at(1, 'Noxus Hopeful', 1); z.control(1, 1);
  z.hand(0, ['Punch First']);
  const t = aiTurn(z.g, 0, { oppPass: true });
  assert.equal(t.state.winner, 0, t.names.join(' | '));
});

test('Evelynn: a facedown unit is NOT revealed on the opponent\'s turn without a fight (keeps its free play + draw)', () => {
  const z = puzzle({ me: '03-evelynn.json', opp: '06-kai-sa.json', turn: 8 });
  z.runes(0, { Chaos: 2, Body: 2 }); z.runes(1, { Fury: 3, Mind: 2 });
  z.at(0, 'Gutter Guardian', 0); z.control(0, 0);
  z.facedown(0, 'Pyke', 0, 6);
  const [u] = z.hand(1, ['Bilgewater Tracker']);
  oppTurn(z.g);
  const g = oppDoes(z.g, { type: 'playCard', player: 1, obj: u });
  assert.equal(g.pending?.player, 0);
  const a = aiAction(g, 0);
  assert.equal(a?.type, 'pass', a ? describe(g, a) : 'null');
});

test('Evelynn mulligan: keep the cheap Hidden bodies, send back Ruin Runner and Rengar', () => {
  const { g, ids } = mulliganWith('03-evelynn.json', ['Ruin Runner', 'Gutter Guardian', 'Rengar', 'Bedeviling Stranger']);
  const out = sent(aiAction(g, 0));
  assert.ok(out.includes(ids['Ruin Runner']) && out.includes(ids['Rengar']), JSON.stringify(out));
  assert.ok(!out.includes(ids['Gutter Guardian']) && !out.includes(ids['Bedeviling Stranger']));
});

test('Evelynn: Hold \'Em goes on the defender in the fight, not on Vex at the other battlefield', () => {
  const z = puzzle({ me: '03-evelynn.json', opp: '04-rek-sai.json', turn: 8 });
  z.runes(0, { Body: 3 }); z.runes(1, { Fury: 3, Order: 2 });
  z.at(0, 'Vex, Apathetic', 0); z.control(0, 0);
  const gg = z.at(0, 'Gutter Guardian', 1); z.control(1, 0);
  z.hand(0, ["Hold 'Em"]);
  const titan = z.base(1, 'Undertitan');
  oppTurn(z.g);
  const g = oppDoes(z.g, { type: 'move', player: 1, units: [titan], to: 1 });
  const r = aiUntilOppMain(g);
  assert.ok(r.names.includes("play Hold 'Em"), r.names.join(' | '));
  assert.ok(r.names.includes('choose Gutter Guardian'), r.names.join(' | '));
  assert.equal(r.state.objects[gg].zone, 'battlefield');
  assert.equal(r.state.battlefields[1].controller, 0, r.names.join(' | '));
});

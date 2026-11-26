// PILOT-B: Vex, Gloomist competence puzzles (docs/ai-pilots/vex.md). Real meta decks / cards; positions where a strong
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

test('Vex T4: Vex, Apathetic goes to the battlefield we hold (stun lock), and a Hidden card is hidden there', () => {
  const z = puzzle({ me: '02-vex.json', opp: '04-rek-sai.json', turn: 7 });
  z.runes(0, { Calm: 3, Chaos: 3 });
  z.at(0, 'Steel Paws', 0); z.control(0, 0);
  z.hand(0, ['Switcheroo', 'Scuttle Crab']);
  z.base(1, 'Carrion Dredger');
  const t = aiTurn(z.g, 0);
  assert.ok(t.names.includes('play Vex @0'), t.names.join(' | '));
  // (ENGINE-6: since auto-pay keeps a recycled rune's [1] (rules-decisions #65) the turn also fits Scuttle Crab, so the hidden card
  // may be another Hidden card — any hide at the held battlefield satisfies the plan)
  assert.ok(t.names.some(n => /^hide .+ @0$/.test(n)), t.names.join(' | '));
});

test('Vex: the Gloomist draw is always taken when we hold', () => {
  const z = puzzle({ me: '02-vex.json', opp: '04-rek-sai.json', turn: 6 });
  z.runes(0, { Calm: 2, Chaos: 2 });
  z.at(0, 'Scuttle Crab', 0); z.control(0, 0);
  oppTurn(z.g);
  let g = applyAction(z.g, { type: 'endTurn', player: 1 }).state;
  for (let i = 0; i < 20 && g.pending && !/Gloomist/.test(g.pending.prompt); i++) g = applyAction(g, fastPolicy(g, g.pending.player)!).state;
  assert.match(g.pending?.prompt ?? '', /Gloomist/);
  const hand0 = g.players[0].hand.length;
  const a = aiAction(g, 0);
  assert.deepEqual(sent(a), ['yes']);
  g = applyAction(g, a!).state;
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && !g.pending.inStep); i++) g = applyAction(g, g.pending.player === 0 ? aiAction(g, 0)! : fastPolicy(g, 1)!).state;
  assert.ok(g.players[0].hand.length >= hand0 + 2, 'Gloomist draw + draw step');
});

test('Vex: Defy counters Cull the Weak that would kill our only unit (Vex at the held battlefield)', () => {
  const z = puzzle({ me: '02-vex.json', opp: '04-rek-sai.json', turn: 8 });
  z.runes(0, { Calm: 2, Chaos: 2 }); z.runes(1, { Fury: 3, Order: 2 });
  const vex = z.at(0, 'Vex, Apathetic', 0); z.control(0, 0);
  z.hand(0, ['Defy']);
  z.base(1, 'Noxus Hopeful');
  const [cull] = z.hand(1, ['Cull the Weak']);
  oppTurn(z.g);
  const g = oppDoes(z.g, { type: 'playCard', player: 1, obj: cull });
  assert.equal(g.pending?.player, 0);
  const a = aiAction(g, 0);
  assert.ok(a && a.type === 'playCard' && nameOf(g, a.obj) === 'Defy', a ? describe(g, a) : 'null');
  const r = aiUntilOppMain(g);
  assert.equal(r.state.objects[vex].zone, 'battlefield', r.names.join(' | '));
});

test('Vex: facedown Tornado Warrior is revealed on defence and empowers Steel Paws (7 Might) to hold', () => {
  const z = puzzle({ me: '02-vex.json', opp: '04-rek-sai.json', turn: 8 });
  z.runes(0, { Calm: 2, Chaos: 2 }); z.runes(1, { Fury: 3, Order: 2 });
  const paws = z.at(0, 'Steel Paws', 0); z.control(0, 0);
  z.facedown(0, 'Tornado Warrior', 0, 6);
  const titan = z.base(1, 'Undertitan');
  oppTurn(z.g);
  const g = oppDoes(z.g, { type: 'move', player: 1, units: [titan], to: 0 });
  const r = aiUntilOppMain(g);
  assert.ok(r.names.some(n => /play Tornado Warrior/.test(n)), r.names.join(' | '));
  assert.ok(r.names.includes('choose Steel Paws'), r.names.join(' | '));
  assert.equal(r.state.objects[paws].zone, 'battlefield');
  assert.equal(r.state.battlefields[0].controller, 0, 'battlefield held');
});

test('Vex: Gust bounces the 3-Might attacker of our held battlefield', () => {
  const z = puzzle({ me: '02-vex.json', opp: '06-kai-sa.json', turn: 6 });
  z.runes(0, { Calm: 1, Chaos: 2 }); z.runes(1, { Fury: 3, Mind: 2 });
  z.at(0, 'Scuttle Crab', 0); z.control(0, 0);
  z.hand(0, ['Gust']);
  const u = z.base(1, 'Bilgewater Tracker');
  oppTurn(z.g);
  const g = oppDoes(z.g, { type: 'move', player: 1, units: [u], to: 0 });
  const r = aiUntilOppMain(g);
  assert.ok(r.names.includes('play Gust'), r.names.join(' | '));
  assert.equal(r.state.battlefields[0].controller, 0);
});

test('Vex: at 7 points a ready unit conquers the empty battlefield for the win', () => {
  const z = puzzle({ me: '02-vex.json', opp: '06-kai-sa.json', turn: 11 });
  z.runes(0, { Calm: 3, Chaos: 3 });
  z.points(0, 7); z.points(1, 6);
  z.base(0, 'Tornado Warrior');
  z.at(0, 'Steel Paws', 0); z.control(0, 0);
  z.hand(0, ['Defy', 'Discipline']);
  z.g.battlefields[0].scoredThisTurnBy = [0];      // already held this turn: the only point left is conquering battlefield 1
  const t = aiTurn(z.g, 0);
  assert.equal(t.state.winner, 0, t.names.join(' | '));
});

test('Vex: The Good Stuff is deployed at the battlefield we hold, never at an uncontrolled one', () => {
  const z = puzzle({ me: '02-vex.json', opp: '04-rek-sai.json', turn: 9 });
  z.runes(0, { Calm: 2, Chaos: 3 });
  z.at(0, 'Vex, Apathetic', 0); z.control(0, 0);
  z.hand(0, ['The Good Stuff', 'Kharox', 'Baron Nashor']);
  z.at(1, 'Carrion Dredger', 1); z.control(1, 1);
  const t = aiTurn(z.g, 0);
  const play = t.names.find(n => /^play The Good Stuff/.test(n));
  assert.ok(!play || play === 'play The Good Stuff @0', t.names.join(' | '));
  assert.ok(play, 'card draw used: ' + t.names.join(' | '));
});

test('Vex mulligan: keep the cheap holders, send back Baron Nashor and Astral Heron', () => {
  const { g, ids } = mulliganWith('02-vex.json', ['Baron Nashor', 'Steel Paws', 'Astral Heron', 'Scuttle Crab']);
  const out = sent(aiAction(g, 0));
  assert.ok(out.includes(ids['Baron Nashor']) && out.includes(ids['Astral Heron']), JSON.stringify(out));
  assert.ok(!out.includes(ids['Steel Paws']) && !out.includes(ids['Scuttle Crab']));
});

test('Vex: Switcheroo hidden at the battlefield wins the defence (swap Steel Paws 0 with the attacker)', () => {
  const z = puzzle({ me: '02-vex.json', opp: '04-rek-sai.json', turn: 8 });
  z.runes(0, { Calm: 1, Chaos: 1 }); z.runes(1, { Fury: 3, Order: 2 });
  z.at(0, 'Steel Paws', 0); z.at(0, 'Bedeviling Stranger', 0); z.control(0, 0);
  z.facedown(0, 'Switcheroo', 0, 6);
  const titan = z.base(1, 'Undertitan');
  oppTurn(z.g);
  const g = oppDoes(z.g, { type: 'move', player: 1, units: [titan], to: 0 });
  const r = aiUntilOppMain(g);
  assert.ok(r.names.some(n => /play Switcheroo/.test(n)), r.names.join(' | '));
  assert.equal(r.state.battlefields[0].controller, 0, r.names.join(' | '));
});

test('Vex: Rebuke clears the enemy holder (never our own Astral Heron), then a unit conquers', () => {
  const z = puzzle({ me: '02-vex.json', opp: '02-vex.json', turn: 11 });
  z.runes(0, { Calm: 2, Chaos: 3 });
  const heron = z.at(0, 'Astral Heron', 0); z.control(0, 0);
  z.g.battlefields[0].scoredThisTurnBy = [0];
  z.base(0, 'Tornado Warrior');
  const enemy = z.at(1, 'Astral Heron', 1); z.control(1, 1);
  z.hand(0, ['Rebuke']);
  const t = aiTurn(z.g, 0, { oppPass: true });
  assert.ok(t.names.includes('play Rebuke'), t.names.join(' | '));
  assert.equal(t.state.objects[heron].zone, 'battlefield', 'own Heron stays: ' + t.names.join(' | '));
  assert.notEqual(t.state.objects[enemy]?.zone, 'battlefield', t.names.join(' | '));
  assert.equal(t.state.battlefields[1].controller, 0, t.names.join(' | '));
});

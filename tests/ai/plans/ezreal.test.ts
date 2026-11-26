// PILOT-B: Ezreal, Prodigal Explorer competence puzzles (docs/ai-pilots/ezreal.md). Real meta decks / cards; positions where a strong
// player's move is clear. The AI under test is the default SearchAI with the registered deck plans.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { puzzle, aiTurn, aiAction, describe } from '../core/puzzle.ts';
import type { Action, CardDef, CardId, DeckList, GameState, ObjId, PlayerId } from '../../../src/engine/types.ts';
import { applyAction, createGame } from '../../../src/engine/index.ts';
import { fastPolicy } from '../../../src/ai/index.ts';
import { place } from '../../../src/engine/testkit.ts';

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
function oppCasts(g: GameState, obj: ObjId, prefer: ObjId[] = []): GameState {
  let s = applyAction(g, { type: 'playCard', player: 1, obj }).state;
  for (let i = 0; i < 12 && s.pending?.player === 1 && s.pending.inStep; i++) {
    const d = s.pending; const ids = (d.options ?? []).map(o => o.id);
    const pick = d.kind === 'payment' ? ['auto'] : (prefer.filter(x => ids.includes(x)).slice(0, Math.max(1, d.min ?? 1)));
    s = applyAction(s, { type: 'choose', player: 1, optionIds: pick.length ? pick : ids.slice(0, Math.max(0, d.min ?? 1)) }).state;
  }
  return oppDoes(s, { type: 'pass', player: 1 });
}

test('Ezreal: Bellows Breath finishes two damaged enemy units, then the legend draws (two enemy choices this turn)', () => {
  const z = puzzle({ me: '12-ezreal.json', opp: '04-rek-sai.json', turn: 7 });
  z.runes(0, { Mind: 2 });
  z.at(1, 'Bilgewater Tracker', 1, { damage: 2 }); z.at(1, 'Bilgewater Tracker', 1, { damage: 2 }); z.control(1, 1);
  z.hand(0, ['Bellows Breath']);
  const t = aiTurn(z.g, 0, { oppPass: true });
  assert.ok(t.names.includes('play Bellows Breath'), t.names.join(' | '));
  assert.ok(t.names.some(n => /^activate Prodigal Explorer/.test(n)), t.names.join(' | '));
});

test('Ezreal: Wages of Pain clears the 3-Might holder, then Bewitching Spirit conquers the battlefield', () => {
  const z = puzzle({ me: '12-ezreal.json', opp: '04-rek-sai.json', turn: 9 });
  z.runes(0, { Mind: 2, Chaos: 1 });
  z.base(0, 'Bewitching Spirit');
  z.at(1, 'Bilgewater Tracker', 1); z.control(1, 1);
  z.hand(0, ['Wages of Pain']);
  const t = aiTurn(z.g, 0, { oppPass: true });
  assert.ok(t.names.includes('play Wages of Pain'), t.names.join(' | '));
  assert.equal(t.state.battlefields[1].controller, 0, t.names.join(' | '));
});

test('Ezreal: Thousand-Tailed Watcher (-3) then Bellows Breath wipes three enemy units at their base', () => {
  const z = puzzle({ me: '12-ezreal.json', opp: '04-rek-sai.json', turn: 15 });
  z.runes(0, { Mind: 6, Chaos: 4 });
  const es = [z.base(1, 'Noxus Hopeful'), z.base(1, 'Bilgewater Tracker'), z.base(1, 'Faithful Manufactor')];   // at their base: no attack reaches them
  z.hand(0, ['Thousand-Tailed Watcher', 'Bellows Breath']);
  const t = aiTurn(z.g, 0, { oppPass: true });
  const w = t.names.findIndex(n => /^play Thousand-Tailed Watcher/.test(n)), b = t.names.indexOf('play Bellows Breath');
  assert.ok(w >= 0 && b > w, t.names.join(' | '));
  assert.equal(es.filter(id => t.state.objects[id]?.zone === 'base').length, 0, t.names.join(' | '));
});

test('Ezreal: Fizz recasts Wages of Pain from the trash on the enemy holder', () => {
  const z = puzzle({ me: '12-ezreal.json', opp: '06-kai-sa.json', turn: 9 });
  z.runes(0, { Chaos: 3, Mind: 1 });
  place(z.g, 0, z.id('Wages of Pain'), 'trash');
  const u = z.at(1, 'Bilgewater Tracker', 1); z.control(1, 1);
  z.hand(0, ['Fizz, Trickster']);
  const t = aiTurn(z.g, 0, { oppPass: true });
  assert.ok(t.names.some(n => /^play Fizz/.test(n)), t.names.join(' | '));
  assert.ok(t.names.includes('choose Wages of Pain'), t.names.join(' | '));
  assert.notEqual(t.state.objects[u]?.zone, 'battlefield', t.names.join(' | '));
});

test('Ezreal: Stupefy wins the even defence of our battlefield', () => {
  const z = puzzle({ me: '12-ezreal.json', opp: '06-kai-sa.json', turn: 8 });
  z.runes(0, { Mind: 1 }); z.runes(1, { Fury: 3, Mind: 2 });
  z.at(0, 'Fizz, Trickster', 0); z.control(0, 0);
  z.hand(0, ['Stupefy']);
  const u = z.base(1, 'Bilgewater Tracker');
  oppTurn(z.g);
  const g = oppDoes(z.g, { type: 'move', player: 1, units: [u], to: 0 });
  const r = aiUntilOppMain(g);
  assert.ok(r.names.includes('play Stupefy'), r.names.join(' | '));
  assert.equal(r.state.battlefields[0].controller, 0, r.names.join(' | '));
});

test('Ezreal: Hard Bargain counters a tapped-out Time Warp', () => {
  const z = puzzle({ me: '12-ezreal.json', opp: '06-kai-sa.json', turn: 12 });
  z.runes(0, { Chaos: 2 }); z.runes(1, { Fury: 6, Mind: 4 });            // exactly Time Warp's 10 energy (+4 power recycled): tapped out
  z.at(0, 'Fizz, Trickster', 0); z.control(0, 0);
  z.hand(0, ['Hard Bargain']);
  const [tw] = z.hand(1, ['Time Warp']);
  oppTurn(z.g);
  const g = oppCasts(z.g, tw);
  assert.equal(g.pending?.player, 0, g.pending?.prompt ?? '');
  const a = aiAction(g, 0);
  assert.ok(a && a.type === 'playCard' && nameOf(g, a.obj) === 'Hard Bargain', a ? describe(g, a) : 'null');
});

test('Ezreal: at 7 points, attack the 3-Might holder with Fizz and Stupefy it for the winning conquer', () => {
  const z = puzzle({ me: '12-ezreal.json', opp: '06-kai-sa.json', turn: 11 });
  z.runes(0, { Mind: 1, Chaos: 1 });
  z.points(0, 7); z.points(1, 6);
  z.base(0, 'Fizz, Trickster');
  z.at(0, 'Bewitching Spirit', 0); z.control(0, 0);
  z.g.battlefields[0].scoredThisTurnBy = [0];
  z.at(1, 'Bilgewater Tracker', 1); z.control(1, 1);
  z.hand(0, ['Stupefy']);
  const t = aiTurn(z.g, 0, { oppPass: true });
  assert.equal(t.state.winner, 0, t.names.join(' | '));
});

test('Ezreal mulligan: keep cheap removal, send back Singularity and Thousand-Tailed Watcher', () => {
  const { g, ids } = mulliganWith('12-ezreal.json', ['Singularity', 'Stupefy', 'Thousand-Tailed Watcher', 'Wages of Pain']);
  const out = sent(aiAction(g, 0));
  assert.ok(out.includes(ids['Singularity']) && out.includes(ids['Thousand-Tailed Watcher']), JSON.stringify(out));
  assert.ok(!out.includes(ids['Stupefy']) && !out.includes(ids['Wages of Pain']));
});

// PILOT-B: Irelia, Blade Dancer competence puzzles (docs/ai-pilots/irelia.md). Real meta decks / cards; positions where a strong
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

test('Irelia: after a conquer, pay [1] to ready Blade Dancer', () => {
  const z = puzzle({ me: '09-irelia.json', opp: '06-kai-sa.json', turn: 9 });
  z.runes(0, { Calm: 2, Chaos: 2 });
  z.g.objects[z.legend(0)].exhausted = true;
  z.base(0, 'Irelia, Fervent');
  z.hand(0, ['Discipline']);
  const t = aiTurn(z.g, 0, { oppPass: true });
  assert.ok(t.names.some(n => /^move Irelia -> \d/.test(n)), t.names.join(' | '));
  const conquered = t.state.battlefields.some(b => b.controller === 0);
  assert.ok(conquered, t.names.join(' | '));
  const i = t.log.findIndex(l => /Blade Dancer/.test(l) && /ready/i.test(l));
  assert.ok(i >= 0 || !t.state.objects[z.legend(0)].exhausted, 'legend re-armed: ' + t.names.join(' | '));
});

test('Irelia: Not So Fast counters Falling Star aimed at Irelia', () => {
  const z = puzzle({ me: '09-irelia.json', opp: '06-kai-sa.json', turn: 8 });
  z.runes(0, { Calm: 2, Chaos: 1 }); z.runes(1, { Fury: 4, Mind: 2 });
  const ire = z.at(0, 'Irelia, Fervent', 0); z.control(0, 0);
  z.hand(0, ['Not So Fast']);
  const [fs] = z.hand(1, ['Falling Star']);
  oppTurn(z.g);
  let g = applyAction(z.g, { type: 'playCard', player: 1, obj: fs }).state;
  for (let i = 0; i < 12 && g.pending?.player === 1 && g.pending.inStep; i++) {
    const d = g.pending;
    const ids = (d.options ?? []).map(o => o.id);
    g = applyAction(g, { type: 'choose', player: 1, optionIds: (d.kind === 'payment' ? ['auto'] : ids.includes(ire) ? [ire] : [ids[0]]) as string[] }).state;
  }
  g = oppDoes(g, { type: 'pass', player: 1 });
  assert.equal(g.pending?.player, 0, g.pending?.prompt ?? '');
  const r = aiUntilOppMain(g);
  assert.ok(r.names.includes('play Not So Fast'), r.names.join(' | '));
  assert.equal(r.state.objects[ire].zone, 'battlefield');
});

test('Irelia: Guardian Angel is equipped on Irelia, not on Scuttle Crab', () => {
  const z = puzzle({ me: '09-irelia.json', opp: '04-rek-sai.json', turn: 9 });
  z.runes(0, { Calm: 3, Chaos: 1 });
  z.at(0, 'Irelia, Fervent', 0); z.at(0, 'Scuttle Crab', 1); z.control(0, 0); z.control(1, 0);
  z.g.battlefields.forEach(b => { b.scoredThisTurnBy = [0]; });
  z.hand(0, ['Guardian Angel']);
  const t = aiTurn(z.g, 0, { oppPass: true });
  const ga = Object.values(t.state.objects).find(o => nameOf(t.state, o.id) === 'Guardian Angel' && o.attachedTo);
  assert.ok(ga, 'equipped: ' + t.names.join(' | '));
  assert.equal(nameOf(t.state, ga!.attachedTo!), 'Irelia', t.names.join(' | '));
});

test('Irelia: Defiant Dance wins the defence of the held battlefield', () => {
  const z = puzzle({ me: '09-irelia.json', opp: '04-rek-sai.json', turn: 8 });
  z.runes(0, { Calm: 1, Chaos: 1 }); z.runes(1, { Fury: 3, Order: 2 });
  z.at(0, 'Irelia, Fervent', 0); z.control(0, 0);
  z.hand(0, ['Defiant Dance']);
  const titan = z.base(1, 'Undertitan');
  oppTurn(z.g);
  const g = oppDoes(z.g, { type: 'move', player: 1, units: [titan], to: 0 });
  const r = aiUntilOppMain(g);
  assert.ok(r.names.includes('play Defiant Dance'), r.names.join(' | '));
  assert.equal(r.state.battlefields[0].controller, 0, r.names.join(' | '));
});

test('Irelia: at 7 points, Irelia attacks the 5-Might holder with Discipline for the winning conquer', () => {
  const z = puzzle({ me: '09-irelia.json', opp: '04-rek-sai.json', turn: 11 });
  z.runes(0, { Calm: 2, Chaos: 1 });
  z.points(0, 7); z.points(1, 6);
  z.base(0, 'Irelia, Fervent');
  z.at(0, 'Scuttle Crab', 0); z.control(0, 0);
  z.g.battlefields[0].scoredThisTurnBy = [0];
  z.at(1, 'Undertitan', 1); z.control(1, 1);
  z.hand(0, ['Discipline']);
  const t = aiTurn(z.g, 0, { oppPass: true });
  assert.equal(t.state.winner, 0, t.names.join(' | '));
});

test('Irelia: Defy is saved, not spent on the opponent\'s cantrip Stupefy', () => {
  const z = puzzle({ me: '09-irelia.json', opp: '06-kai-sa.json', turn: 8 });
  z.runes(0, { Calm: 2, Chaos: 1 }); z.runes(1, { Fury: 3, Mind: 2 });
  const crab = z.at(0, 'Scuttle Crab', 0); z.control(0, 0);
  z.at(0, 'Irelia, Fervent', 0);
  z.hand(0, ['Defy']);
  const [st] = z.hand(1, ['Stupefy']);
  oppTurn(z.g);
  let g = applyAction(z.g, { type: 'playCard', player: 1, obj: st }).state;
  for (let i = 0; i < 12 && g.pending?.player === 1 && g.pending.inStep; i++) {
    const d = g.pending; const ids = (d.options ?? []).map(o => o.id);
    g = applyAction(g, { type: 'choose', player: 1, optionIds: (d.kind === 'payment' ? ['auto'] : ids.includes(crab) ? [crab] : [ids[0]]) as string[] }).state;
  }
  g = oppDoes(g, { type: 'pass', player: 1 });
  assert.equal(g.pending?.player, 0, g.pending?.prompt ?? '');
  const a = aiAction(g, 0);
  assert.equal(a?.type, 'pass', a ? describe(g, a) : 'null');
});

test('Irelia T5+: Irelia, Fervent comes down from the champion zone', () => {
  const z = puzzle({ me: '09-irelia.json', opp: '04-rek-sai.json', turn: 9 });
  z.runes(0, { Calm: 3, Chaos: 3 });
  z.at(0, 'Scuttle Crab', 0); z.control(0, 0);
  z.at(1, 'Carrion Dredger', 1); z.control(1, 1);
  z.hand(0, ['Defy', 'Find Your Center']);
  const t = aiTurn(z.g, 0, { oppPass: true });
  assert.ok(t.names.some(n => /^play Irelia/.test(n)), t.names.join(' | '));
});

test('Irelia mulligan: keep the cheap holders, send back Astral Heron and Rebuke', () => {
  const { g, ids } = mulliganWith('09-irelia.json', ['Astral Heron', 'Scuttle Crab', 'Rebuke', 'Tideturner']);
  const out = sent(aiAction(g, 0));
  assert.ok(out.includes(ids['Astral Heron']) && out.includes(ids['Rebuke']), JSON.stringify(out));
  assert.ok(!out.includes(ids['Scuttle Crab']) && !out.includes(ids['Tideturner']));
});

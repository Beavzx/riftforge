// COACH tests: labels, analyse(), hand reads, win probability, game records + review, and "SearchAI plays unchanged".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGame, applyAction, getLegalActions } from '../../../src/engine/index.ts';
import type { Action, GameState, PlayerId } from '../../../src/engine/types.ts';
import { SearchAI, fastPolicy } from '../../../src/ai/index.ts';
import { analyse, labelAction, describeSituation, handReads, categoriesOf, winProb, looseKey } from '../../../src/ai/coach/index.ts';
import { WIN } from '../../../src/ai/eval.ts';
import { newRecord, finishRecord, RECORD_FORMAT } from '../../../src/net/record.ts';
import { review, normalizeRecord, toMarkdown, simulate } from '../../../tools/review.ts';
import { cardDb, loadMetaDecks } from '../../../tools/sim-lib.ts';

const decks = loadMetaDecks();
const setupFor = (seed: number, a = 0, b = 1) => ({ seed, cardDb: cardDb(), battlefieldSelection: 'random' as const, firstPlayer: 0 as PlayerId, enforceBanlist: false,
  players: [{ name: 'A', deck: decks[a].deck }, { name: 'B', deck: decks[b].deck }] });

/** bot-vs-bot until `turn` (or the end), calling `visit` on every state before acting */
function playTo(seed: number, turn: number, visit?: (g: GameState) => void, a = 0, b = 1): GameState {
  let g = createGame(setupFor(seed, a, b));
  for (let i = 0; i < 3000 && g.winner === null && g.turn < turn; i++) {
    visit?.(g);
    const p = g.pending!.player;
    g = applyAction(g, fastPolicy(g, p)!).state;
  }
  return g;
}

test('labelAction: every legal action of many positions gets a readable label', () => {
  let n = 0;
  const kinds = new Set<string>();
  for (const seed of [1, 2, 3]) {
    playTo(seed, 9, g => {
      const d = g.pending!;
      for (const a of getLegalActions(g, d.player)) {
        const s = labelAction(g, a, d);
        assert.ok(s.length > 0, 'empty label');
        assert.ok(!/undefined|\[object|NaN/.test(s), `bad label: ${s}`);
        kinds.add(a.type); n++;
      }
    }, seed % decks.length, (seed + 4) % decks.length);
  }
  assert.ok(n > 200, `only ${n} labels`);
  for (const k of ['playCard', 'move', 'pass', 'endTurn', 'choose']) assert.ok(kinds.has(k), `no ${k} seen`);
});

test('labelAction: synthetic actions of every type', () => {
  const g = playTo(4, 4);
  const p = g.pending!.player;
  const unit = Object.values(g.objects).find(o => o.controller === p && (o.zone === 'base' || o.zone === 'battlefield'))?.id ?? g.players[p].legend;
  const rune = g.players[p].runesInPlay[0];
  const hand = g.players[p].hand[0];
  const acts: Action[] = [
    { type: 'playCard', player: p, obj: hand, destination: 0, payment: { exhaust: [rune], recycle: [] } },
    { type: 'activate', player: p, obj: g.players[p].legend, abilityIndex: 0 },
    { type: 'activate', player: p, obj: rune, abilityIndex: 950 },
    { type: 'move', player: p, units: [unit], to: 1 },
    { type: 'hide', player: p, obj: hand, battlefieldIndex: 0 },
    { type: 'pass', player: p }, { type: 'endTurn', player: p }, { type: 'concede', player: p }, { type: 'cancel', player: p },
    { type: 'assignDamage', player: p, assignment: { [unit]: 3 } },
    { type: 'choose', player: p, optionIds: [] },
  ];
  for (const a of acts) {
    const s = labelAction(g, a, null);
    assert.ok(s.length > 0 && !/undefined/.test(s), `${a.type}: ${s}`);
  }
  assert.match(labelAction(g, acts[0], null), /^Play .+ to Battlefield 1 \(.+\), paying by exhausting/);
  assert.match(labelAction(g, acts[3], null), /^Move .+ to Battlefield 2/);
  const sit = describeSituation(g, p);
  assert.match(sit, /Points: you \d+, opponent \d+/);
  // the opponent's hand is never named
  for (const id of g.players[1 - p].hand) {
    const nm = g.cards[g.objects[id].cardId].name;
    if (!g.players[p].hand.some(x => g.cards[g.objects[x].cardId].name === nm) && !Object.values(g.objects).some(o => o.zone !== 'hand' && o.zone !== 'mainDeck' && o.zone !== 'facedown' && g.cards[o.cardId]?.name === nm))
      assert.ok(!sit.includes(nm), `situation leaks opponent card ${nm}`);
  }
});

function firstDecision(seed: number, pred: (g: GameState) => boolean, turnCap = 12): GameState | null {
  let found: GameState | null = null;
  playTo(seed, turnCap, g => { if (!found && pred(g)) found = g; });
  return found;
}

test('analyse: ranked candidates, includes the played move, no mutation, deterministic', () => {
  const g = firstDecision(5, x => x.turn >= 3 && !x.pending!.inStep && x.pending!.kind === 'mainAction' && getLegalActions(x, x.pending!.player).filter(a => a.type !== 'activate').length > 3)!;
  assert.ok(g, 'no main decision found');
  const p = g.pending!.player;
  const played = getLegalActions(g, p).find(a => a.type === 'move') ?? getLegalActions(g, p).find(a => a.type === 'endTurn')!;
  const before = JSON.stringify({ ...g, cards: 0 });
  const opts = { determinizations: 1, contNodes: 25, maxCandidates: 5, handSamples: 40, include: [played], seed: 3 };
  const an = analyse(g, p, opts);
  assert.equal(JSON.stringify({ ...g, cards: 0 }), before, 'analyse mutated the state');
  assert.equal(an.trivial, false);
  assert.ok(an.candidates.length >= 2);
  const valid = an.candidates.filter(c => !c.invalid);
  for (let i = 1; i < valid.length; i++) assert.ok(valid[i - 1].score >= valid[i].score, 'not ranked');
  assert.equal(an.best, valid[0]);
  assert.ok(an.candidates.some(c => c.included && looseKey(g, c.action) === looseKey(g, played)), 'played move not scored');
  for (const c of an.candidates) assert.ok(c.winProb >= 0 && c.winProb <= 1);
  assert.ok(an.candidates.some(c => c.action.type === 'endTurn'), 'end turn is always a candidate in the main phase');
  assert.ok(an.expectedLine.length > 0 && an.expectedLine[0].by === 'you');
  assert.ok(an.handReads && an.handReads.samples > 0);
  const again = analyse(g, p, opts);
  assert.deepEqual(again.candidates.map(c => [c.label, c.score]), an.candidates.map(c => [c.label, c.score]), 'not deterministic');
});

test('analyse: response window on the opponent turn and in-step choices', () => {
  const resp = firstDecision(6, x => x.turn >= 2 && !x.pending!.inStep && x.pending!.kind === 'chainResponse' && x.activePlayer !== x.pending!.player
    && getLegalActions(x, x.pending!.player).filter(a => a.type !== 'pass' && !(a.type === 'activate' && a.abilityIndex >= 950)).length > 0, 16);
  if (resp) {
    const an = analyse(resp, resp.pending!.player, { determinizations: 1, contNodes: 20, handSamples: 0 });
    assert.equal(an.trivial, false);
    assert.ok(an.candidates.some(c => c.action.type === 'pass'));
  }
  const ins = firstDecision(7, x => !!x.pending!.inStep && x.pending!.kind === 'chooseTargets' && (x.pending!.options ?? []).length > 1, 16);
  assert.ok(ins, 'no in-step decision found');
  const an = analyse(ins!, ins!.pending!.player, { determinizations: 1, contNodes: 20, handSamples: 0 });
  assert.ok(an.candidates.length > 1 && an.candidates.every(c => c.action.type === 'choose'));
  assert.ok(an.candidates.every(c => /^Target: /.test(c.label)), an.candidates.map(c => c.label).join(' / '));
});

test('analyse: trivial and foreign decisions', () => {
  const g = playTo(8, 3);
  const other = (1 - g.pending!.player) as PlayerId;
  assert.equal(analyse(g, other).trivial, true);
});

test('handReads: probabilities are consistent with the hand size and only use public information', () => {
  const g = playTo(9, 5);
  const p = 0 as PlayerId;
  const r = handReads(g, p, 150, 1);
  assert.equal(r.samples, 150);
  const expected = r.cards.reduce((s, c) => s + c.expected, 0);
  assert.ok(Math.abs(expected - r.handSize) < 1e-9, `expected sum ${expected} vs ${r.handSize}`);
  for (const c of r.cards) assert.ok(c.pAtLeastOne > 0 && c.pAtLeastOne <= 1);
  for (const c of r.categories) assert.ok(c.pAtLeastOne >= 0 && c.pAtLeastOne <= 1);
  // the read depends only on what p can see: permuting the opponent's hidden cards does not change it
  const g2 = structuredClone(g);
  const q = 1 - p;
  const hidden = [...g2.players[q].hand, ...g2.players[q].mainDeck];
  const cids = hidden.map(id => g2.objects[id].cardId).reverse();
  hidden.forEach((id, i) => { g2.objects[id].cardId = cids[i]; });
  // (same distribution, different samples: same card pool, probabilities within sampling noise)
  const r2 = handReads(g2, p, 150, 1);
  assert.deepEqual(r2.cards.map(c => c.cardId).sort(), r.cards.map(c => c.cardId).sort());
  for (const c of r.cards) assert.ok(Math.abs(c.pAtLeastOne - r2.cards.find(x => x.cardId === c.cardId)!.pAtLeastOne) < 0.2, c.name);
});

test('categoriesOf: removal / trick / reaction / counter heuristics', () => {
  const db = cardDb();
  const byName = (n: string) => Object.values(db).find(c => c.name === n)!;
  assert.ok(categoriesOf(byName('Hidden Blade')).includes('removal'));
  assert.ok(!categoriesOf(byName('Deathgrip')).includes('removal'), 'killing your own unit is not removal');
  assert.ok(categoriesOf(byName('Defy')).includes('counter'));
  assert.ok(categoriesOf(byName('Defy')).includes('reaction'));
  assert.ok(categoriesOf(byName('Punch First')).includes('combatTrick'));
});

test('winProb: monotone, bounded, wins and losses are certain', () => {
  assert.equal(winProb(WIN), 1);
  assert.equal(winProb(-WIN), 0);
  let prev = -1;
  for (let e = -150; e <= 150; e += 5) { const p = winProb(e); assert.ok(p > prev && p > 0 && p < 1); prev = p; }
});

test('records: a simulated game record replays exactly and reviews end to end', () => {
  const rec = simulate(13, ['01-azir.json', '02-vex.json'], 'bot', 'bot');
  assert.equal(rec.format, RECORD_FORMAT);
  assert.ok(rec.result && rec.actions.length > 30);
  // round trip through JSON, then replay
  const back = normalizeRecord(JSON.parse(JSON.stringify(rec)));
  let g = createGame({ ...back.setup, cardDb: cardDb() } as Parameters<typeof createGame>[0]);
  for (const a of back.actions) g = applyAction(g, a).state;
  assert.equal(g.winner, rec.result!.winner);
  assert.deepEqual(g.players.map(p => p.points), rec.result!.points);
  // review the first part of the game (keeps the test fast)
  const short = { ...back, actions: back.actions.slice(0, 70) };
  const r = review(short, 0, 'low', 3);
  assert.ok(r.stats.analysed > 3, `analysed ${r.stats.analysed}`);
  for (const d of r.decisions) { assert.ok(d.cost >= 0 && d.cost <= 1); assert.ok(d.played, 'played move missing'); }
  assert.ok(r.mistakes.every((m, i) => i === 0 || r.mistakes[i - 1].cost >= m.cost));
  const md = toMarkdown(r);
  assert.match(md, /^# Game review:/);
  assert.match(md, /## All analysed decisions/);
});

test('records: fuzz-repro style input is accepted', () => {
  const rec = normalizeRecord({ spec: { seed: 3, decks: [decks[0].deck, decks[1].deck], battlefieldSelection: 'random' }, actions: [] });
  assert.equal(rec.setup.seed, 3);
  const rec2 = normalizeRecord({ seed: 4, decks: ['01-azir', '02-vex.json'], actions: [] });
  assert.equal(rec2.setup.players.length, 2);
  const nr = finishRecord(newRecord(setupFor(5), 'local', 0), createGame(setupFor(5)));
  assert.equal(nr.you, 0);
  assert.ok(!('cardDb' in nr.setup));
});

// ---------------------------------------------------------------- SearchAI plays exactly as before

function searchGameHash(seed: number, turns: number, interleave: boolean): string {
  let g = createGame(setupFor(seed, 2, 5));
  const ais = [new SearchAI({ seed: seed * 2 + 1 }), new SearchAI({ seed: seed * 2 + 2 })];
  const log: string[] = [];
  for (let i = 0; i < 2000 && g.winner === null && g.turn <= turns; i++) {
    const p = g.pending!.player;
    if (interleave && i % 3 === 0) analyse(g, p, { determinizations: 1, contNodes: 10, maxCandidates: 3, handSamples: 10 });
    let a = ais[p].choose(g, p);
    if (!a) a = getLegalActions(g, p)[0];
    log.push(JSON.stringify(a));
    g = applyAction(g, a!).state;
  }
  return createHash('sha256').update(log.join('\n')).digest('hex').slice(0, 16);
}

// Golden hash recorded on the baseline commit (before the coach code existed): SearchAI's moves must not change.
const GOLDEN_SEARCH_HASH = '69813931cc06dc26';

test('SearchAI: same seed -> same moves as the baseline, and analyse() calls do not disturb it', () => {
  const h = searchGameHash(31, 5, false);
  assert.equal(h, GOLDEN_SEARCH_HASH, 'SearchAI choices changed');
  assert.equal(searchGameHash(31, 5, true), h, 'interleaved analyse() changed SearchAI choices');
});

// AI-CORE: unit tests of the core AI (turn planner, payments, replay, evaluation features, responses).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLegalActions, applyAction } from '../../../src/engine/index.ts';
import type { GameState } from '../../../src/engine/types.ts';
import { SearchAI, evaluate, setPlansEnabled } from '../../../src/ai/index.ts';
import { improvePayment } from '../../../src/ai/core/policy.ts';
import { stateSig } from '../../../src/ai/core/hash.ts';
import { determinize } from '../../../src/ai/determinize.ts';
import { makeRng } from '../../../src/engine/rng.ts';
import { puzzle, aiTurn } from './puzzle.ts';

// core behaviour is tested without the pilots' plans (they change independently)
setPlansEnabled(false);

test('payment: a spell uses Kai\'Sa\'s free [T]: Add [A] instead of recycling a rune', () => {
  const z = puzzle({ me: '06-kai-sa.json', opp: '02-vex.json' });
  z.runes(0, { Fury: 3, Mind: 2 });
  const [ray] = z.hand(0, ['Hextech Ray']);
  z.at(1, 'Tornado Warrior', 0);
  const a = getLegalActions(z.g, 0).find(x => x.type === 'playCard' && x.obj === ray)!;
  const b = improvePayment(z.g, 0, a);
  // (ENGINE-6: the engine's auto-pay now prefers a free exhaust-only Add over a recycle itself — AUTO-AUDIT AP-1 — so the pilot may
  // leave the payment to it; either way no rune is recycled)
  assert.ok(b.type === 'playCard');
  if (b.type === 'playCard' && b.payment) assert.equal(b.payment.recycle.length, 0, 'no rune recycled');
  const g = applyAction(z.g, b).state;
  assert.equal(g.players[0].runesInPlay.length, 5, 'all 5 runes still in play');
  assert.equal(g.objects[z.legend(0)].exhausted, true, 'legend exhausted for the [A]');
});

test('turn plan: removal THEN attack for the winning point (two-step lethal)', () => {
  const z = puzzle({ me: '06-kai-sa.json', opp: '02-vex.json', turn: 9 });
  z.runes(0, { Fury: 2 });
  z.hand(0, ['Hextech Ray']);
  z.base(0, 'Plundering Poro');                  // 2 Might
  z.at(1, 'Tornado Warrior', 0);                 // 3 Might blocker
  z.points(0, 7);
  z.control(1, 0); z.at(0, 'Watchful Sentry', 1);
  z.g.battlefields[1].scoredThisTurnBy = [0];    // held this turn: the conquer is the final point
  const t = aiTurn(z.g, 0, { oppPass: true });
  assert.equal(t.state.winner, 0, `expected a win, line: ${t.names.join(' | ')}`);
  // either line wins: Ray first then attack, or attack and Ray (an [Action]) in the showdown
  assert.ok(t.names.some(n => n.startsWith('play Hextech Ray')), t.names.join(' | '));
});

test('turn plan: final point rule — at victory-1 with nothing scored this turn, a conquer is not lethal; keep the board', () => {
  const z = puzzle({ me: '06-kai-sa.json', opp: '02-vex.json', turn: 9 });
  z.runes(0, { Fury: 2 });
  z.points(0, 7);
  z.base(0, 'Noxus Hopeful');
  const g = z.g;
  // evaluation: a projected conquer at 7 points without another score this turn does not reach 8
  const v = evaluate(g, 0);
  assert.ok(v < 100000);
  const t = aiTurn(g, 0, { oppPass: true });
  assert.notEqual(t.state.winner, 0);
});

test('replay: the AI follows its own turn line (no re-plan when the game goes as predicted)', () => {
  const z = puzzle({ me: '06-kai-sa.json', opp: '02-vex.json', turn: 7, noChampion: true });
  z.runes(0, { Fury: 4, Mind: 2 });
  z.hand(0, ['Plundering Poro', 'Watchful Sentry', 'Bilgewater Tracker']);
  const ai = new SearchAI({ seed: 3 });
  let g: GameState = z.g;
  for (let i = 0; i < 40 && g.winner === null; i++) {
    const d = g.pending!;
    if (d.player !== 0 && !d.inStep && d.kind === 'mainAction') break;
    const a = d.player === 0 ? ai.choose(g, 0)! : { type: 'pass' as const, player: d.player };
    g = applyAction(g, a).state;
  }
  assert.equal(ai.stats.plans, 1, `one plan (plans ${ai.stats.plans}, replays ${ai.stats.replays}, deviations ${ai.stats.deviations})`);
  assert.ok(ai.stats.replays! >= 3);
  assert.ok(Object.values(g.objects).filter(o => o.controller === 0 && (o.zone === 'base' || o.zone === 'battlefield') && g.cards[o.cardId].type === 'Unit').length >= 2, 'developed the board');
});

test('signature: a determinized state hashes like the real one from the decider\'s point of view', () => {
  const z = puzzle({ me: '06-kai-sa.json', opp: '02-vex.json', turn: 7 });
  z.runes(0, { Fury: 3 });
  z.hand(0, ['Hextech Ray']); z.hand(1, ['Defy', 'Pyke']);
  const d = determinize(z.g, 0, makeRng(5));
  assert.equal(stateSig(d, 0), stateSig(z.g, 0));
});

test('responses: counter the spell that would kill our best unit (Vex: Defy)', () => {
  const z = puzzle({ me: '02-vex.json', opp: '06-kai-sa.json', turn: 8 });
  // player 1 (Kai'Sa) is active and casts Hextech Ray at player 0's Tornado Warrior; player 0 holds Defy with 2 runes open
  const g = z.g;
  g.activePlayer = 1; g.pending = { kind: 'mainAction', player: 1, prompt: 'Your turn', inStep: false };
  z.runes(0, { Calm: 2, Chaos: 1 }); z.runes(1, { Fury: 3 });
  const blitz = z.at(0, 'Tornado Warrior', 0); z.control(0, 0);   // 3 Might: Hextech Ray (3 damage) kills it
  z.hand(0, ['Defy']);
  const [ray] = z.hand(1, ['Hextech Ray']);
  let s = applyAction(g, getLegalActions(g, 1).find(a => a.type === 'playCard' && a.obj === ray)!).state;
  for (let i = 0; i < 6 && s.pending?.player === 1 && s.pending.inStep; i++) {
    const t = s.pending.options!.find(o => o.id === blitz) ?? s.pending.options![0];
    s = applyAction(s, { type: 'choose', player: 1, optionIds: [t.id] }).state;
  }
  // Kai'Sa holds priority after casting: pass to player 0
  if (s.pending?.player === 1 && s.pending.kind === 'chainResponse') s = applyAction(s, { type: 'pass', player: 1 }).state;
  assert.equal(s.pending?.player, 0, `player 0 to respond (${s.pending?.kind})`);
  const a = new SearchAI({ seed: 1 }).choose(s, 0)!;
  assert.equal(a.type, 'playCard', `expected Defy, got ${JSON.stringify(a)}`);
  assert.equal(s.cards[s.objects[(a as { obj: string }).obj].cardId].name, 'Defy');
});

test('horizon: a long turn is not cut short by the search horizon (all five cheap units get played)', () => {
  const z = puzzle({ me: '06-kai-sa.json', opp: '02-vex.json', turn: 9, noChampion: true });
  z.runes(0, { Fury: 7, Mind: 4 });
  z.hand(0, ['Plundering Poro', 'Watchful Sentry', 'Plundering Poro', 'Watchful Sentry', 'Bilgewater Tracker']);
  const t = aiTurn(z.g, 0, { oppPass: true });
  const plays = t.names.filter(n => n.startsWith('play '));
  assert.ok(plays.length >= 4, `played ${plays.length}: ${t.names.join(' | ')}`);
});

test('projection: one unit cannot conquer two battlefields next turn', () => {
  const mk = (n: number) => {
    const z = puzzle({ me: '06-kai-sa.json', opp: '02-vex.json', turn: 9, noChampion: true });
    z.runes(0, { Fury: 2 }); z.runes(1, { Calm: 2 });
    for (let i = 0; i < n; i++) z.base(0, 'Plundering Poro');
    return evaluate(z.g, 0);
  };
  const one = mk(1), two = mk(2), three = mk(3);
  // the 2nd Poro adds a second projected conquer, the 3rd only a body
  assert.ok(two - one > three - two + 3, `marginal values ${(two - one).toFixed(2)} vs ${(three - two).toFixed(2)}`);
});

test('Weaponmaster: a new Sand Soldier never takes an Equipment off another unit (no [C] churn)', () => {
  const z = puzzle({ me: '01-azir.json', opp: '02-vex.json', turn: 9, noChampion: true });
  z.runes(0, { Calm: 4, Order: 3 });
  z.hand(0, ["Doran's Shield"]);
  const old = z.token(0, 'Sand Soldier', 0);
  const brut = z.base(0, 'Brutalizer');
  z.equip(brut, old);
  z.control(0, 0);
  const t = aiTurn(z.g, 0, { oppPass: true });
  assert.equal(t.state.objects[brut].attachedTo, old, `Brutalizer stays on its Soldier: ${t.names.join(' | ')}`);
});

// ---- AI-CORE-2: attack-from-base model (siege, over-defence, stuns) ----

test('projection: a unit stunned this turn (e.g. played under the enemy Vex) still attacks next turn', () => {
  const mk = (stun: boolean) => {
    const z = puzzle({ me: '06-kai-sa.json', opp: '02-vex.json', turn: 9, noChampion: true });
    z.runes(0, { Fury: 2 }); z.runes(1, { Calm: 2 });
    z.control(1, 1); z.at(1, 'Tornado Warrior', 1);
    const u = z.base(0, 'Noxus Hopeful');
    z.g.objects[u].stunned = stun; z.g.objects[u].exhausted = true;
    return evaluate(z.g, 0);
  };
  assert.ok(Math.abs(mk(true) - mk(false)) < 1e-6, `stunned ${mk(true).toFixed(2)} vs not ${mk(false).toFixed(2)}`);
});

test('siege: with an over-defended hold, a new unit is worth more at base (threatening the enemy hold) than stacked on the hold', () => {
  const mk = (where: 'base' | 0, oppBase: boolean) => {
    const z = puzzle({ me: '06-kai-sa.json', opp: '02-vex.json', turn: 9, noChampion: true });
    z.runes(0, { Fury: 2 }); z.runes(1, { Calm: 2 });
    z.control(0, 0); for (let i = 0; i < 3; i++) z.at(0, 'Plundering Poro', 0);
    z.control(1, 1); z.at(1, 'Tornado Warrior', 1); z.at(1, 'Tornado Warrior', 1);
    if (oppBase) for (let i = 0; i < 3; i++) z.base(1, 'Tornado Warrior');
    if (where === 'base') z.base(0, 'Noxus Hopeful'); else z.at(0, 'Noxus Hopeful', 0);
    return evaluate(z.g, 0);
  };
  // nothing threatens our 6-Might hold: the unit belongs at base, where it threatens their 6-Might hold
  assert.ok(mk('base', false) > mk(0, false), `base ${mk('base', false).toFixed(2)} vs hold ${mk(0, false).toFixed(2)}`);
  // 9 Might at their base beats our 6-Might hold: now the unit defends
  assert.ok(mk(0, true) > mk('base', true), `hold ${mk(0, true).toFixed(2)} vs base ${mk('base', true).toFixed(2)}`);
});

// BASICS: how long floating resources last (CR 165-167, 316.3, 317.2.e). Generated: Add source × the moment it is used ×
// how the game moves on. The pool empties at the start of each Main phase and at the end of each turn — never in between
// (not when a chain resolves, a showdown ends, or the turn moves to the Ending phase's triggers).
import { test } from 'node:test';
import { assert, P0, P1, act, touch } from '../conformance/harness.ts';
import { place } from '../../src/engine/testkit.ts';
import { getView } from '../../src/engine/index.ts';
import type { GameState, PlayerId } from '../../src/engine/types.ts';
import { momentBase, type Moment } from './matrix.ts';

type Source = 'runeExhaust' | 'runeRecycle' | 'gold' | 'legendAdd';
const SOURCES: Source[] = ['runeExhaust', 'runeRecycle', 'gold', 'legendAdd'];
type Step = 'now' | 'chainResolves' | 'showdownEnds' | 'mainStarts' | 'turnEnds';

const MOMENTS: { m: Moment; steps: { step: Step; kept: boolean; why: string }[] }[] = [
  { m: 'first', steps: [{ step: 'now', kept: true, why: 'CR 166' }, { step: 'turnEnds', kept: false, why: 'CR 317.2.e: every pool empties at the end of the turn' }] },
  { m: 'afterPlay', steps: [{ step: 'now', kept: true, why: 'CR 166' }, { step: 'turnEnds', kept: false, why: 'CR 317.2.e' }] },
  { m: 'showdownFocus', steps: [{ step: 'now', kept: true, why: 'CR 166' }, { step: 'showdownEnds', kept: true, why: 'a showdown ending does not empty the pool (CR 167)' }, { step: 'turnEnds', kept: false, why: 'CR 317.2.e' }] },
  { m: 'oppChain', steps: [{ step: 'now', kept: true, why: 'CR 166' }, { step: 'chainResolves', kept: true, why: 'the opponent\'s Main phase goes on; nothing empties the pool (CR 167)' }, { step: 'turnEnds', kept: false, why: 'CR 317.2.e: lost at the end of the opponent\'s turn' }] },
  { m: 'oppShowdownFocus', steps: [{ step: 'now', kept: true, why: 'CR 166' }, { step: 'showdownEnds', kept: true, why: 'CR 167' }, { step: 'turnEnds', kept: false, why: 'CR 317.2.e' }] },
  { m: 'beginningChain', steps: [{ step: 'now', kept: true, why: 'CR 166' }, { step: 'mainStarts', kept: false, why: 'CR 316.3: every pool empties as the Main phase starts' }] },
  { m: 'endingChain', steps: [{ step: 'now', kept: true, why: 'CR 166: the Ending step comes before the Expiration step' }, { step: 'turnEnds', kept: false, why: 'CR 317.2.e' }] },
];

function addFrom(g: GameState, src: Source): GameState {
  const p = P0;
  if (src === 'runeExhaust' || src === 'runeRecycle') {
    const r = g.players[p].runesInPlay.find(x => !g.objects[x].exhausted)!;
    return act(g, { type: 'activate', player: p, obj: r, abilityIndex: src === 'runeExhaust' ? 950 : 951 });
  }
  if (src === 'gold') { const id = place(g, p, 'cf-gold', 'base', { token: true }); touch(g); return act(g, { type: 'activate', player: p, obj: id, abilityIndex: 0 }); }
  g.objects[g.players[p].legend].cardId = 'bx-legend-add1'; touch(g);
  return act(g, { type: 'activate', player: p, obj: g.players[p].legend, abilityIndex: 0 });
}
const amount = (g: GameState, p: PlayerId) => g.players[p].pool.energy + Object.values(g.players[p].pool.power).reduce((s, n) => s + (n ?? 0), 0);

/** Move the game on: pass chain / showdown decisions, end turns, answer in-step decisions with the first option. */
function advance(g: GameState, until: (g: GameState) => boolean, endTurns: boolean): GameState {
  for (let i = 0; i < 60 && !until(g); i++) {
    const d = g.pending!;
    if (d.inStep) { g = act(g, { type: 'choose', player: d.player, optionIds: [(d.options ?? [])[0].id] }); continue; }
    if (d.kind === 'mainAction') { if (!endTurns) break; g = act(g, { type: 'endTurn', player: d.player }); continue; }
    g = act(g, { type: 'pass', player: d.player });
  }
  return g;
}

for (const { m, steps } of MOMENTS) for (const src of SOURCES) {
  test(`BASICS pool: ${src} at ${m} — ${steps.map(s => `${s.step}: ${s.kept ? 'kept' : 'emptied'}`).join(', ')}`, () => {
    let g = structuredClone(momentBase(m).g);
    const turn0 = g.turn;
    const before = amount(g, P0);
    g = addFrom(g, src);
    for (const s of steps) {
      if (s.step === 'chainResolves') g = advance(g, x => x.chain.length === 0, false);
      if (s.step === 'showdownEnds') g = advance(g, x => !x.showdown, false);
      if (s.step === 'mainStarts') g = advance(g, x => x.pending?.kind === 'mainAction', false);
      if (s.step === 'turnEnds') g = advance(g, x => x.turn > turn0 && x.pending?.kind === 'mainAction', true);
      const have = amount(g, P0);
      assert.equal(have, s.kept ? before + 1 : 0, `${s.step}: pool ${JSON.stringify(g.players[P0].pool)} (${s.why})`);
      // the view shows the pool as it is, to both players (CR 165: public)
      for (const p of [P0, P1] as PlayerId[]) assert.deepEqual(getView(g, p).state.players[P0].pool, g.players[P0].pool);
    }
  });
}

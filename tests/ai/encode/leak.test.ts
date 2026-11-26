// ENCODE leak test: the observation must depend only on what the player may know.
// 1. determinize() resamples exactly what `p` can't know -> encoding identical for every resample
// 2. mutating what getView strips from hidden objects (counters, modifiers, epoch) and the RNG -> identical
// 3. cross-check with getView: every encoded known object is visible in the view with the same card; every visible
//    view object in an encoded zone has a row; hidden objects never get a known row
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomGameStates } from './_games.ts';
import { encodeObservation, ENTITY, GLOBAL, type Observation } from '../../../src/ai/encode/index.ts';
import { cardIdxOf } from '../../../src/ai/encode/cards.ts';
import { determinize } from '../../../src/ai/determinize.ts';
import { makeRng } from '../../../src/engine/rng.ts';
import { getView } from '../../../src/engine/index.ts';
import { hiddenIdsFor } from '../../../src/engine/hidden-ids.ts';
import type { GameState, PlayerId } from '../../../src/engine/types.ts';

const SEEDS = Number(process.env.ENCODE_LEAK_SEEDS ?? 4);

function firstDiff(a: Observation, b: Observation): string | null {
  if (a.nEntities !== b.nEntities) return `nEntities ${a.nEntities} vs ${b.nEntities}`;
  for (let i = 0; i < GLOBAL.dim; i++) if (a.global[i] !== b.global[i]) return `global ${GLOBAL.names[i]}: ${a.global[i]} vs ${b.global[i]}`;
  for (let e = 0; e < a.nEntities; e++) {
    if (a.cardIdx[e] !== b.cardIdx[e]) return `entity ${e} cardIdx ${a.cardIdx[e]} vs ${b.cardIdx[e]}`;
    for (let f = 0; f < ENTITY.dim; f++) { const k = e * ENTITY.dim + f; if (a.entities[k] !== b.entities[k]) return `entity ${e} ${ENTITY.names[f]}: ${a.entities[k]} vs ${b.entities[k]}`; }
  }
  return null;
}

function scrambleHidden(g: GameState, p: PlayerId, r: () => number): GameState {
  const s = structuredClone({ ...g, cards: undefined, log: [] }) as unknown as GameState; s.cards = g.cards; s.log = g.log;
  const hidden = hiddenIdsFor(g, p);
  for (const id of hidden) { const o = s.objects[id]; o.counters = { buff: Math.floor(r() * 3), junk: 7 }; o.modifiers = []; o.epoch = (o.epoch ?? 0) + 5; }
  s.rng = Math.floor(r() * 2 ** 31);
  return s;
}

test('encodeObservation is invariant under determinization and hidden-state scrambling (no leaks)', () => {
  let states = 0, cancelStates = 0;
  for (let seed = 1; seed <= SEEDS; seed++) for (const { g, step } of randomGameStates(seed, 300)) {
    if (step % 3) continue;
    for (const p of [0, 1] as const) {
      const base = encodeObservation(g, p); states++;
      if (g.ex.cancelFor !== undefined && g.ex.cancelFor !== p) cancelStates++;
      for (let k = 1; k <= 2; k++) {
        const d = determinize(g, p, makeRng(seed * 1000 + step * 10 + k));
        const diff = firstDiff(base, encodeObservation(d, p));
        assert.equal(diff, null, `leak via determinize: seed ${seed} step ${step} p${p} pending ${g.pending?.kind}: ${diff}`);
      }
      if (step % 9 === 0 && !g.ex.unit) {
        const diff = firstDiff(base, encodeObservation(scrambleHidden(g, p, makeRng(seed + step)), p));
        assert.equal(diff, null, `leak via hidden counters/modifiers/rng: seed ${seed} step ${step} p${p}: ${diff}`);
      }
    }
  }
  assert.ok(states > 300, `too few states checked (${states})`);
  console.log(`# leak: ${states} observations x 2 determinizations; ${cancelStates} with an opponent's cancelable play in progress`);
});

test('encoded objects agree with getView redaction', () => {
  const ZONES = new Set(['base', 'battlefield', 'legendZone', 'championZone', 'chain', 'facedown', 'hand', 'runePool']);
  let checked = 0;
  for (let seed = 1; seed <= SEEDS; seed++) for (const { g, step } of randomGameStates(seed + 100, 300)) {
    if (step % 5) continue;
    for (const p of [0, 1] as const) {
      const o = encodeObservation(g, p); const v = getView(g, p).state; checked++;
      const knownCol = ENTITY.at.known, kindObj = ENTITY.at['kind:object'];
      for (const [id, row] of o.entityOf) {
        const known = o.entities[row * ENTITY.dim + knownCol] === 1;
        if (o.entities[row * ENTITY.dim + kindObj] !== 1) continue;
        const vo = v.objects[id];
        if (known) {
          assert.ok(vo && vo.cardId !== 'hidden', `seed ${seed} step ${step} p${p}: ${id} encoded as known but hidden in getView`);
          assert.equal(o.cardIdx[row], cardIdxOf(vo.cardId), `card mismatch for ${id}`);
        } else assert.ok(!vo || vo.cardId === 'hidden', `${id} encoded as unknown but visible in getView`);
      }
      // every visible view object in an encoded zone has a row (the view never shows a real id for hidden objects)
      for (const vo of Object.values(v.objects)) {
        if (vo.cardId === 'hidden' || !ZONES.has(vo.zone)) continue;
        if (g.objects[vo.id]) assert.ok(o.entityOf.has(vo.id), `seed ${seed} step ${step} p${p}: visible ${vo.id} (${vo.zone}) has no entity row`);
      }
      // hand counts
      const opp = (1 - p) as PlayerId;
      assert.equal(Math.round(o.global[GLOBAL.at['opp:hand']] * 12), Math.min(v.players[opp].hand.length, 12));
    }
  }
  assert.ok(checked > 100);
});

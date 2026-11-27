// META-SIM AI: determinization. Produces a copy of the real state in which everything the deciding player
// cannot know is resampled: the opponents' hands, main decks and facedown cards are re-dealt from the pool of
// their unseen cards (the decklist is treated as known, as in open-decklist events), the decider's own main
// deck is reshuffled, rune decks are reshuffled, and the engine RNG is reseeded (so future shuffles/random
// effects are not foreseen). The same permutation is applied to the replay unit base (ex.unit.base), because
// in-step decisions are applied by replaying from that base.
import type { GameState, ObjId, PlayerId } from '../engine/types.ts';
import { seedToState } from '../engine/rng.ts';
import { clone } from '../engine/util.ts';

const cloneDeep = clone;   // structuredClone semantics for game states, several times faster (engine/util.ts)

/** Swap cardIds of a set of object ids according to `perm` (objId -> new cardId). */
function applyPerm(g: GameState, perm: Map<ObjId, string>): void {
  for (const [id, cid] of perm) { const o = g.objects[id]; if (o) o.cardId = cid; }
}

function shuffled<T>(xs: T[], r: () => number): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function determinize(real: GameState, p: PlayerId, r: () => number): GameState {
  // shallow-share immutable parts the same way the engine's own clone does
  const { cards, log, ex, ...rest } = real;
  const { unit, lastEvents, ...exRest } = ex;
  const g = cloneDeep({ ...rest, ex: exRest }) as GameState;
  g.cards = cards; g.log = log.slice(); g.ex.lastEvents = [];
  void lastEvents;
  let base: GameState | null = null;
  if (unit) {
    const { cards: c2, log: l2, ex: ex2, ...rest2 } = unit.base;
    const { unit: u2, lastEvents: le2, ...exRest2 } = ex2;
    base = cloneDeep({ ...rest2, ex: exRest2 }) as GameState;
    base.cards = c2; base.log = l2.slice(); base.ex.lastEvents = []; base.ex.unit = u2 ?? null;
    void le2;
    g.ex.unit = { base, actions: unit.actions };
  } else g.ex.unit = null;

  const revealed = new Set(real.ex.revealed);
  if (real.pending && real.pending.player === p) {
    for (const o of real.pending.options ?? []) for (const id of o.objIds ?? []) revealed.add(id);
    if (real.pending.source) revealed.add(real.pending.source);
  }
  const perm = new Map<ObjId, string>();
  for (const pl of real.players) {
    if (pl.id === p) {
      // own main deck order is unknown to us
      const ids = pl.mainDeck.filter(id => !revealed.has(id));
      const cids = shuffled(ids.map(id => real.objects[id].cardId), r);
      ids.forEach((id, i) => perm.set(id, cids[i]));
    } else {
      const facedown = Object.values(real.objects).filter(o => o.zone === 'facedown' && o.controller === pl.id && o.owner === pl.id && !revealed.has(o.id)).map(o => o.id);
      const hidden = [...pl.hand, ...pl.mainDeck].filter(id => !revealed.has(id));
      // facedown cards are re-dealt only among themselves and hidden cards that could also have been hidden
      const pool = [...hidden, ...facedown];
      const cids = shuffled(pool.map(id => real.objects[id].cardId), r);
      // keep facedown cards Hidden-capable: give each facedown object a Hidden card from the shuffled pool
      const isHideable = (cid: string) => !!real.cards[cid]?.keywords?.some(k => k.startsWith('Hidden'));
      const fdCids: string[] = [];
      for (let k = 0; k < facedown.length; k++) {
        const j = cids.findIndex(isHideable);
        fdCids.push(j >= 0 ? cids.splice(j, 1)[0] : real.objects[facedown[k]].cardId);
        if (j < 0) { const self = cids.indexOf(real.objects[facedown[k]].cardId); if (self >= 0) cids.splice(self, 1); }
      }
      facedown.forEach((id, i) => perm.set(id, fdCids[i]));
      hidden.forEach((id, i) => perm.set(id, cids[i] ?? real.objects[id].cardId));
    }
    // rune deck order
    const rids = pl.runeDeck;
    const rc = shuffled(rids.map(id => real.objects[id].cardId), r);
    rids.forEach((id, i) => perm.set(id, rc[i]));
  }
  applyPerm(g, perm);
  if (base) applyPerm(base, perm);
  const seed = Math.floor(r() * 2 ** 31);
  // The replay base keeps its RNG: in-step answers are applied by replaying the unit from the base, and a
  // different RNG there would rewrite what already happened. Only quiescent states get a fresh RNG.
  if (!base) g.rng = seedToState(seed);
  return g;
}

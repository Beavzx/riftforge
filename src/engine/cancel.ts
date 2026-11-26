// UI-CANCEL: backing out of your own play / activation / hide while you are still making its choices.
//
// A top-level playCard / activate / hide starts a replay unit (g.ex.unit = { base, actions }) whose base is the
// quiescent state before the action. While the play is not finalized, every in-step decision the player gets
// (destination, mode, targets, X, optional additional costs, payment, cost choices) is a suspension of that unit.
// Cancelling simply returns the unit's base — the same restore an illegal play uses (Rollback, CR 358) — so the
// result is the exact pre-play state.
//
// game.ts run() calls cancelableFor() at every suspension and stores the answer in g.ex.cancelFor. It is refused when:
//   - the unit didn't start with the player's own playCard / activate / hide, or the decision is someone else's;
//   - the play (or activation / hide) has finalized (spellFinalized / play / activated / hide events);
//   - any randomness happened (rng moved) or anything hidden was revealed / looked at / drawn since the base;
//   - an object hidden from the player at the base moved, became revealed, or is shown in the decision;
//   - an earlier decision of this play was not cancelable (monotone: once refused, refused for the rest of the play).
import type { Action, Decision, GameState, ObjId, PlayerId } from './types.ts';

const STARTS = new Set(['playCard', 'activate', 'hide']);
/** the play / activation / hide has finalized (CR 359) — it is on the chain (or resolved) for good */
const FINALIZED = new Set(['spellFinalized', 'play', 'activated', 'hide']);
/** information was revealed to someone, or the deck order changed */
const REVEALING = new Set(['reveal', 'revealedFromDeck', 'lookedAt', 'lookDeck', 'revealDeck', 'draw', 'predict', 'channel', 'channelRunes', 'shuffle', 'burnOut', 'search']);

/** Is this object hidden from `viewer` (same zones as getView redacts; facedown cards of others count as hidden)? */
function hiddenFrom(g: GameState, viewer: PlayerId, id: ObjId): boolean {
  const o = g.objects[id];
  if (!o || g.ex.revealed.includes(id)) return false;
  if (o.zone === 'mainDeck' || o.zone === 'runeDeck' || o.zone === 'setAside') return true;
  if (o.zone === 'hand' && o.owner !== viewer) return true;
  if (o.zone === 'facedown' && o.controller !== viewer) return true;
  return false;
}

/**
 * Who may cancel at this suspension (or undefined). `base`/`actions`/`top` are the replay unit, `g` the suspended state,
 * `d` the decision it waits on, `prev` the cancelFor of the state the latest answer was given in.
 */
export function cancelableFor(base: GameState, g: GameState, actions: Action[], top: boolean, d: Decision, prev: PlayerId | undefined): PlayerId | undefined {
  const a0 = actions[0];
  if (!top || !a0 || !STARTS.has(a0.type)) return undefined;
  const p = a0.player;
  if (d.player !== p || d.kind === 'mulligan') return undefined;
  if (actions.length > 1 && prev !== p) return undefined;     // an earlier decision of this play was not cancelable
  if (g.rng !== base.rng) return undefined;                    // randomness happened
  for (const e of g.ex.lastEvents) if (FINALIZED.has(e.type) || REVEALING.has(e.type)) return undefined;
  // nothing the player couldn't see at the base may have moved, been revealed, or be shown to them now
  const shown = new Set<ObjId>();
  for (const o of d.options ?? []) for (const id of o.objIds ?? []) shown.add(id);
  if (d.source) shown.add(d.source);
  for (const id in base.objects) {
    if (!hiddenFrom(base, p, id)) continue;
    const now = g.objects[id];
    if (!now || now.zone !== base.objects[id].zone || g.ex.revealed.includes(id) || shown.has(id)) return undefined;
  }
  return p;
}

/** Why `player` can't cancel now (null = they can). */
export function cancelError(g: GameState, player: PlayerId): string | null {
  const d = g.pending;
  if (!d || !d.inStep || !g.ex.unit) return 'there is no play in progress to cancel';
  if (d.player !== player) return 'only the player making the play can cancel it';
  if (g.ex.cancelFor !== player) return 'this play can no longer be cancelled';
  return null;
}

/** The state to return to on cancel: the unit's base (the state before the play began). */
export function cancelBase(g: GameState): GameState {
  return g.ex.unit!.base;
}

// Engine facade used by UI + net. Resolves to the real engine (src/engine/game.ts) when it exists,
// otherwise the UI mock. tools/bundle.ts regenerates ./engine-impl.gen.ts accordingly.
import type { Action, CardDef, CardId, DeckList, Decision, GameEvent, GameSetup, GameState, PlayerId, PlayerView } from '../engine/types';
import * as impl from './engine-impl.gen';
import * as mock from './mock';

type AnyFn = (...a: never[]) => unknown;
const E = impl.engine as unknown as Record<string, AnyFn>;
const B = impl.bot as unknown as Record<string, AnyFn>;
const D = impl.deck as unknown as Record<string, AnyFn>;

export const ENGINE_SOURCE: string = impl.ENGINE_SOURCE;
/** Number of card scripts registered in this bundle (0 with the mock). Guards against shipping without scripts. */
export const scriptCount = (): number => { try { return (impl.registry as { allScripts?: () => unknown[] }).allScripts?.().length ?? 0; } catch { return 0; } };

export const createGame = E.createGame as unknown as (setup: GameSetup) => GameState;
export const getPending = E.getPending as unknown as (s: GameState) => Decision | null;
export const getLegalActions = E.getLegalActions as unknown as (s: GameState, p: PlayerId) => Action[];
export const getView = E.getView as unknown as (s: GameState, p: PlayerId) => PlayerView;
const rawApply = E.applyAction as unknown as (s: GameState, a: Action) => { state: GameState; events: GameEvent[] } | GameState;

/** applyAction that always returns {state, events} and throws Error on illegal actions. */
export function applyAction(s: GameState, a: Action): { state: GameState; events: GameEvent[] } {
  const r = rawApply(s, a) as { state?: GameState; events?: GameEvent[]; error?: string; ok?: boolean };
  if (r && typeof r === 'object' && 'error' in r && r.error) throw new Error(String(r.error));
  if (r && r.state) return { state: r.state, events: r.events ?? [] };
  return { state: r as unknown as GameState, events: [] };
}

/** Optional validator for actions not enumerated by getLegalActions (e.g. multi-unit moves, damage assignment). */
export function validateAction(s: GameState, a: Action): string | null {
  const v = (E.validateAction ?? null) as unknown as ((s: GameState, a: Action) => unknown) | null;
  if (v) {
    const r = v(s, a);
    if (r === true || r === null || r === undefined) return null;
    if (r === false) return 'Illegal action';
    if (typeof r === 'string') return r;
    if (typeof r === 'object' && r && 'ok' in r) return (r as { ok: boolean; error?: string }).ok ? null : ((r as { error?: string }).error ?? 'Illegal action');
    return null;
  }
  try { applyAction(s, a); return null; } catch (e) { return (e as Error).message; }
}

export interface DeckCheck { ok: boolean; errors: string[] }
export function validateDeck(deck: DeckList, db: Record<CardId, CardDef>): DeckCheck {
  const fn = (D.validateDeck ?? E.validateDeck ?? mock.validateDeck) as unknown as (d: DeckList, db: Record<CardId, CardDef>) => unknown;
  try {
    const r = fn(deck, db) as DeckCheck | string[] | { valid: boolean; errors: (string | { message: string })[] };
    const msg = (e: unknown) => typeof e === 'string' ? e : (e as { message?: string })?.message ?? JSON.stringify(e);
    if (Array.isArray(r)) return { ok: r.length === 0, errors: r.map(msg) };
    const errs = ((r as { errors?: unknown[] }).errors ?? []).map(e => typeof e === 'string' ? e : (e as { message?: string }).message ?? JSON.stringify(e));
    const ok = 'ok' in r ? !!(r as DeckCheck).ok : 'valid' in r ? !!(r as { valid: boolean }).valid : errs.length === 0;
    return { ok, errors: errs };
  } catch (e) { return { ok: false, errors: [(e as Error).message] }; }
}

/** Bot: returns an action for the seat that owns the pending decision. Never throws; falls back to first legal. */
export function botAction(state: GameState, player: PlayerId): Action | null {
  const view = getView(state, player);
  const cands = [B.chooseAction, B.botAction, B.chooseBotAction, B.default, mock.chooseBotAction].filter(Boolean) as unknown as ((...a: unknown[]) => Action | null)[];
  for (const fn of cands) {
    try {
      // Real bot may take (state, player) or (view); try the full state first if it looks like it wants 2 args.
      const a = fn.length >= 2 ? fn(state, player) : fn(view);
      if (a && typeof a === 'object' && 'type' in a) return a;
    } catch { /* try next */ }
  }
  return view.legal[0] ?? null;
}

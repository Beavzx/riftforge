// Match options (lobby/game settings) and best-of-N bookkeeping. The loser of a game chooses who goes first next.
import type { GameSetup, PlayerId } from '../engine/types';

export interface MatchOptions {
  battlefieldSelection: 'choose' | 'random';   // default 'choose'
  enforceBanlist: boolean;                      // default off
  bestOf: 1 | 3;
}
export const DEFAULT_OPTIONS: MatchOptions = { battlefieldSelection: 'choose', enforceBanlist: false, bestOf: 1 };

export interface MatchState { bestOf: 1 | 3; wins: [number, number]; game: number; lastWinner: PlayerId | null }
export const newMatch = (bestOf: 1 | 3): MatchState => ({ bestOf, wins: [0, 0], game: 1, lastWinner: null });
export const winsNeeded = (m: MatchState) => Math.floor(m.bestOf / 2) + 1;
export const matchWinner = (m: MatchState): PlayerId | null => m.wins[0] >= winsNeeded(m) ? 0 : m.wins[1] >= winsNeeded(m) ? 1 : null;
export const matchOver = (m: MatchState) => matchWinner(m) !== null;
/** Record a finished game once (call with the game's winner). */
export function recordGame(m: MatchState, winner: PlayerId): MatchState {
  const wins: [number, number] = [...m.wins];
  if (winner === 0 || winner === 1) wins[winner]++;
  return { ...m, wins, lastWinner: winner };
}
export const nextGame = (m: MatchState): MatchState => ({ ...m, game: m.game + 1 });

export function sanitizeOptions(o: unknown): MatchOptions {
  const x = (o && typeof o === 'object' ? o : {}) as Partial<MatchOptions>;
  return {
    battlefieldSelection: x.battlefieldSelection === 'random' ? 'random' : 'choose',
    enforceBanlist: x.enforceBanlist === true,
    bestOf: x.bestOf === 3 ? 3 : 1,
  };
}

/** Apply options to an engine GameSetup (sends both the agreed name and the engine's current field name). */
export function withOptions(setup: GameSetup, o: MatchOptions, firstPlayer?: PlayerId): GameSetup {
  return {
    ...setup,
    battlefieldChoice: o.battlefieldSelection,
    ...({ battlefieldSelection: o.battlefieldSelection, enforceBanlist: o.enforceBanlist } as object),
    ...(firstPlayer !== undefined ? { firstPlayer } : {}),
  } as GameSetup;
}

export function isMatchState(x: unknown): x is MatchState {
  if (!x || typeof x !== 'object') return false;
  const m = x as MatchState;
  return (m.bestOf === 1 || m.bestOf === 3) && Array.isArray(m.wins) && m.wins.length === 2 && m.wins.every(n => Number.isInteger(n) && n >= 0 && n <= 3)
    && Number.isInteger(m.game) && m.game >= 1 && m.game <= 5;
}

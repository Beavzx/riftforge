// COACH: game records. A record is everything needed to replay a game exactly: the engine setup (minus the card
// database, which is bundled) and every action applied, in order (both players', bots included). The engine is
// deterministic (same setup + same actions => same game), so tools/review.ts can rebuild every position.
// Written by LocalSession / HostSession (menu: "Export game record"); read by tools/review.ts. DOM-free.
import type { Action, GameSetup, GameState, PlayerId } from '../engine/types';

export const RECORD_FORMAT = 'riftforge-game/1';

export interface GameRecord {
  format: typeof RECORD_FORMAT;
  setup: Omit<GameSetup, 'cardDb'>;
  actions: Action[];
  names?: string[];
  /** which seat exported it (the human in a vs-bot game, the host online) */
  you?: PlayerId;
  createdAt?: string;
  result?: { winner: PlayerId | null; turn: number; points: number[] };
  source?: 'local' | 'host' | 'sim';
}

export function newRecord(setup: GameSetup, source: GameRecord['source'], you?: PlayerId): GameRecord {
  const { cardDb: _db, ...rest } = setup;
  void _db;
  return { format: RECORD_FORMAT, setup: JSON.parse(JSON.stringify(rest)), actions: [], names: setup.players.map(p => p.name), you, createdAt: new Date().toISOString(), source };
}

/** A copy of the record with the current result filled in. */
export function finishRecord(rec: GameRecord, g: GameState): GameRecord {
  return { ...rec, actions: rec.actions.slice(), result: { winner: g.winner as PlayerId | null, turn: g.turn, points: g.players.map(p => p.points) } };
}

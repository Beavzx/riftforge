// A GameSession is what the board talks to: it yields PlayerViews for the seat being shown and accepts intents.
import type { Action, GameEvent, GameSetup, GameState, PlayerId, PlayerView } from '../engine/types';
import * as Eng from '../ui/engine';
import { type MatchState, recordGame } from './match';
import { newRecord, finishRecord, type GameRecord } from './record';
import type { PrintMap } from '../ui/art';

export interface SessionStatus {
  mode: 'hotseat' | 'bot' | 'botvbot' | 'host' | 'guest';
  online: boolean;
  opponentConnected: boolean;
  waitingFor?: string;       // e.g. "Waiting for host…"
  banner?: string;           // persistent warning (disconnects)
  ended?: string;            // session can't continue (host left)
  match?: MatchState;        // best-of-N progress (wins already include this game once it has ended)
}

export interface GameSession {
  readonly status: SessionStatus;
  view(): PlayerView | null;
  /** Send an intent. Resolves with an error string if it was rejected locally/by host, else null. */
  act(action: Action): Promise<string | null>;
  subscribe(fn: (view: PlayerView, events: GameEvent[]) => void): () => void;
  onStatus(fn: (s: SessionStatus) => void): () => void;
  /** For hotseat: whose seat is shown. */
  seat(): PlayerId;
  canSwitchSeat?: boolean;
  switchSeat?(p: PlayerId): void;
  /** Validate a non-enumerated action without applying it (only possible with full state). */
  check?(action: Action): string | null;
  /** COACH: the replayable record of this game (setup + every action), when this side has the full state. */
  gameRecord?(): GameRecord | null;
  close(): void;
  names(): string[];
  /** Per seat: the printed code (alt art) each player imported for a card id, used to pick card images. */
  printings?(): readonly (PrintMap | undefined)[];
}

type Sub = (view: PlayerView, events: GameEvent[]) => void;

/** Local session: hotseat ("play both sides"), vs bot, or bot vs bot. Full state lives here. */
export class LocalSession implements GameSession {
  state: GameState;
  status: SessionStatus;
  private subs = new Set<Sub>();
  private statusSubs = new Set<(s: SessionStatus) => void>();
  private shown: PlayerId = 0;
  private botTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  canSwitchSeat: boolean;
  botDelay: number;
  actionsApplied = 0;
  errors: string[] = [];

  private recorded = false;
  private record: GameRecord;
  private prints: (PrintMap | undefined)[];
  constructor(setup: GameSetup, public mode: 'hotseat' | 'bot' | 'botvbot', opts: { botDelay?: number; human?: PlayerId; match?: MatchState; printings?: (PrintMap | undefined)[] } = {}) {
    this.state = Eng.createGame(setup);
    this.record = newRecord(setup, 'local', mode === 'bot' ? (opts.human ?? 0) : undefined);
    this.prints = opts.printings ?? [];
    this.status = { mode, online: false, opponentConnected: true, match: opts.match };
    this.canSwitchSeat = mode === 'hotseat';
    this.botDelay = opts.botDelay ?? 650;
    this.shown = opts.human ?? 0;
    if (mode === 'hotseat') this.followPending();
    queueMicrotask(() => this.tick([]));
  }
  names() { return this.state.players.map(p => p.name); }
  printings() { return this.prints; }
  seat() { return this.shown; }
  switchSeat(p: PlayerId) { this.shown = p; this.emit([]); }
  view() { return Eng.getView(this.state, this.shown); }
  private isBot(p: PlayerId) { return this.mode === 'botvbot' || (this.mode === 'bot' && p !== 0); }
  private followPending() {
    const pend = Eng.getPending(this.state);
    if (pend && this.mode === 'hotseat') this.shown = pend.player;
  }
  check(action: Action) { return Eng.validateAction(this.state, action); }
  gameRecord(): GameRecord { return finishRecord(this.record, this.state); }
  /** Test/teaching hook: what the bot would do for the seat that must decide now. */
  suggest(): Action | null { const p = Eng.getPending(this.state); return p ? Eng.botAction(this.state, p.player) : null; }
  async act(action: Action): Promise<string | null> {
    if (this.closed) return 'Session closed';
    const pend = Eng.getPending(this.state);
    if (action.type !== 'concede' && (!pend || this.isBot(pend.player))) return 'Not your decision';
    return this.apply(action);
  }
  private apply(action: Action): string | null {
    try {
      const r = Eng.applyAction(this.state, action);
      this.state = r.state; this.actionsApplied++;
      this.record.actions.push(action);
      this.followPending();
      this.tick(r.events);
      return null;
    } catch (e) {
      const msg = (e as Error).message || String(e);
      this.errors.push(msg);
      return msg;
    }
  }
  private tick(events: GameEvent[]) {
    if (this.state.winner !== null && !this.recorded && this.status.match) {
      this.recorded = true;
      this.status = { ...this.status, match: recordGame(this.status.match, this.state.winner) };
      for (const f of this.statusSubs) f(this.status);
    }
    this.emit(events);
    if (this.botTimer) clearTimeout(this.botTimer);
    const pend = Eng.getPending(this.state);
    if (!pend || this.closed || this.state.winner !== null) return;
    if (this.isBot(pend.player)) {
      this.botTimer = setTimeout(() => {
        if (this.closed) return;
        const p = Eng.getPending(this.state); if (!p || !this.isBot(p.player)) return;
        const a = Eng.botAction(this.state, p.player);
        if (!a) return;
        const err = this.apply(a);
        if (err) {
          // Bot chose something illegal: fall back to the first enumerated legal action.
          const legal = Eng.getLegalActions(this.state, p.player).filter(x => x.type !== 'concede');
          if (legal.length) this.apply(legal.find(x => x.type === 'pass' || x.type === 'endTurn') ?? legal[0]);
        }
      }, this.botDelay);
    }
  }
  private emit(events: GameEvent[]) { const v = this.view(); for (const f of this.subs) f(v, events); }
  subscribe(fn: Sub) { this.subs.add(fn); return () => this.subs.delete(fn); }
  onStatus(fn: (s: SessionStatus) => void) { this.statusSubs.add(fn); return () => this.statusSubs.delete(fn); }
  close() { this.closed = true; if (this.botTimer) clearTimeout(this.botTimer); this.subs.clear(); }
}

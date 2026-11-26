// Online lobby + host-authoritative game sessions over the page `room` capability.
// Host runs the engine; guest sends intents {seq, ver}; host validates via the engine and sends redacted views.
import type { Action, CardDef, CardId, DeckList, GameEvent, GameState, PlayerId, PlayerView } from '../engine/types';
import * as Eng from '../ui/engine';
import { type Channel, openChannel } from './room';
import { type Msg, type SeatInfo, PROTO, isDeck, packView, parseMsg, unpackView } from './protocol';
import type { GameSession, SessionStatus } from './session';
import { newRecord, finishRecord, type GameRecord } from './record';
import { type PrintMap, cleanPrintMap } from '../ui/art';
import { type MatchOptions, type MatchState, DEFAULT_OPTIONS, newMatch, nextGame, recordGame, matchOver, sanitizeOptions, withOptions } from './match';


/** HIDDEN-IDS: 128 random bits for GameSetup.viewSecret (crypto when available). */
function viewSecret(): string {
  const b = new Uint32Array(4);
  try { globalThis.crypto.getRandomValues(b); } catch { for (let i = 0; i < 4; i++) b[i] = Math.floor(Math.random() * 2 ** 32); }
  return [...b].map(x => x.toString(16).padStart(8, '0')).join('');
}

export const HB_MS = 2000;
export const HOST_SAVE_KEY = 'riftforge.hostGame';
export interface HostSave { code: string; gid: string; seats: [string, string]; names: [string, string]; state: GameState; at: number; match?: MatchState | null; printings?: (PrintMap | null)[]; record?: GameRecord | null }
export function loadHostSave(): HostSave | null { try { const v = sessionStorage.getItem(HOST_SAVE_KEY); return v ? JSON.parse(v) as HostSave : null; } catch { return null; } }
export function clearHostSave() { try { sessionStorage.removeItem(HOST_SAVE_KEY); } catch { /* ignore */ } }
export const PEER_TIMEOUT_MS = 7000;
export const HOST_GONE_MS = 25000;
// Loss recovery: a guest intent is re-sent after RESEND_MS without an ack; the host re-sends its latest view at
// VIEW_REPEAT_MS until the guest reports (hb/sync) that it has it. Duplicates are idempotent on both sides.
const RESEND_MS = 350;
const VIEW_REPEAT_MS = [250, 700, 1500];

export interface LobbyState {
  code: string; role: 'host' | 'guest'; me: string; seats: SeatInfo[]; started: boolean; gid: string | null;
  hostConnected: boolean; error?: string; joined: boolean; peers: number;
  opts: MatchOptions; match: MatchState | null;
}

export interface Identity { cid: string; sid: string; name: string }

export function randomCode(): string {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = '';
  for (let i = 0; i < 5; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}
export const normCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

type Timer = ReturnType<typeof setInterval>;

/** Lobby: who's here, decks, ready state; becomes a Host/Guest session on start. */
export class Lobby {
  state: LobbyState;
  private subs = new Set<(s: LobbyState) => void>();
  private startSubs = new Set<(s: GameSession) => void>();
  private lastSeen = new Map<string, number>();
  private decks = new Map<string, { deck: DeckList; name: string; printings?: PrintMap }>();
  private timers: Timer[] = [];
  private unsub: (() => void) | null = null;
  session: HostSession | GuestSession | null = null;
  private myDeck: { deck: DeckList; name: string; printings?: PrintMap } | null = null;
  /** AUTO-AUDIT: per-player "choose runes when paying" preference (GameSetup.manualPay); the host collects the guests' */
  private manualPay = false;
  private payPrefs = new Map<string, boolean>();

  private constructor(public ch: Channel, code: string, role: 'host' | 'guest', public me: Identity,
    public db: Record<CardId, CardDef>, public seedFn: () => number = () => Math.floor(Math.random() * 2 ** 31)) {
    this.state = { code, role, me: me.cid, seats: role === 'host' ? [{ cid: me.cid, name: me.name, ready: false, connected: true }] : [],
      started: false, gid: null, hostConnected: role === 'host', joined: role === 'host', peers: 0, opts: { ...DEFAULT_OPTIONS }, match: null };
  }

  static async open(code: string, role: 'host' | 'guest', me: Identity, db: Record<CardId, CardDef>): Promise<Lobby | null> {
    const ch = await openChannel(code);
    if (!ch) return null;
    const l = new Lobby(ch, normCode(code), role, me, db);
    l.start();
    return l;
  }

  private start() {
    this.unsub = this.ch.onMessage(raw => { const m = parseMsg(raw); if (m && m.cid !== this.me.cid) this.onMsg(m); });
    this.ch.onPeers(p => { this.state.peers = p.length; this.emit(); });
    this.ch.setPresence({ cid: this.me.cid, name: this.me.name, role: this.state.role });
    const hello = () => this.ch.send({ t: 'hello', cid: this.me.cid, sid: this.me.sid, name: this.me.name, v: PROTO });
    if (this.state.role === 'guest') { hello(); this.timers.push(setInterval(() => { if (!this.state.joined) hello(); }, 1500)); }
    this.timers.push(setInterval(() => this.heartbeat(), HB_MS));
    this.heartbeat();
  }

  private heartbeat() {
    const now = Date.now();
    this.ch.send({ t: 'hb', cid: this.me.cid, gid: this.state.gid, ver: this.session?.ver ?? 0, role: this.state.role });
    if (this.state.role === 'host') {
      let changed = false;
      for (const s of this.state.seats) {
        if (s.cid === this.me.cid) continue;
        const c = now - (this.lastSeen.get(s.cid) ?? 0) < PEER_TIMEOUT_MS;
        if (c !== s.connected) { s.connected = c; changed = true; }
      }
      // Drop disconnected guests from a lobby that hasn't started
      if (!this.state.started) {
        const before = this.state.seats.length;
        this.state.seats = this.state.seats.filter(s => s.cid === this.me.cid || now - (this.lastSeen.get(s.cid) ?? 0) < PEER_TIMEOUT_MS * 2);
        if (this.state.seats.length !== before) changed = true;
      }
      this.broadcastLobby();
      if (changed) this.emit();
    } else {
      const hc = now - (this.lastSeen.get(this.hostCid ?? '') ?? 0) < PEER_TIMEOUT_MS;
      if (hc !== this.state.hostConnected) { this.state.hostConnected = hc; this.emit(); }
    }
    this.session?.onHeartbeat(now);
  }

  hostCid: string | null = null;

  private broadcastLobby() {
    this.ch.send({ t: 'lobby', cid: this.me.cid, host: this.me.cid, seats: this.state.seats, gid: this.state.gid, started: this.state.started, opts: this.state.opts, match: this.state.match ?? undefined });
  }

  private onMsg(m: Msg) {
    this.lastSeen.set(m.cid, Date.now());
    if (this.state.role === 'host') this.onHostMsg(m); else this.onGuestMsg(m);
    this.session?.onMsg(m);
  }

  private onHostMsg(m: Msg) {
    if (m.t === 'hello') {
      let seat = this.state.seats.find(s => s.cid === m.cid);
      if (!seat) {
        if (this.state.started || this.state.seats.length >= 2) { this.ch.send({ t: 'kick', cid: this.me.cid, to: m.cid, reason: this.state.started ? 'A game is already in progress in this room.' : 'Room is full.' }); return; }
        seat = { cid: m.cid, name: m.name.slice(0, 24) || 'Guest', ready: false, connected: true };
        this.state.seats.push(seat);
      } else { seat.connected = true; }
      this.broadcastLobby(); this.emit();
      if (this.state.started && this.session instanceof HostSession) this.session.onGuestHello(m.cid, (m as { sid?: string }).sid ?? '');
    } else if (m.t === 'ready') {
      const seat = this.state.seats.find(s => s.cid === m.cid); if (!seat || this.state.started) return;
      seat.ready = m.ready; seat.deckName = String(m.deckName ?? '').slice(0, 40);
      this.payPrefs.set(m.cid, m.manualPay === true);
      if (m.deck && isDeck(m.deck)) {
        const v = Eng.validateDeck(m.deck, this.db);
        const known = [m.deck.legend, m.deck.champion, ...m.deck.main, ...m.deck.runes, ...m.deck.battlefields].every(id => !!this.db[id]);
        seat.deckOk = v.ok && known;
        if (seat.deckOk) this.decks.set(m.cid, { deck: m.deck, name: seat.deckName, printings: cleanPrintMap(m.printings) });
        else { seat.ready = false; }
      } else if (m.ready) { seat.ready = false; seat.deckOk = false; }
      this.broadcastLobby(); this.emit();
    } else if (m.t === 'next') {
      const sess = this.session;
      if (sess instanceof HostSession && sess.gid === m.gid && sess.state.winner === 0 && this.state.match && !matchOver(this.state.match)) this.startNext(m.first ? 1 : 0);
    } else if (m.t === 'bye') {
      if (!this.state.started) { this.state.seats = this.state.seats.filter(s => s.cid !== m.cid); this.broadcastLobby(); this.emit(); }
      else { const s = this.state.seats.find(x => x.cid === m.cid); if (s) { s.connected = false; this.emit(); } }
    }
  }

  private onGuestMsg(m: Msg) {
    if (m.t === 'lobby') {
      if (this.hostCid && m.cid !== this.hostCid) return; // ignore impostor hosts once joined
      const mine = m.seats.some(s => s.cid === this.me.cid);
      if (!mine && !m.started) return;
      this.hostCid = m.cid; this.state.hostConnected = true;
      this.state.seats = m.seats.map(s => ({ cid: s.cid, name: String(s.name).slice(0, 24), ready: !!s.ready, deckName: s.deckName ? String(s.deckName).slice(0, 40) : undefined, deckOk: s.deckOk, connected: s.connected !== false }));
      this.state.joined = mine; this.state.started = m.started; this.state.gid = m.gid;
      this.state.opts = sanitizeOptions(m.opts); this.state.match = m.match ?? null;
      if (mine && this.myDeck && !this.state.seats.find(s => s.cid === this.me.cid)?.ready && this.wantReady) this.sendReady();
      // A game started but our 'start' message was lost: ask again (host answers hello with start + view).
      if (mine && m.started && m.gid && this.session?.gid !== m.gid) this.ch.send({ t: 'hello', cid: this.me.cid, sid: this.me.sid, name: this.me.name, v: PROTO });
      this.emit();
    } else if (m.t === 'kick' && m.to === this.me.cid) {
      this.state.error = m.reason; this.emit();
    } else if (m.t === 'start' && m.seats.includes(this.me.cid)) {
      if (this.hostCid && m.cid !== this.hostCid) return;
      this.hostCid = m.cid;
      if (!this.session || this.session.gid !== m.gid) {
        this.session?.close();
        const seat = m.seats.indexOf(this.me.cid) as PlayerId;
        this.session = new GuestSession(this, m.gid, seat, m.names, m.cid, m.match, (m.printings ?? []).map(p => cleanPrintMap(p) ?? null));
        this.state.match = m.match ?? this.state.match;
        this.state.started = true; this.state.gid = m.gid;
        this.emit();
        for (const f of this.startSubs) f(this.session);
      }
    } else if (m.t === 'bye' && m.cid === this.hostCid) {
      this.state.hostConnected = false; this.state.error = 'The host left the room.'; this.emit();
    }
  }

  private wantReady = false;
  setDeck(deck: DeckList | null, name: string, printings?: PrintMap) { this.myDeck = deck ? { deck, name, printings: cleanPrintMap(printings) } : null; if (this.wantReady) this.setReady(true); }
  setReady(ready: boolean) {
    this.wantReady = ready;
    if (this.state.role === 'host') {
      const seat = this.state.seats.find(s => s.cid === this.me.cid)!;
      const ok = !!this.myDeck && Eng.validateDeck(this.myDeck.deck, this.db).ok;
      seat.ready = ready && ok; seat.deckOk = ok; seat.deckName = this.myDeck?.name;
      if (ok && this.myDeck) this.decks.set(this.me.cid, this.myDeck);
      this.broadcastLobby(); this.emit();
    } else this.sendReady();
  }
  private sendReady() {
    this.ch.send({ t: 'ready', cid: this.me.cid, ready: this.wantReady && !!this.myDeck, deck: this.myDeck?.deck, deckName: this.myDeck?.name, printings: this.myDeck?.printings, manualPay: this.manualPay });
  }
  /** "Choose runes when paying": every payment asks (Auto-pay stays one click). Applies to the next game that starts. */
  setManualPay(on: boolean) {
    this.manualPay = on;
    if (this.state.role !== 'host' && this.state.seats.some(s => s.cid === this.me.cid)) this.sendReady();
  }

  canStart(): boolean {
    return this.state.role === 'host' && !this.state.started && this.state.seats.length === 2 &&
      this.state.seats.every(s => s.ready && s.deckOk && s.connected !== false) && this.state.seats.every(s => this.decks.has(s.cid));
  }

  startGame(seed = this.seedFn()): HostSession | null {
    if (!this.canStart()) return null;
    this.state.match = newMatch(this.state.opts.bestOf);
    return this.launch(seed, undefined);
  }

  private launch(seed: number, firstPlayer: PlayerId | undefined): HostSession {
    const [a, b] = this.state.seats;
    const gid = randomCode() + Date.now().toString(36);
    const setup = withOptions({ seed, cardDb: this.db, players: [a, b].map(s => ({ name: s.name, deck: this.decks.get(s.cid)!.deck })) }, this.state.opts, firstPlayer);
    setup.manualPay = [a, b].map(s => (s.cid === this.me.cid ? this.manualPay : this.payPrefs.get(s.cid) === true));
    setup.viewSecret = viewSecret();   // HIDDEN-IDS: keys the guest's opaque ids for hidden cards; stays on the host
    this.session?.close();
    const prints = [a, b].map(s => this.decks.get(s.cid)?.printings ?? null);
    const sess = new HostSession(this, gid, setup, [a.cid, b.cid], [a.name, b.name], undefined, this.state.match ?? undefined, prints);
    this.session = sess;
    this.state.started = true; this.state.gid = gid;
    this.broadcastLobby(); this.emit();
    sess.sendStart();
    for (const f of this.startSubs) f(sess);
    return sess;
  }

  /** Host: set lobby options before the match starts. */
  setOptions(o: Partial<MatchOptions>) {
    if (this.state.role !== 'host' || this.state.started) return;
    this.state.opts = sanitizeOptions({ ...this.state.opts, ...o }); this.broadcastLobby(); this.emit();
  }
  /** Next game of a best-of-3: the previous game's loser picked who goes first. */
  startNext(firstPlayer: PlayerId): HostSession | null {
    if (this.state.role !== 'host' || !this.state.match || matchOver(this.state.match)) return null;
    this.state.match = nextGame(this.state.match);
    return this.launch(this.seedFn(), firstPlayer);
  }
  /** Called by the board for the player who lost: goFirst = whether the loser goes first. */
  chooseNext(loser: PlayerId, goFirst: boolean) {
    const first = (goFirst ? loser : 1 - loser) as PlayerId;
    if (this.state.role === 'host') { this.startNext(first); return; }
    const gid = this.session?.gid; if (!gid) return;
    let n = 0; const send = () => { if (this.session?.gid !== gid || n++ > 8) return; this.ch.send({ t: 'next', cid: this.me.cid, gid, first: first === 1 }); setTimeout(send, 1200); };
    send();
  }
  recordResult(winner: PlayerId) { if (this.state.match) { this.state.match = recordGame(this.state.match, winner); this.broadcastLobby(); this.emit(); } }

  /** Resume a hosted game after this tab reloaded. The guest's session picks up the next view it receives. */
  resumeHost(save: HostSave): HostSession | null {
    if (this.state.role !== 'host' || save.code !== this.state.code || save.state.winner !== null) return null;
    this.state.seats = [{ cid: this.me.cid, name: save.names[0], ready: true, deckOk: true, connected: true }, { cid: save.seats[1], name: save.names[1], ready: true, deckOk: true, connected: false }];
    this.state.match = save.match ?? null;
    const sess = new HostSession(this, save.gid, null, [this.me.cid, save.seats[1]], save.names, save.state, save.match ?? undefined, (save.printings ?? []).map(p => cleanPrintMap(p) ?? null), save.record ?? null);
    this.session = sess; this.state.started = true; this.state.gid = save.gid;
    this.broadcastLobby(); this.emit(); sess.sendStart();
    for (const f of this.startSubs) f(sess);
    return sess;
  }

  onStarted(fn: (s: GameSession) => void) { this.startSubs.add(fn); return () => this.startSubs.delete(fn); }
  subscribe(fn: (s: LobbyState) => void) { this.subs.add(fn); fn(this.state); return () => this.subs.delete(fn); }
  emit() { for (const f of this.subs) f(this.state); }
  seen(cid: string) { return Date.now() - (this.lastSeen.get(cid) ?? 0) < PEER_TIMEOUT_MS; }
  lastSeenAt(cid: string) { return this.lastSeen.get(cid) ?? 0; }

  leave() {
    try { this.ch.send({ t: 'bye', cid: this.me.cid }); } catch { /* ignore */ }
    for (const t of this.timers) clearInterval(t);
    this.unsub?.(); this.session?.close(); this.ch.leave();
    this.subs.clear(); this.startSubs.clear();
  }
}

type Sub = (view: PlayerView, events: GameEvent[]) => void;

abstract class BaseOnline {
  status: SessionStatus;
  protected subs = new Set<Sub>();
  protected statusSubs = new Set<(s: SessionStatus) => void>();
  ver = 0;
  closed = false;
  constructor(public lobby: Lobby, public gid: string, mode: 'host' | 'guest') {
    this.status = { mode, online: true, opponentConnected: true };
  }
  subscribe(fn: Sub) { this.subs.add(fn); return () => this.subs.delete(fn); }
  onStatus(fn: (s: SessionStatus) => void) { this.statusSubs.add(fn); fn(this.status); return () => this.statusSubs.delete(fn); }
  protected setStatus(p: Partial<SessionStatus>) {
    const next = { ...this.status, ...p };
    if (JSON.stringify(next) === JSON.stringify(this.status)) return;
    this.status = next; for (const f of this.statusSubs) f(this.status);
  }
  abstract onMsg(m: Msg): void;
  abstract onHeartbeat(now: number): void;
  close() { this.closed = true; this.subs.clear(); }
}

export class HostSession extends BaseOnline implements GameSession {
  state: GameState;
  private lastSeq = 0;
  private guestSid = '';
  private disconnectedSince = 0;
  private recorded = false;
  /** COACH: replayable record (null for a game restored from a save made before records existed) */
  private record: GameRecord | null;
  constructor(lobby: Lobby, gid: string, setup: Parameters<typeof Eng.createGame>[0] | null, public seats: [string, string], private nameList: [string, string], restored?: GameState, match?: MatchState, private prints: (PrintMap | null)[] = [], restoredRecord?: GameRecord | null) {
    super(lobby, gid, 'host');
    this.record = setup ? newRecord(setup, 'host', 0) : (restoredRecord ?? null);
    this.status.match = match;
    this.state = restored ?? Eng.createGame(setup!);
    this.recorded = this.state.winner !== null;
    this.ver = this.state.actionCount ?? 0;
    this.save();
    try { addEventListener('pagehide', this.flushSave); } catch { /* not a browser */ }
  }
  /** Persist the authoritative state in this tab so a host reload can resume the game (best effort). */
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** Persisting the whole state costs a few ms per action: do it after the view went out and the board drew. */
  private saveSoon() { if (!this.saveTimer) this.saveTimer = setTimeout(() => { this.saveTimer = null; if (!this.closed) this.save(); }, 30); }
  private flushSave = () => { if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; if (!this.closed) this.save(); } };
  /** Highest version the guest has reported (hb / sync); views are repeated until it catches up. */
  guestVer = 0;
  private repeatTimers: ReturnType<typeof setTimeout>[] = [];
  private repeatView() {
    for (const t of this.repeatTimers) clearTimeout(t);
    const ver = this.ver;
    this.repeatTimers = VIEW_REPEAT_MS.map(ms => setTimeout(() => { if (!this.closed && this.ver === ver && this.guestVer < ver) this.sendView(); }, ms));
  }
  // (no save on close: leaving clears the host save first, and a late save would resurrect it)
  close() { super.close(); for (const t of this.repeatTimers) clearTimeout(t); if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; } try { removeEventListener('pagehide', this.flushSave); } catch { /* not a browser */ } }
  private save() {
    try { sessionStorage.setItem(HOST_SAVE_KEY, JSON.stringify({ code: this.lobby.state.code, gid: this.gid, seats: this.seats, names: this.nameList, state: this.state, at: Date.now(), match: this.lobby.state.match, record: this.record })); } catch { /* storage full or blocked */ }
  }
  names() { return [...this.nameList]; }
  printings() { return this.prints.map(p => p ?? undefined); }
  seat(): PlayerId { return 0; }
  view() { return Eng.getView(this.state, 0); }
  check(a: Action) { return Eng.validateAction(this.state, a); }
  gameRecord(): GameRecord | null { return this.record ? finishRecord(this.record, this.state) : null; }
  suggest(): Action | null { const p = Eng.getPending(this.state); return p && p.player === 0 ? Eng.botAction(this.state, 0) : null; }
  sendStart(to?: string) {
    this.lobby.ch.send({ t: 'start', cid: this.lobby.me.cid, gid: this.gid, seats: this.seats, names: this.nameList, to, match: this.lobby.state.match ?? undefined, printings: this.prints.some(Boolean) ? this.prints : undefined });
    this.sendView();
  }
  private guestCid() { return this.seats[1]; }
  sendView() {
    const v = packView(Eng.getView(this.state, 1));
    this.lobby.ch.send({ t: 'view', cid: this.lobby.me.cid, gid: this.gid, to: this.guestCid(), ver: this.ver, ack: this.lastSeq, view: v, match: this.lobby.state.match ?? undefined });
  }
  onGuestHello(cid: string, sid: string) {
    if (cid !== this.guestCid()) return;
    if (sid && sid !== this.guestSid) { this.guestSid = sid; this.lastSeq = 0; }
    this.sendStart(cid);
  }
  private emitLocal(events: GameEvent[]) { const v = this.view(); for (const f of this.subs) f(v, events); }
  private applyFor(action: Action): string | null {
    try {
      const r = Eng.applyAction(this.state, action);
      this.state = r.state; this.ver++;
      this.record?.actions.push(action);
      if (this.state.winner !== null && !this.recorded) { this.recorded = true; this.lobby.recordResult(this.state.winner); this.setStatus({ match: this.lobby.state.match ?? undefined }); }
      this.sendView(); this.repeatView(); this.emitLocal(r.events); this.saveSoon();
      return null;
    } catch (e) { return (e as Error).message || 'Illegal action'; }
  }
  async act(action: Action): Promise<string | null> {
    if (this.closed) return 'Session closed';
    if (action.player !== 0) return 'Not your seat';
    return this.applyFor(action);
  }
  /** Host may end the game if the guest has been gone a long time. */
  claimWin(): string | null {
    if (this.status.opponentConnected) return 'Opponent is connected';
    return this.applyFor({ type: 'concede', player: 1 });
  }
  disconnectedFor(): number { return this.disconnectedSince ? Date.now() - this.disconnectedSince : 0; }
  onMsg(m: Msg) {
    if (this.closed) return;
    if (m.cid !== this.guestCid()) return;
    if (m.t === 'act' && m.gid === this.gid) {
      if (m.seq <= this.lastSeq) { this.sendView(); return; }          // duplicate/resend: re-ack
      this.lastSeq = m.seq;
      if (m.ver !== this.ver) { this.lobby.ch.send({ t: 'err', cid: this.lobby.me.cid, gid: this.gid, to: m.cid, seq: m.seq, msg: 'The game moved on — your action was based on an old state.' }); this.sendView(); return; }
      const action = { ...m.action, player: 1 } as Action;            // guest can only act for seat 1
      const err = this.applyFor(action);
      if (err) { this.lobby.ch.send({ t: 'err', cid: this.lobby.me.cid, gid: this.gid, to: m.cid, seq: m.seq, msg: err.slice(0, 400) }); this.sendView(); }
    } else if (m.t === 'sync' && m.gid === this.gid) {
      this.guestVer = Math.max(this.guestVer, m.have);
      this.sendView();
    } else if (m.t === 'hb' && m.gid === this.gid && (this.guestVer = Math.max(this.guestVer, m.ver), m.ver < this.ver)) {
      this.sendView();
    } else if (m.t === 'bye') {
      this.setStatus({ opponentConnected: false, banner: `${this.nameList[1]} left. They can rejoin with the room code.` });
      if (!this.disconnectedSince) this.disconnectedSince = Date.now();
    }
  }
  onHeartbeat() {
    const ok = this.lobby.seen(this.guestCid());
    if (ok) { this.disconnectedSince = 0; this.setStatus({ opponentConnected: true, banner: undefined }); }
    else {
      if (!this.disconnectedSince) this.disconnectedSince = Date.now();
      this.setStatus({ opponentConnected: false, banner: `${this.nameList[1]} disconnected — waiting for them to reconnect…` });
    }
  }
}

export class GuestSession extends BaseOnline implements GameSession {
  private current: PlayerView | null = null;
  private seq = 0;
  private outstanding: { seq: number; ver: number; action: Action; resolve: (e: string | null) => void; sentAt: number } | null = null;
  private resendTimer: Timer;
  private lastHost = Date.now();
  constructor(lobby: Lobby, gid: string, private mySeat: PlayerId, private nameList: string[], private hostCid: string, match?: MatchState, private prints: (PrintMap | null)[] = []) {
    super(lobby, gid, 'guest');
    this.status.match = match;
    this.status.waitingFor = 'Waiting for the host to send the game…';
    this.resendTimer = setInterval(() => this.resend(), 100);
    lobby.ch.send({ t: 'sync', cid: lobby.me.cid, gid, have: 0 });
  }
  names() { return [...this.nameList]; }
  printings() { return this.prints.map(p => p ?? undefined); }
  seat() { return this.mySeat; }
  view() { return this.current; }
  async act(action: Action): Promise<string | null> {
    if (this.closed) return 'Session closed';
    if (!this.current) return 'No game state yet';
    if (this.outstanding) return 'Still sending your previous action…';
    const a = { ...action, player: this.mySeat } as Action;
    return new Promise(resolve => {
      this.outstanding = { seq: ++this.seq, ver: this.ver, action: a, resolve, sentAt: 0 };
      this.resend(true);
      this.setStatus({ waitingFor: 'Sending…' });
    });
  }
  private resend(force = false) {
    const o = this.outstanding; if (!o || this.closed) return;
    const now = Date.now();
    if (!force && now - o.sentAt < RESEND_MS) return;
    o.sentAt = now;
    this.lobby.ch.send({ t: 'act', cid: this.lobby.me.cid, gid: this.gid, seq: o.seq, ver: o.ver, action: o.action });
  }
  onMsg(m: Msg) {
    if (this.closed || m.cid !== this.hostCid) return;
    this.lastHost = Date.now();
    if (m.t === 'view' && m.gid === this.gid && m.to === this.lobby.me.cid) {
      if (m.view.you !== this.mySeat) return;
      const o = this.outstanding;
      if (o && m.ack >= o.seq) { this.outstanding = null; o.resolve(m.ver > o.ver ? null : null); }
      if (m.ver < this.ver || (m.ver === this.ver && this.current)) { if (!o || m.ack >= o.seq) this.setStatus({ waitingFor: undefined }); return; }
      this.ver = m.ver;
      // ack at once (a tiny heartbeat) so the host stops repeating this view
      this.lobby.ch.send({ t: 'hb', cid: this.lobby.me.cid, gid: this.gid, ver: this.ver, role: 'guest' });
      if (m.match) this.setStatus({ match: m.match });
      this.current = unpackView(m.view, this.lobby.db);
      this.setStatus({ waitingFor: undefined });
      for (const f of this.subs) f(this.current, []);
    } else if (m.t === 'err' && m.gid === this.gid && m.to === this.lobby.me.cid) {
      const o = this.outstanding;
      if (o && o.seq === m.seq) { this.outstanding = null; o.resolve(m.msg); this.setStatus({ waitingFor: undefined }); }
    } else if (m.t === 'hb' && m.gid === this.gid && m.ver > this.ver) {
      this.lobby.ch.send({ t: 'sync', cid: this.lobby.me.cid, gid: this.gid, have: this.ver });
    } else if (m.t === 'bye') {
      this.setStatus({ opponentConnected: false, ended: 'The host left, so the game has ended.' });
    }
  }
  onHeartbeat(now: number) {
    const gone = now - this.lastHost;
    if (this.status.ended) return;
    if (gone > HOST_GONE_MS) this.setStatus({ opponentConnected: false, ended: 'Lost connection to the host. The game cannot continue.' });
    else if (gone > PEER_TIMEOUT_MS) this.setStatus({ opponentConnected: false, banner: 'Connection to the host lost — retrying…' });
    else this.setStatus({ opponentConnected: true, banner: undefined });
    if (!this.current) this.lobby.ch.send({ t: 'sync', cid: this.lobby.me.cid, gid: this.gid, have: this.ver });
  }
  close() { super.close(); clearInterval(this.resendTimer); this.outstanding?.resolve('Session closed'); this.outstanding = null; }
}

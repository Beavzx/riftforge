// Riftforge app shell: home, deck builder, online lobby, game.
import type { DeckList, PlayerId, PlayerView } from '../engine/types';
import { chooseBotAction } from './mock';
import { h, clear, store, uid, append } from './dom';
import { type CardDb, loadCardDb } from './cards';
import { type SavedDeck, loadDecks, starterDecks, deckSummary } from './decks';
import { DeckBuilder } from './deckbuilder';
import { Board } from './board';
import { LocalSession, type GameSession } from '../net/session';
import { Lobby, normCode, randomCode, type LobbyState, HostSession, loadHostSave, clearHostSave } from '../net/online';
import { getRoom } from '../net/room';
import { type MatchOptions, type MatchState, DEFAULT_OPTIONS, newMatch, nextGame, matchOver, sanitizeOptions, withOptions } from '../net/match';
import { validateDeck, ENGINE_SOURCE, scriptCount } from './engine';
import { toast, modal } from './overlay';
import { openGallery } from './gallery';
import { applyTheme, themeToggle } from './theme';
import { type PrintMap, loadImageManifest } from './art';
import css from './styles.css';

type Screen = 'home' | 'decks' | 'lobby' | 'game';

const BRAND_SVG = `<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="rfg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd08a"/><stop offset="1" stop-color="#ff6a1f"/></linearGradient></defs><path d="M16 2 L29 16 L16 30 L3 16 Z" fill="none" stroke="url(#rfg)" stroke-width="2.4"/><path d="M17.5 7 L12 16.5 L16 16.5 L14.5 25 L20 14.5 L16 14.5 Z" fill="url(#rfg)"/></svg>`;

export class App {
  db!: CardDb;
  root: HTMLElement;
  screen: Screen = 'home';
  starters: SavedDeck[] = [];
  board: Board | null = null;
  lobby: Lobby | null = null;
  session: GameSession | null = null;
  name: string;
  cid: string;
  sid = uid(10);
  roomAvailable = false;
  lastLocal: { mode: 'hotseat' | 'bot' | 'botvbot'; decks: [DeckList, DeckList]; names: [string, string]; match: MatchState; printings: (PrintMap | undefined)[] } | null = null;
  opts: MatchOptions = sanitizeOptions(store.get('riftforge.opts', DEFAULT_OPTIONS));
  setOpts(o: Partial<MatchOptions>) { this.opts = sanitizeOptions({ ...this.opts, ...o }); store.set('riftforge.opts', this.opts); }
  /** AUTO-AUDIT: personal preference — every payment opens the payment prompt (Auto-pay one click, or pick runes / Seals). */
  manualPay = store.get<boolean>('riftforge.manualPay', false) === true;
  payPrefRow(onChange?: (on: boolean) => void): HTMLElement {
    const cb = h('input', { type: 'checkbox', id: 'opt-manualpay', 'data-testid': 'opt-manualpay', checked: this.manualPay }) as HTMLInputElement;
    cb.addEventListener('change', () => { this.manualPay = cb.checked; store.set('riftforge.manualPay', this.manualPay); onChange?.(this.manualPay); });
    return h('label', { class: 'row', style: { gap: '6px' }, title: 'Off: costs are paid automatically (you can still tap runes yourself first — floating Energy/Power is spent first). On: every payment asks, with Auto-pay as the one-click default, so you can choose which runes to exhaust or recycle.' },
      cb, 'Choose runes when paying');
  }

  constructor(root: HTMLElement) {
    this.root = root;
    this.name = store.get('riftforge.name', '') || 'Player ' + Math.floor(100 + Math.random() * 900);
    // Client id is per browser tab (sessionStorage survives reloads, so a reloaded tab can rejoin its seat).
    let cid = '';
    try { cid = sessionStorage.getItem('riftforge.cid') ?? ''; if (!cid) { cid = uid(12); sessionStorage.setItem('riftforge.cid', cid); } } catch { cid = uid(12); }
    this.cid = cid;
    applyTheme(store.get<'dark' | 'light' | ''>('riftforge.theme', ''));
  }

  async start() {
    this.root.append(h('div', { class: 'screen' }, h('div', { class: 'hero' }, h('h1', null, 'Riftforge'), h('p', null, 'Loading cards…'))));
    [this.db] = await Promise.all([loadCardDb(), loadImageManifest()]);
    this.starters = this.makeStarters();
    getRoom().then(r => { this.roomAvailable = !!r; if (this.screen === 'home') this.render(); });
    const hash = location.hash.slice(1);
    if (hash.startsWith('gallery')) { openGallery(this, hash.slice('gallery-'.length) || undefined); return; }
    // Auto-rejoin an online room this tab was in before a reload (guest rejoins its seat; host resumes the game).
    const cur = (() => { try { return JSON.parse(sessionStorage.getItem('riftforge.room') ?? 'null') as { code: string; role: 'host' | 'guest'; at: number } | null; } catch { return null; } })();
    if (cur && Date.now() - cur.at < 3 * 3600_000 && !hash) {
      const room = await getRoom();
      if (room) { await this.openLobby(cur.code, cur.role, true); return; }
    }
    const auto = /^autoplay-(botvbot|bot|hotseat)(?:-(\d+))?$/.exec(hash);
    if (auto) { this.startLocal(auto[1] as 'botvbot' | 'bot' | 'hotseat', Number(auto[2] ?? 30)); return; }
    this.render();
  }

  makeStarters(): SavedDeck[] {
    // Main-deck size: try 39 (+ champion = 40); if the engine wants 40 in main, use that.
    let st = starterDecks(this.db, 39);
    if (st.length && !validateDeck(st[0].deck, this.db.byId).ok) {
      const alt = starterDecks(this.db, 40);
      if (alt.length && validateDeck(alt[0].deck, this.db.byId).ok) st = alt;
    }
    return st;
  }

  allDecks(): SavedDeck[] { return [...this.starters, ...loadDecks()]; }
  legalDecks(): SavedDeck[] { return this.allDecks().filter(d => validateDeck(d.deck, this.db.byId).ok); }

  go(s: Screen) { this.screen = s; this.render(); }

  nav(): HTMLElement {
    return h('nav', { class: 'topnav' },
      h('a', { class: 'brand', href: '#', onClick: (e: Event) => { e.preventDefault(); this.leaveAll(); this.go('home'); }, html: `${BRAND_SVG}<span>Riftforge</span>` }),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn small ghost', onClick: () => { this.leaveAll(); this.go('decks'); } }, 'Decks'),
      themeToggle(false));
  }

  render() {
    if (this.screen === 'game') return;
    clear(this.root);
    this.root.append(this.nav());
    const scr = h('main', { class: 'screen' });
    this.root.append(scr);
    if (this.screen === 'home') this.home(scr);
    else if (this.screen === 'decks') new DeckBuilder(scr, this.db, this.starters, () => { /* decks changed */ });
    else if (this.screen === 'lobby') this.lobbyScreen(scr);
  }

  deckSelect(id: string, label: string, pref?: string): HTMLSelectElement {
    const decks = this.legalDecks();
    const sel = h('select', { id, 'aria-label': label, style: { width: '100%' } }, decks.map(d => h('option', { value: d.id }, d.name))) as HTMLSelectElement;
    const saved = store.get<string>('riftforge.deck.' + id, pref ?? '');
    if (decks.some(d => d.id === saved)) sel.value = saved; else if (pref && decks.some(d => d.id === pref)) sel.value = pref;
    sel.addEventListener('change', () => store.set('riftforge.deck.' + id, sel.value));
    return sel;
  }
  deckById(id: string) { return this.allDecks().find(d => d.id === id); }

  optionsRow(editable: boolean, o: MatchOptions, set: (p: Partial<MatchOptions>) => void): HTMLElement {
    const sel = (label: string, id: string, value: string, opts: [string, string][], on: (v: string) => void) => {
      const el = h('select', { id, 'aria-label': label, disabled: !editable }, opts.map(([v, t]) => h('option', { value: v, selected: v === value }, t))) as HTMLSelectElement;
      el.addEventListener('change', () => on(el.value));
      return h('label', { class: 'row', style: { gap: '6px' } }, label, el);
    };
    const ban = h('input', { type: 'checkbox', id: 'opt-banlist', checked: o.enforceBanlist, disabled: !editable }) as HTMLInputElement;
    ban.addEventListener('change', () => set({ enforceBanlist: ban.checked }));
    return h('div', { class: 'row', 'data-testid': 'options', style: { gap: '14px' } },
      sel('Battlefields', 'opt-bf', o.battlefieldSelection, [['choose', 'Each player chooses'], ['random', 'Random']], v => set({ battlefieldSelection: v as MatchOptions['battlefieldSelection'] })),
      sel('Match', 'opt-bo', String(o.bestOf), [['1', 'Best of 1'], ['3', 'Best of 3']], v => set({ bestOf: v === '3' ? 3 : 1 })),
      h('label', { class: 'row', style: { gap: '6px' } }, ban, 'Enforce banlist'));
  }

  home(scr: HTMLElement) {
    const decks = this.legalDecks();
    const nameIn = h('input', { type: 'text', value: this.name, maxlength: 24, 'aria-label': 'Your name', style: { width: '12em' } }) as HTMLInputElement;
    nameIn.addEventListener('change', () => { this.name = nameIn.value.trim().slice(0, 24) || this.name; store.set('riftforge.name', this.name); });
    const myDeck = this.deckSelect('deck-me', 'Your deck');
    const oppDeck = this.deckSelect('deck-opp', 'Opponent deck', decks[1]?.id);
    const codeIn = h('input', { type: 'text', class: 'code-input', placeholder: 'CODE', maxlength: 8, 'aria-label': 'Room code', 'data-testid': 'join-code' }) as HTMLInputElement;
    const rejoin = store.get<{ code: string; at: number } | null>('riftforge.lastRoom', null);
    append(scr, [
      h('div', { class: 'hero' }, h('h1', null, 'Riftforge'), h('p', null, 'A fully automated table for Riftbound. The rules engine handles everything; you make the decisions.')),
      !decks.length ? h('div', { class: 'panel err' }, 'No legal decks yet. Card data may be missing — open the deck builder to import one.') : null,
      h('div', { class: 'panel row', style: { justifyContent: 'center' } },
        h('label', { for: 'nm' }, 'Name'), nameIn,
        h('label', null, 'Your deck'), h('div', { style: { minWidth: '220px' } }, myDeck),
        h('button', { class: 'btn small', onClick: () => this.go('decks') }, 'Edit decks'),
        h('div', { style: { flexBasis: '100%', display: 'flex', justifyContent: 'center', gap: '14px', flexWrap: 'wrap' } }, this.optionsRow(true, this.opts, p => this.setOpts(p)), this.payPrefRow())),
      h('div', { class: 'grid-modes' },
        h('div', { class: 'panel mode-card' }, h('h3', null, 'Versus bot'), h('p', null, 'Practice against the built-in bot.'),
          h('label', null, 'Bot deck'), oppDeck,
          h('button', { class: 'btn primary', 'data-testid': 'play-bot', disabled: !decks.length, onClick: () => this.startLocal('bot') }, 'Play vs bot')),
        h('div', { class: 'panel mode-card' }, h('h3', null, 'Online'), h('p', null, this.roomAvailable ? 'Create a room and share the code, or join a friend.' : 'Online play needs the page’s room capability, which isn’t available here.'),
          h('button', { class: 'btn primary', 'data-testid': 'create-room', disabled: !this.roomAvailable || !decks.length, onClick: () => this.openLobby(randomCode(), 'host') }, 'Create room'),
          h('div', { class: 'row' }, codeIn, h('button', { class: 'btn', 'data-testid': 'join-room', disabled: !this.roomAvailable, onClick: () => { const c = normCode(codeIn.value); if (c.length < 4) { toast('Enter the room code.', 'bad'); return; } this.openLobby(c, 'guest'); } }, 'Join')),
          rejoin && Date.now() - rejoin.at < 3 * 3600_000 && this.roomAvailable ? h('button', { class: 'btn small', onClick: () => this.openLobby(rejoin.code, 'guest') }, `Rejoin room ${rejoin.code}`) : null),
        h('div', { class: 'panel mode-card' }, h('h3', null, 'Play both sides'), h('p', null, 'Hotseat: you make every decision for both players. Great for learning and testing.'),
          h('button', { class: 'btn', 'data-testid': 'play-hotseat', disabled: !decks.length, onClick: () => this.startLocal('hotseat') }, 'Start hotseat'),
          h('button', { class: 'btn small', 'data-testid': 'play-botvbot', disabled: !decks.length, onClick: () => this.startLocal('botvbot') }, 'Watch bot vs bot'))),
      h('p', { class: 'faint', style: { textAlign: 'center', marginTop: '24px', fontSize: '12px' } },
        `${this.db.list.length} cards loaded · engine: ${ENGINE_SOURCE} (${scriptCount()} card scripts) · Riftforge is a fan-made client; Riftbound is a trademark of Riot Games.`)]);
  }

  startLocal(mode: 'hotseat' | 'bot' | 'botvbot', botDelay?: number) {
    const decks = this.legalDecks();
    const a = this.deckById((document.getElementById('deck-me') as HTMLSelectElement | null)?.value ?? '') ?? decks[0];
    const b = this.deckById((document.getElementById('deck-opp') as HTMLSelectElement | null)?.value ?? '') ?? decks[1] ?? decks[0];
    if (!a || !b) { toast('No legal decks available.', 'bad'); return; }
    const names: [string, string] = mode === 'bot' ? [this.name, 'Forge Bot'] : mode === 'botvbot' ? ['Bot Ember', 'Bot Cinder'] : [this.name + ' (P1)', this.name + ' (P2)'];
    this.lastLocal = { mode, decks: [a.deck, b.deck], names, match: newMatch(this.opts.bestOf), printings: [a.printings, b.printings] };
    this.launchLocal(botDelay);
  }
  launchLocal(botDelay?: number, firstPlayer?: PlayerId) {
    const L = this.lastLocal!;
    const seed = Math.floor(Math.random() * 2 ** 31);
    let sess: LocalSession;
    try {
      const setup = withOptions({ seed, cardDb: this.db.byId, players: [{ name: L.names[0], deck: L.decks[0] }, { name: L.names[1], deck: L.decks[1] }] }, this.opts, firstPlayer);
      // human seats only (bot: seat 0, hotseat: both)
      if (this.manualPay && L.mode !== 'botvbot') setup.manualPay = [true, L.mode === 'hotseat'];
      sess = new LocalSession(setup, L.mode, { botDelay: botDelay ?? (L.mode === 'botvbot' ? 350 : 700), match: L.match, printings: L.printings });
    } catch (e) { toast('Could not start game: ' + (e as Error).message, 'bad'); console.error(e); return; }
    const next = (loser: PlayerId, goFirst: boolean) => {
      const m = sess.status.match; if (!m || matchOver(m)) return;
      L.match = nextGame(m);
      this.launchLocal(botDelay, (goFirst ? loser : 1 - loser) as PlayerId);
    };
    // Bots that lose a game choose to go first in the next one.
    sess.onStatus(st => {
      const m = st.match; const w = sess.state.winner;
      if (!m || m.bestOf === 1 || matchOver(m) || w === null) return;
      const loser = (1 - w) as PlayerId;
      if (L.mode === 'botvbot' || (L.mode === 'bot' && loser === 1)) setTimeout(() => { if (this.session === sess) next(loser, true); }, L.mode === 'botvbot' ? 1500 : 2500);
    });
    this.showGame(sess, () => { L.match = newMatch(this.opts.bestOf); this.launchLocal(botDelay); }, next);
  }

  showGame(sess: GameSession, rematch?: () => void, onNextGame?: (loser: PlayerId, goFirst: boolean) => void) {
    this.session = sess;
    this.screen = 'game';
    clear(this.root);
    this.board?.destroy();
    this.board = new Board(this.root, sess, this.db, { onExit: () => { this.leaveAll(); this.go('home'); }, onRematch: rematch, onNextGame: onNextGame ?? (this.lobby ? (l, f) => this.lobby?.chooseNext(l, f) : undefined) });
    (globalThis as Record<string, unknown>).__riftforge = { app: this, board: this.board, session: sess, lobby: this.lobby, botFromView: (v: PlayerView) => chooseBotAction(v) };
  }

  leaveAll() {
    try { sessionStorage.removeItem('riftforge.room'); } catch { /* ignore */ }
    clearHostSave();
    this.board?.destroy(); this.board = null;
    this.session?.close(); this.session = null;
    this.lobby?.leave(); this.lobby = null;
  }

  // ---------- online ----------
  lobbyState: LobbyState | null = null;
  async openLobby(code: string, role: 'host' | 'guest', resume = false) {
    const save = role === 'host' && resume ? loadHostSave() : null;
    this.leaveAll();
    const lobby = await Lobby.open(code, role, { cid: this.cid, sid: this.sid, name: this.name }, this.db.byId);
    if (!lobby) { toast('Online play is not available on this page.', 'bad'); return; }
    this.lobby = lobby;
    store.set('riftforge.lastRoom', { code: lobby.state.code, at: Date.now() });
    try { sessionStorage.setItem('riftforge.room', JSON.stringify({ code: lobby.state.code, role, at: Date.now() })); } catch { /* ignore */ }
    lobby.onStarted(sess => this.showGame(sess));
    if (role === 'host') lobby.setOptions(this.opts);
    if (role === 'host' && resume) {
      if (save && save.code === lobby.state.code && Date.now() - save.at < 3 * 3600_000) {
        this.screen = 'lobby';
        lobby.subscribe(s => { this.lobbyState = s; });
        if (lobby.resumeHost(save)) { toast('Resumed your hosted game.'); return; }
      }
    }
    lobby.subscribe(s => { this.lobbyState = s; if (this.screen === 'lobby') this.render(); });
    (globalThis as Record<string, unknown>).__riftforge = { app: this, lobby };
    const d = this.deckById(store.get<string>('riftforge.deck.deck-me', '')) ?? this.legalDecks()[0];
    lobby.setManualPay(this.manualPay);
    if (d) lobby.setDeck(d.deck, d.name, d.printings);
    this.go('lobby');
  }

  lobbyScreen(scr: HTMLElement) {
    const l = this.lobby; const s = this.lobbyState;
    if (!l || !s) { scr.append(h('p', null, 'No lobby.')); return; }
    const mySeat = s.seats.find(x => x.cid === this.cid);
    const deckSel = this.deckSelect('deck-me', 'Your deck');
    deckSel.addEventListener('change', () => { const d = this.deckById(deckSel.value); if (d) { l.setDeck(d.deck, d.name, d.printings); } });
    const copyCode = () => navigator.clipboard?.writeText(s.code).then(() => toast('Room code copied.'), () => toast('Copy blocked — share the code shown.', 'bad'));
    const ready = !!mySeat?.ready;
    append(scr, [h('div', { class: 'panel col', style: { maxWidth: '640px', margin: '20px auto' }, 'data-testid': 'lobby' },
      h('div', { class: 'row', style: { justifyContent: 'space-between' } },
        h('div', null, h('div', { class: 'muted' }, s.role === 'host' ? 'Your room — share this code' : 'Room'), h('div', { class: 'room-code', 'data-testid': 'room-code' }, s.code)),
        h('button', { class: 'btn small', onClick: copyCode }, 'Copy code')),
      s.error ? h('div', { class: 'err', role: 'alert' }, s.error) : null,
      s.role === 'guest' && !s.joined && !s.error ? h('div', { class: 'muted' }, 'Looking for the host…') : null,
      s.role === 'guest' && s.joined && !s.hostConnected ? h('div', { class: 'warn' }, 'Host connection lost — waiting…') : null,
      h('h3', { style: { margin: '6px 0 0' } }, 'Players'),
      h('div', { class: 'col' }, s.seats.map((seat, i) => h('div', { class: 'seat' },
        h('span', { class: ['dot', seat.connected !== false && 'on'] }),
        h('span', { class: 'name' }, seat.name), h('span', { class: 'pill' }, i === 0 ? 'Host' : 'Guest'), seat.cid === this.cid ? h('span', { class: 'pill' }, 'You') : null,
        h('span', { class: 'grow muted', style: { fontSize: '12px' } }, seat.deckName ?? ''),
        seat.deckOk === false ? h('span', { class: 'err' }, 'Deck not legal') : null,
        h('span', { class: seat.ready ? 'ok' : 'muted' }, seat.ready ? 'Ready' : 'Not ready'))),
        s.seats.length < 2 ? h('div', { class: 'seat muted' }, h('span', { class: 'dot' }), 'Waiting for an opponent to join…') : null),
      h('label', null, 'Your deck'), deckSel,
      h('h3', { style: { margin: '6px 0 0' } }, 'Options'),
      this.optionsRow(s.role === 'host' && !s.started, s.opts, p => { this.setOpts(p); l.setOptions(p); }),
      s.role === 'guest' ? h('div', { class: 'faint', style: { fontSize: '12px' } }, 'The host sets the options.') : null,
      this.payPrefRow(on => l.setManualPay(on)),
      h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
        h('button', { class: 'btn', onClick: () => { this.leaveAll(); this.go('home'); } }, 'Leave'),
        h('button', { class: ['btn', !ready && 'primary'], 'data-testid': 'ready', disabled: s.started || (s.role === 'guest' && !s.joined), onClick: () => {
          const d = this.deckById(deckSel.value); if (d) l.setDeck(d.deck, d.name, d.printings); l.setReady(!ready);
        } }, ready ? 'Not ready' : 'Ready'),
        s.role === 'host' ? h('button', { class: 'btn primary', 'data-testid': 'start', disabled: !l.canStart(), onClick: () => { if (!l.startGame()) toast('Both players must be ready with legal decks.', 'bad'); } }, 'Start game') : null),
      s.started && !(this.session) ? h('div', { class: 'muted' }, 'Game in progress…') : null)]);
  }
}

export function boot() {
  (globalThis as Record<string, unknown>).__riftforgeInfo = { engine: ENGINE_SOURCE, scripts: scriptCount() };
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  const root = document.getElementById('app') ?? document.body.appendChild(h('div', { id: 'app' }));
  const app = new App(root);
  app.start().catch(e => { console.error(e); root.append(h('pre', { class: 'err' }, String(e?.stack ?? e))); });
  window.addEventListener('error', e => console.error('[riftforge]', e.message));
  void modal; void HostSession; void deckSummary;
  return app;
}
void (0 as unknown as PlayerId);

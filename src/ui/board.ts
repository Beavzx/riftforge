// The game board. Renders a PlayerView, highlights only legal actions, and sends intents through a GameSession.
import type { Action, CardDef, Decision, GameEvent, GameObject, GameState, ObjId, PlayerId, PlayerView } from '../engine/types';
import type { GameSession, SessionStatus } from '../net/session';
import { h, clear, reducedMotion } from './dom';
import { type CardDb, type CardRec, DOMAIN_COLORS, renderCard, cardBack, mainDomain, rulesHtml, objMight, objKeywords } from './cards';
import { indexLegal, moveDestinations, findMove, findChoose, optionBattlefield, isMine, optionObjs, type LegalIndex } from './legal';
import { animate, snapshot, type Snapshot } from './anim';
import { modal, toast, popover, closePopover, showPreview, hidePreview, confirmDialog } from './overlay';
import { renderPrompt, type PromptUi, freshPromptUi, initPayUi } from './prompt';
import { resolvePrinted, warmArt, imageCandidates } from './art';
import { themeToggle } from './theme';
import { matchWinner } from '../net/match';

const PHASES: [GameState['phase'], string][] = [['awaken', 'Awaken'], ['beginning', 'Beginning'], ['channel', 'Channel'], ['draw', 'Draw'], ['action', 'Action'], ['end', 'End']];
const UNIT_TYPES = new Set(['Unit', 'Token']);

export interface BoardOpts { onExit: () => void; onRematch?: () => void; title?: string; onNextGame?: (loser: PlayerId, goFirst: boolean) => void }

export class Board {
  root: HTMLElement;
  view: PlayerView | null = null;
  idx: LegalIndex = indexLegal([]);
  private prevState: GameState | null = null;
  private prevYou: PlayerId | null = null;
  private snap: Snapshot | null = null;
  private selHand: ObjId | null = null;
  private selUnits = new Set<ObjId>();
  private sideOpen = false;
  private busy = false;
  private dragging = false;
  private queued: PlayerView | null = null;
  private pendingKey = '';
  pui: PromptUi = freshPromptUi();
  private status: SessionStatus;
  private unsubs: (() => void)[] = [];
  private logScrollPinned = true;

  constructor(private host: HTMLElement, public session: GameSession, public db: CardDb, private opts: BoardOpts) {
    this.root = h('div', { class: 'game', id: 'game' });
    clear(host); host.appendChild(this.root);
    this.status = session.status;
    this.unsubs.push(session.subscribe((v, ev) => this.onView(v, ev)));
    this.unsubs.push(session.onStatus(s => { this.status = s; this.render(); }));
    const v = session.view();
    if (v) this.onView(v, []); else this.render();
    // re-render when crossing the desktop/narrow breakpoint (prompts dock in different places)
    try { const mq = matchMedia('(min-width: 720px)'); const f = () => this.render(); mq.addEventListener('change', f); this.unsubs.push(() => mq.removeEventListener('change', f)); } catch { /* ignore */ }
    this.root.addEventListener('pointerdown', e => { if (!(e.target as Element).closest('.card,.popover,.prompt,.btn,.rune,[data-drop],.bf')) { this.clearSel(); } });
    // UI-CANCEL: Esc backs out of the play being made (dialogs and text fields keep their own Esc)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !this.idx.cancel || !this.root.isConnected) return;
      const t = e.target as Element | null;
      if (t?.closest?.('.modal-back,input,textarea,select') || document.querySelector('.modal-back')) return;
      e.preventDefault(); this.act(this.idx.cancel);
    };
    document.addEventListener('keydown', onKey);
    this.unsubs.push(() => document.removeEventListener('keydown', onKey));
  }

  destroy() { for (const u of this.unsubs) u(); this.session.close(); hidePreview(); closePopover(); this.handZoom(null); }

  private warmed = false;
  /** Load the image atlases of the cards in this game first (visible cards + imported printings), the rest when idle. */
  private warm(v: PlayerView) {
    if (this.warmed) return; this.warmed = true;
    const codes: string[] = [];
    for (const o of Object.values(v.state.objects)) { const c = this.card(o); const k = c ? imageCandidates(c, this.printed(o))[0] : undefined; if (k) codes.push(k); }
    for (const m of this.session.printings?.() ?? []) if (m) codes.push(...Object.values(m));
    warmArt(codes);
  }
  private onView(v: PlayerView, _events: GameEvent[]) {
    if (this.dragging) { this.queued = v; return; }
    this.view = v;
    this.warm(v);
    this.idx = indexLegal(isMine(v) && !this.spectator() ? v.legal : []);
    const key = `${v.you}|${v.state.actionCount}|${v.pending?.kind}|${v.pending?.player}|${v.pending?.prompt}`;
    if (key !== this.pendingKey) { this.pendingKey = key; this.pui = freshPromptUi(); this.selHand = null; this.selUnits.clear(); closePopover(); }
    if (v.pending?.kind === 'payment' && v.pending.player === v.you) initPayUi(this.pui, v.pending);
    // drop stale selections
    for (const u of [...this.selUnits]) if (!this.idx.movable.has(u)) this.selUnits.delete(u);
    if (this.selHand && !this.idx.play.has(this.selHand)) this.selHand = null;
    this.render();
  }

  // ---------- helpers ----------
  card(o: GameObject | undefined): CardRec | undefined {
    if (!o || o.cardId === 'hidden') return undefined;
    return (this.db.byId[o.cardId] ?? this.view?.state.cards[o.cardId]) as CardRec | undefined;
  }
  obj(id: ObjId) { return this.view?.state.objects[id]; }
  bfName(i: number) { const s = this.view?.state; if (!s) return `Battlefield ${i + 1}`; const b = s.battlefields[i]; return this.card(s.objects[b?.objId])?.name ?? `Battlefield ${i + 1}`; }
  me(): PlayerId { return this.view?.you ?? 0; }
  spectator() { return this.status.mode === 'botvbot'; }
  opp(): PlayerId { const s = this.view?.state; const me = this.me(); return (s?.players.find(p => p.id !== me)?.id ?? (1 - me)) as PlayerId; }
  private clearSel() { if (this.selHand || this.selUnits.size) { this.selHand = null; this.selUnits.clear(); this.render(); } }

  async act(a: Action) {
    if (this.busy) return;
    closePopover(); hidePreview();
    this.busy = true;
    const err = await this.session.act(a);
    this.busy = false;
    if (err) { toast(err, 'bad'); this.render(); }
  }
  private unitsAt(bf: number): GameObject[] {
    const s = this.view!.state;
    const bfObj = s.battlefields[bf]?.objId;
    return Object.values(s.objects).filter(o => o.zone === 'battlefield' && o.battlefieldIndex === bf && o.id !== bfObj && this.card(o)?.type !== 'Battlefield')
      .sort((a, b) => a.timestamp - b.timestamp);
  }
  private facedownAt(bf: number): GameObject[] {
    const s = this.view!.state;
    return Object.values(s.objects).filter(o => o.zone === 'facedown' && o.battlefieldIndex === bf);
  }
  /** Printed code (alt art) the owner imported for this object's card, resolved to a printings.json key. */
  printed(o: GameObject | undefined): string | null {
    if (!o || o.cardId === 'hidden') return null;
    const raw = this.session.printings?.()?.[o.owner]?.[o.cardId];
    if (!raw) return null;
    const key = o.cardId + '|' + raw;
    if (!this.printCache.has(key)) this.printCache.set(key, resolvePrinted(raw, o.cardId, this.db.printings));
    return this.printCache.get(key)!;
  }
  private printCache = new Map<string, string | null>();
  /** Contextual prompt anchored at a battlefield (showdown focus), built in render(). */
  private ctxPrompt: { bf: number; el: HTMLElement } | null = null;
  private wide = () => { try { return matchMedia('(min-width: 720px)').matches; } catch { return true; } };

  // ---------- render ----------
  render() {
    const v = this.view;
    this.handZoom(null);
    const keepLog = this.root.querySelector('.log');
    if (keepLog) this.logScrollPinned = keepLog.scrollTop + keepLog.clientHeight >= keepLog.scrollHeight - 30;
    const prevSnap = this.snap ?? (this.root.isConnected ? snapshot(this.root) : null);
    const animFrom = snapshot(this.root);
    clear(this.root);
    if (!v) {
      this.root.append(h('div', { class: 'g-main connecting' }, this.hud(null), h('div', { class: 'panel', style: { margin: 'auto', textAlign: 'center' } },
        h('h2', null, 'Connecting…'), h('p', { class: 'muted' }, this.status.waitingFor ?? 'Waiting for game state.'))));
      if (this.status.ended) this.root.append(this.endedOverlay(this.status.ended));
      return;
    }
    const s = v.state; const me = this.me(); const op = this.opp();
    this.root.style.setProperty('--nbf', String(Math.max(1, s.battlefields.length)));
    const mine = isMine(v) && !this.spectator();
    const pending = v.pending;
    const optObjs = mine ? optionObjs(pending) : new Map<ObjId, string>();
    const moveDests = this.selUnits.size ? moveDestinations(this.idx, [...this.selUnits]) : [];
    const playDests = this.selHand ? this.playDestinations(this.selHand) : [];
    const dests = new Set<number | 'base'>([...moveDests, ...playDests]);
    const bfOpts = new Map<number | 'base', string>();
    if (mine && pending?.options) for (const o of pending.options) { const b = optionBattlefield(o, s); if (b !== null && (pending.kind === 'chooseBattlefield' || pending.kind === 'chooseDestination' || pending.kind === 'chooseShowdown' || !o.objIds?.length || s.battlefields.some(x => x.objId === o.objIds![0]))) bfOpts.set(b, o.id); }

    // Contextual prompts: responding to the chain happens on the top chain card (chain display, right side of
    // the board); a showdown focus decision on the battlefield where the showdown is. The centre round button
    // ends the turn (or passes when nothing else carries the pass).
    const ctxKind = mine && (pending?.kind === 'chainResponse' || pending?.kind === 'showdownAction') ? pending.kind : null;
    this.ctxPrompt = ctxKind === 'showdownAction' && !s.chain.length && s.showdown ? { bf: s.showdown.battlefieldIndex, el: this.showdownPrompt() } : null;
    const bfs = h('div', { class: 'bfs' }, s.battlefields.map((_, i) => this.battlefield(i, dests.has(i), bfOpts.get(i), optObjs)));
    const chainEl = this.chainStack(!!ctxKind);
    let floatingFocus: HTMLElement | null = null;
    if (ctxKind && !chainEl && !this.ctxPrompt) floatingFocus = this.showdownPrompt(true); // focus without a known showdown location
    if (floatingFocus) bfs.appendChild(floatingFocus);
    if (this.selUnits.size && mine) bfs.appendChild(this.moveBar(moveDests));
    const passElsewhere = !!(this.idx.pass && (chainEl?.querySelector('[data-testid="pass"]') || this.ctxPrompt || floatingFocus));
    const table = h('div', { class: ['table', s.chain.length > 0 && 'has-chain'] },
      this.mat(op, false, optObjs),
      bfs,
      this.mat(me, true, optObjs, dests.has('base'), bfOpts.get('base')),
      chainEl,
    );
    const wide = this.wide();
    const dock = h('div', { class: 'dock' });
    const endBtn = this.endButton(passElsewhere);
    if (wide) table.appendChild(endBtn);
    const hud = this.hud(v);
    const main = h('div', { class: 'g-main' }, hud, table, dock, this.handZone(me, optObjs));
    // Prompts: compact ones sit next to the card / zone they are about (source card, chain card, runes for
    // payment, the battlefield for damage); big decisions float over the battlefields. Phones: compact
    // prompts dock in a bar above the hand.
    const promptEl = this.spectator() || ctxKind ? null : renderPrompt(this);
    const waiting = !!promptEl && promptEl.classList.contains('waiting');
    if (promptEl && waiting) hud.querySelector('.hud-status')?.replaceChildren(promptEl);
    else if (promptEl && !wide && promptEl.classList.contains('min')) dock.appendChild(promptEl);
    else if (promptEl) table.appendChild(promptEl);
    if (!wide && !dock.childElementCount) dock.appendChild(h('div', { class: 'status-line' }, this.statusText()));
    if (!wide) dock.appendChild(endBtn);
    this.root.append(main, this.side());
    if (promptEl && !waiting && wide) this.placePrompt(promptEl, table);
    if (this.status.banner) this.root.append(h('div', { class: 'banner', role: 'status' }, this.status.banner));
    if (s.winner !== null || s.phase === 'gameOver') this.root.append(this.gameOver());
    else if (this.status.ended) this.root.append(this.endedOverlay(this.status.ended));
    const log = this.root.querySelector('.log'); if (log && this.logScrollPinned) log.scrollTop = log.scrollHeight;
    // animations from previous view
    const youSame = this.prevYou === v.you;
    if (youSame) animate(animFrom.rects.size ? animFrom : prevSnap, this.root, this.prevState, s, me);
    this.prevState = s; this.prevYou = v.you; this.snap = null;
  }
  private topChainName(): string {
    const s = this.view!.state; const top = s.chain[s.chain.length - 1];
    if (!top) return '';
    return this.card(s.objects[top.source])?.name ?? 'the top item';
  }
  private passLabel(): string {
    const s = this.view!.state;
    if (s.chain.length) return `Pass — let ${this.topChainName()} resolve`;
    if (this.view!.pending?.kind === 'showdownAction') return 'Pass focus';
    return 'Pass';
  }
  /** The chain display ("now resolving"), on the right side of the board: the top item's card shown large with
   *  the pass / respond controls on top of it, the rest of the chain stacked beneath. */
  private chainStack(respond: boolean): HTMLElement | null {
    const v = this.view!; const s = v.state; const me = this.me();
    if (!s.chain.length) return null;
    const top = s.chain[s.chain.length - 1];
    const topName = this.topChainName();
    const who = (pl: PlayerId) => pl === me ? 'Your' : (s.players[pl]?.name ?? 'Opponent') + '’s';
    const targetsOf = (it: typeof top) => it.targets.flat().map(t => this.card(s.objects[t])?.name ?? '?');
    const p = v.pending;
    const canPass = respond && !!p && !!this.idx.pass;
    // top item: large card with the pass button on it
    const tsrc = s.objects[top.source]; const tc = this.card(tsrc);
    const big = tc ? renderCard(tc, { size: 'md', printed: this.printed(tsrc), eager: true, classes: ['ci-card', 'cs-big'] }) : cardBack(undefined, 'md', ['ci-card', 'cs-big']);
    big.removeAttribute('data-obj');
    const ttg = targetsOf(top);
    const topEl = h('div', { class: ['chain-item', 'top', top.controller === me ? 'mine' : 'theirs'], dataset: { card: tsrc?.cardId } },
      h('div', { class: 'cs-card' }, big,
        canPass ? h('button', { class: 'btn primary chain-pass', 'data-testid': 'pass', onClick: (e: Event) => { e.stopPropagation(); this.act(this.idx.pass!); } }, this.passLabel()) : null),
      h('div', { class: 'ci-body' },
        h('span', { class: 'ci-name', title: tc?.name ?? 'Hidden' }, tc?.name ?? 'Hidden'),
        top.label && top.label !== tc?.name ? h('span', { class: 'ci-sub', title: top.label }, top.label) : null,
        h('span', { class: 'ci-meta', title: `${who(top.controller)} ${top.kind}${ttg.length ? ' → ' + ttg.join(', ') : ''}` }, `${who(top.controller)} ${top.kind}${ttg.length ? ' → ' + ttg.join(', ') : ''}`)));
    topEl.prepend(h('div', { class: 'ci-next' }, h('span', null, 'Resolves next'), h('b', { title: `${s.chain.length} item${s.chain.length > 1 ? 's' : ''} on the chain` }, String(s.chain.length))));
    this.hoverPreview(big, tc, ttg.length ? [`Targets: ${ttg.join(', ')}`] : [], this.printed(tsrc));
    const rest = [...s.chain].reverse().slice(1).map(it => {
      const src = s.objects[it.source]; const c = this.card(src);
      const thumb = c ? renderCard(c, { size: 'sm', printed: this.printed(src), eager: true, classes: ['ci-card'] }) : cardBack(undefined, 'sm', ['ci-card']);
      thumb.removeAttribute('data-obj');
      const tg = targetsOf(it);
      const desc = `${c?.name ?? 'Hidden'} — ${who(it.controller)} ${it.kind}${tg.length ? ' → ' + tg.join(', ') : ''}`;
      const el = h('div', { class: ['chain-item', 'ci-thumb', it.controller === me ? 'mine' : 'theirs'], dataset: { card: src?.cardId }, title: desc, 'aria-label': desc }, thumb);
      this.hoverPreview(el, c, tg.length ? [`Targets: ${tg.join(', ')}`] : [], this.printed(src));
      return el;
    });
    const waitingFor = p ? (s.players[p.player]?.name ?? 'Opponent') : '';
    let foot: HTMLElement;
    if (respond && p) {
      const plays = this.idx.play.size + this.idx.activate.size + this.idx.moves.length;
      foot = h('div', { class: 'chain-act prompt ctx', 'data-testid': 'prompt', dataset: { kind: p.kind }, role: 'group', 'aria-label': p.prompt },
        top.controller === me && canPass ? null : h('div', { class: 'ca-msg' }, top.controller === me
          ? 'Resolves when both players pass.'
          : plays ? 'Or play a highlighted Reaction.' : 'No Reactions to play.'),
        (p.options ?? []).length ? h('div', { class: 'p-opts' }, (p.options ?? []).map(o => h('button', { class: 'btn small', 'data-testid': 'opt-' + o.id, onClick: () => this.submitChoose([o.id]) }, o.label))) : null,
        this.idx.other.length ? h('div', { class: 'p-opts' }, this.idx.other.map(a => h('button', { class: 'btn small', onClick: () => this.act(a) }, this.describe(a)))) : null,
        // no pass on the card (e.g. a hidden card): keep one here
        this.idx.pass && !canPass ? h('button', { class: 'btn primary', 'data-testid': 'pass', onClick: () => this.act(this.idx.pass!) }, this.passLabel()) : null);
    } else {
      foot = h('div', { class: 'chain-act waiting' }, p ? `${p.player === me && !this.spectator() ? 'You decide' : waitingFor + ' may respond'}…` : `${topName} is resolving…`);
    }
    return h('div', { class: ['chain-stack', 'chain-dock', rest.length > 0 && 'multi'], 'aria-label': `Chain: ${s.chain.length} item${s.chain.length > 1 ? 's' : ''}; top resolves first` },
      topEl, foot,
      rest.length ? h('div', { class: 'cs-items', title: 'Below the top item (resolve later, top to bottom)' }, rest) : null);
  }
  /** Showdown focus prompt, anchored at the showdown's battlefield. */
  private showdownPrompt(floating = false): HTMLElement {
    const v = this.view!; const s = v.state; const p = v.pending!;
    const combat = !!s.showdown?.isCombat;
    const plays = this.idx.play.size + this.idx.activate.size + this.idx.moves.length;
    return h('div', { class: ['ctx-prompt', 'prompt', 'ctx', floating && 'floating'], 'data-testid': 'prompt', dataset: { kind: p.kind }, role: 'group', 'aria-label': p.prompt },
      h('div', { class: 'cp-title' }, `${combat ? 'Combat' : 'Showdown'} — you have focus`),
      h('div', { class: 'cp-hint' }, plays ? 'Play an Action or Reaction (highlighted), or pass focus. Ends when both players pass in a row.' : 'Nothing to play. Ends when both players pass in a row.'),
      (p.options ?? []).length ? h('div', { class: 'p-opts' }, (p.options ?? []).map(o => h('button', { class: 'btn', 'data-testid': 'opt-' + o.id, onClick: () => this.submitChoose([o.id]) }, o.label))) : null,
      this.idx.other.length ? h('div', { class: 'p-opts' }, this.idx.other.map(a => h('button', { class: 'btn', onClick: () => this.act(a) }, this.describe(a)))) : null,
      this.idx.pass ? h('button', { class: 'btn primary', 'data-testid': 'pass', onClick: (e: Event) => { e.stopPropagation(); this.act(this.idx.pass!); } }, this.passLabel()) : null);
  }
  /** Shown while units are selected for a standard move. */
  private moveBar(dests: (number | 'base')[]): HTMLElement {
    const n = this.selUnits.size;
    return h('div', { class: 'move-bar', role: 'status', 'data-testid': 'move-bar' },
      h('span', null, h('b', null, `${n} unit${n > 1 ? 's' : ''} selected`), dests.length ? ' — click a glowing destination (or drag) to move them together' : ' — these units have no common destination'),
      h('button', { class: 'btn small', onClick: (e: Event) => { e.stopPropagation(); this.selUnits.clear(); this.render(); } }, 'Clear'));
  }
  private statusText(): string {
    const v = this.view; if (!v) return '';
    const pend = v.pending; const s = v.state;
    return this.status.waitingFor ?? (pend ? (pend.player === this.me() && !this.spectator() ? pend.prompt : `Waiting: ${s.players[pend.player]?.name ?? 'opponent'}`) : '');
  }

  /** Compact game HUD along the top edge (between the opponent's main deck and hand): menu, turn + phase,
   *  showdown / match / connection pills, seat switch, theme, log, and the status / waiting line. */
  private hud(v: PlayerView | null): HTMLElement {
    const s = v?.state;
    const me = this.me();
    const turnTxt = !s ? '' : (s.phase === 'mulligan' || v?.pending?.kind === 'mulligan') ? 'Mulligan' : s.phase === 'setup' ? 'Setup' : s.phase === 'gameOver' ? 'Game over' : `Turn ${s.turn} · ${s.activePlayer === me ? 'Your turn' : (s.players[s.activePlayer]?.name ?? 'Opponent') + "'s turn"}`;
    const st = this.status;
    return h('div', { class: 'hud g-top' },
      h('div', { class: 'hud-row' },
        h('button', { class: 'btn small menu-btn', onClick: () => this.menu(), 'aria-label': 'Game menu' }, '☰'),
        h('span', { class: ['turn', s && (s.activePlayer === me ? 'mine' : 'theirs')], 'aria-live': 'polite' }, turnTxt),
        h('span', { class: 'spacer' }),
        st.online ? h('span', { class: 'pill hide-xs', title: 'Connection' }, h('span', { class: 'dot', style: { width: '8px', height: '8px', borderRadius: '50%', background: st.opponentConnected ? 'var(--good)' : 'var(--bad)' } }), st.opponentConnected ? 'Online' : 'Opponent offline') : null,
        this.session.canSwitchSeat && s ? h('button', { class: 'btn small', onClick: () => this.session.switchSeat?.((1 - me) as PlayerId), title: 'Hotseat: switch which side you see' }, `⇄ ${s.players[me]?.name}`) : null,
        themeToggle(),
        h('button', { class: 'btn small side-toggle', onClick: () => { this.sideOpen = !this.sideOpen; this.render(); }, 'aria-expanded': String(this.sideOpen) }, 'Log')),
      s ? h('div', { class: 'hud-row' },
        h('div', { class: 'phase', 'aria-label': 'Phase' }, PHASES.map(([p, l]) => h('span', { class: s.phase === p ? 'on' : '' }, l))),
        st.match && st.match.bestOf > 1 ? h('span', { class: 'pill hide-xs', title: 'Match score' }, `Game ${st.match.game} · ${st.match.wins[0]}–${st.match.wins[1]}`) : null) : null,
      s?.showdown ? h('span', { class: 'pill sd-pill' }, `${s.showdown.isCombat ? 'Combat' : 'Showdown'} at ${this.bfName(s.showdown.battlefieldIndex)} · focus: ${s.players[s.showdown.focus]?.name}`) : null,
      s ? h('div', { class: 'hud-status status-line' }, this.statusText()) : null,
    );
  }

  private menu() {
    const items: { label: string; onClick: () => void }[] = [];
    const v = this.view;
    if (v && v.state.winner === null && this.status.mode !== 'botvbot') items.push({ label: 'Concede', onClick: async () => { if (await confirmDialog('Concede?', 'You will lose this game.', 'Concede')) this.act({ type: 'concede', player: this.me() }); } });
    const hs = this.session as GameSession & { claimWin?: () => string | null; disconnectedFor?: () => number };
    if (this.status.mode === 'host' && !this.status.opponentConnected && hs.claimWin) items.push({ label: 'Claim win (opponent gone)', onClick: () => { const e = hs.claimWin!(); if (e) toast(e, 'bad'); } });
    items.push({ label: 'Rules text help', onClick: () => this.help() });
    items.push({ label: 'Leave game', onClick: async () => { if (!v || v.state.winner !== null || await confirmDialog('Leave the game?', this.status.online ? 'Your opponent will be told you left.' : 'This game will be lost.', 'Leave')) this.opts.onExit(); } });
    popover(this.root.querySelector('.hud .menu-btn')!, 'Menu', items);
  }
  private help() {
    modal('How to play here', h('div', { class: 'col' },
      h('p', null, 'Everything is automated: the game only asks you for real decisions. Highlighted cards and zones are legal right now.'),
      h('ul', null,
        h('li', null, 'Play a card: click it in your hand (or drag it to a highlighted zone).'),
        h('li', null, 'Move units: click each unit you want to move (a blue ✓ marks it) or use “Select all” on a location, then click a glowing battlefield or your base, or drag the selection. One move takes them all together — select every unit before moving into a showdown.'),
        h('li', null, 'Abilities: click your legend, gear or a unit. If it has one usable ability it happens at once; otherwise you get a menu.'),
        h('li', null, 'Runes: click a rune to exhaust it for 1 Energy; right-click (long-press on touch, or its ↺ button) to recycle it for Power.'),
        h('li', null, 'Spells and abilities go on the chain, shown large on the right side of the board. The top item resolves when both players pass in a row: “Pass — let … resolve”. In a showdown, with nothing on the chain, you pass focus instead.'),
        h('li', null, 'Hover (or long-press on touch) any card to zoom it with its full rules text. Keywords show their reminder text.'),
        h('li', null, 'Exhausted cards are turned sideways, like on a real table.'),
        h('li', null, 'The round button in the middle of the board ends your turn. Passing happens on the chain card (right side) or on the showdown battlefield.')),
      h('h3', null, 'Battlefield colours'),
      h('div', { class: 'bf-legend' },
        h('span', { class: 'bfl me' }, 'Blue band on your side — you control it'),
        h('span', { class: 'bfl opp' }, 'Red band on their side — opponent controls it'),
        h('span', { class: 'bfl none' }, 'Grey outline — uncontrolled'),
        h('span', { class: 'bfl contested' }, 'Blue/red stripes — contested'),
        h('span', { class: 'bfl sd' }, '◎ / ⚔ — showdown / combat here')),
      h('div', { class: 'c-text', html: rulesHtml('Symbols: [1] energy, [A] any power, [C] power of your domains, [S] Might, [T] exhaust, [>] cost then effect.') })));
  }

  /** One player's half of the board. Desktop positions every piece on the full-bleed board (styles.css):
   *  opponent across the top (legend + champion far left, base, runes; deck / trash top-left, rune deck +
   *  floating pool top-right, score track and name plate top-right), you mirrored along the bottom (runes,
   *  base, legend + champion far right; rune deck + pool bottom-left, deck / trash bottom-right, score track and
   *  name plate bottom-left). Narrow screens stack `.m-bar` (counters) and `.m-row` (zones). */
  private mat(p: PlayerId, isMe: boolean, optObjs: Map<ObjId, string>, drop = false, bfOpt?: string): HTMLElement {
    const s = this.view!.state; const pl = s.players[p];
    if (!pl) return h('div');
    const legend = s.objects[pl.legend];
    // fixed-size slots: they keep their outline when empty (the champion leaves its zone), so nothing shifts
    const zoneSlot = (label: string, cls: string, content: HTMLElement | HTMLElement[] | null) =>
      h('div', { class: ['zslot', cls, !content && 'empty'] }, h('span', { class: 'zlabel' }, label), content);
    const champs = pl.championZone.map(id => this.slot(s.objects[id], optObjs));
    const active = s.activePlayer === p && s.phase !== 'gameOver';
    const trashTop = pl.trash.length ? s.objects[pl.trash[pl.trash.length - 1]] : null;
    return h('section', { class: ['mat', isMe ? 'me' : 'opp', active && 'active'], 'aria-label': `${pl.name} — ${isMe ? 'you' : 'opponent'}` },
      h('div', { class: 'm-bar' },
        this.plate(p, isMe),
        this.scoreTrack(p, isMe),
        this.pile('Deck', `deck-${p}`, pl.mainDeck.length, 'back', undefined, 'Main deck', 'p-deck'),
        this.pile('Trash', `trash-${p}`, pl.trash.length, trashTop, () => this.viewZone(`${pl.name}'s trash`, pl.trash), 'View trash', 'p-trash'),
        this.pile('Rune deck', `runes-${p}`, pl.runeDeck.length, 'rune', undefined, 'Rune deck', 'p-runedeck'),
        this.poolEl(p),
        h('button', { class: 'eye-btn banish-eye', dataset: { anchor: `banish-${p}` }, title: `View banishment (${pl.banishment.length})`, 'aria-label': `View ${pl.name}'s banishment: ${pl.banishment.length}`, onClick: () => this.viewZone(`${pl.name}'s banishment`, pl.banishment) },
          h('i', { class: 'eye', 'aria-hidden': 'true' }), h('b', null, String(pl.banishment.length))),
        !isMe ? h('div', { class: 'hand-backs', 'aria-label': `${pl.hand.length} cards in hand`, title: `${pl.hand.length} cards in hand`, style: { '--n': String(Math.min(10, pl.hand.length)) } },
          // HIDDEN-IDS: the opponent's hand cards get fresh aliases whenever a card enters their hand, so the backs are keyed
          // by position (anim.ts flies a new back in from the deck) rather than by id
          pl.hand.slice(0, 10).map((_id, i, arr) => { const b = cardBack(`hand-${p}-${i}`, 'xs'); b.style.setProperty('--off', String(i - (arr.length - 1) / 2)); return b; }),
          h('span', { class: 'n' }, String(pl.hand.length))) : null),
      h('div', { class: 'm-row' },
        h('div', { class: 'mat-legend' },
          zoneSlot('Legend', 'z-legend', legend ? this.slot(legend, optObjs) : null),
          zoneSlot('Champion', 'z-champ', champs.length ? champs : null)),
        this.baseZone(p, isMe, optObjs, drop, bfOpt),
        this.runeRow(p, isMe, optObjs)),
    );
  }

  /** Name plate: name + small icons (you / opponent tag, active-turn dot, XP). */
  private plate(p: PlayerId, isMe: boolean): HTMLElement {
    const s = this.view!.state; const pl = s.players[p];
    const active = s.activePlayer === p && s.phase !== 'gameOver';
    return h('div', { class: ['plate', 'pname', active && 'active'] },
      h('span', { class: 'nm', title: pl.name }, pl.name),
      h('span', { class: 'plate-icons' },
        h('span', { class: 'tag' }, isMe ? 'You' : 'Opp'),
        active ? h('span', { class: 'turn-dot', title: 'Active player' }) : null,
        pl.xp ? h('span', { class: 'xp', title: 'Experience' }, `XP ${pl.xp}`) : null));
  }
  /** Score track: numbered circles 0..victory score in a vertical zig-zag (current score highlighted). */
  private scoreTrack(p: PlayerId, isMe: boolean): HTMLElement {
    const s = this.view!.state; const pl = s.players[p];
    const vs = s.victoryScore || 8;
    return h('div', { class: 'score', dataset: { score: p }, style: { '--n': String(vs + 1) }, 'aria-label': `${pl.points} of ${vs} points`, title: `${pl.name}: ${pl.points} of ${vs} points` },
      Array.from({ length: vs + 1 }, (_, i) => {
        const row = isMe ? vs - i + 1 : i + 1;
        const col = i === vs ? '1 / 3' : (i % 2 === 0) === isMe ? '1' : '2';
        return h('i', { class: ['pt', i < pl.points && 'on', i === pl.points && 'cur', i === vs && 'win'], style: { gridRow: String(row), gridColumn: col } }, String(i));
      }),
      h('span', { class: 'num' }, `${pl.points}/${vs}`));
  }
  /** Floating (unspent) rune pool: "Floating · Energy N · Power N". */
  private poolEl(p: PlayerId): HTMLElement {
    const pl = this.view!.state.players[p];
    const power = Object.entries(pl.pool?.power ?? {}).filter(([, n]) => n) as [string, number][];
    const pw = power.reduce((a, [, n]) => a + n, 0);
    const e = pl.pool?.energy ?? 0;
    return h('div', { class: ['pool', (e > 0 || pw > 0) && 'has'], title: 'Floating rune pool (unspent Energy / Power)' },
      h('span', { class: 'pool-l' }, 'Floating'),
      h('span', { class: 'pool-v' }, 'Energy ', h('b', { class: 'e' }, String(e))),
      h('span', { class: 'pool-v' }, 'Power ', h('b', null, String(pw)), power.map(([d, n]) => h('span', null, Array.from({ length: n }, () => h('i', { class: `ico ico-pip pip-${d}` }))))));
  }

  /** Channelled runes beside the base: one row per domain, stacked. Click = exhaust for energy; right-click /
   *  long-press (or the ↺ button) = recycle for power. During payment, clicks build a manual payment. */
  private runeRow(p: PlayerId, isMe: boolean, optObjs: Map<ObjId, string>): HTMLElement {
    const s = this.view!.state; const pl = s.players[p];
    const mine = isMine(this.view!) && !this.spectator();
    const pay = mine && this.view!.pending?.kind === 'payment' && isMe;
    const groups = new Map<string, ObjId[]>();
    for (const id of pl.runesInPlay) { const d = mainDomain(this.card(s.objects[id])); (groups.get(d) ?? groups.set(d, []).get(d)!).push(id); }
    for (const g of groups.values()) g.sort((a, b) => Number(!!s.objects[a]?.exhausted) - Number(!!s.objects[b]?.exhausted));
    const rowEls = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dom, ids]) => h('div', { class: 'rune-grp', style: { '--rc': DOMAIN_COLORS[dom as keyof typeof DOMAIN_COLORS] } },
      ids.map(id => this.rune(id, pay, optObjs)),
      groups.size > 1 ? h('span', { class: 'rune-n', title: `${dom}: ready / total` }, `${ids.filter(i => !s.objects[i]?.exhausted).length}/${ids.length}`) : null));
    const ready = pl.runesInPlay.filter(id => !s.objects[id]?.exhausted).length;
    // runes are shown at card size in one row; they overlap more as the row fills up
    const n = pl.runesInPlay.length;
    const ov = n <= 4 ? 0.06 : n <= 6 ? -0.18 : n <= 8 ? -0.36 : n <= 10 ? -0.5 : -0.6;
    return h('div', { class: ['zone', 'runes-zone'], style: { '--rov': String(ov) }, 'aria-label': `Runes: ${ready} of ${pl.runesInPlay.length} ready` },
      h('span', { class: 'zlabel' }, 'Runes'),
      h('span', { class: 'zcount', title: 'Ready / total runes' }, `${ready}/${pl.runesInPlay.length}`),
      h('div', { class: 'runes' }, rowEls));
  }
  private rune(id: ObjId, pay: boolean, optObjs: Map<ObjId, string>): HTMLElement {
    const s = this.view!.state; const o = s.objects[id]; const c = this.card(o);
    const ex = this.pui.payEx.has(id), rc = this.pui.payRc.has(id);
    const sel = optObjs.has(id);
    const acts = (!pay && !sel && o?.controller === this.me() && this.idx.activate.get(id)) || [];
    const exhaustA = acts.find(a => a.type === 'activate' && a.abilityIndex === 950);
    const recycleA = acts.find(a => a.type === 'activate' && a.abilityIndex === 951);
    const primary = exhaustA ?? (acts.length === 1 ? acts[0] : undefined);
    const tip = `${c?.name ?? 'Rune'}${o?.exhausted ? ' (exhausted)' : ''}${exhaustA ? ' — click: exhaust for 1 Energy' : ''}${recycleA ? '; right-click / long-press: recycle for Power' : ''}`;
    const el: HTMLElement = h('div', {
      class: ['rune', o?.exhausted && 'exhausted', (pay || sel) && 'selectable', acts.length > 0 && 'activatable', ex && 'pay-ex', rc && 'pay-rc'],
      dataset: { obj: id, card: o?.cardId }, title: tip, 'aria-label': tip,
      role: pay || sel || acts.length > 0 ? 'button' : undefined, tabindex: pay || sel || acts.length > 0 ? 0 : undefined,
      onClick: (e: Event) => {
        e.stopPropagation();
        if (pay) { this.pui.cycleRune(id, !!o?.exhausted); this.render(); }
        else if (sel) this.onTarget(optObjs.get(id)!);
        else if (primary) this.act(primary);
        else if (acts.length) this.abilityMenu(id, el);
      },
    }, c ? renderCard(c, { size: 'sm', printed: this.printed(o), eager: true, classes: ['rune-card'] }) : cardBack(undefined, 'sm'),
      recycleA ? h('button', { class: 'rune-rc', title: 'Recycle for Power', 'aria-label': `Recycle ${c?.name ?? 'rune'} for Power`, onClick: (e: Event) => { e.stopPropagation(); this.act(recycleA); } }, '↺') : null);
    el.querySelector('.card')?.removeAttribute('data-obj');
    if (recycleA) {
      el.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); this.act(recycleA); });
      let t: ReturnType<typeof setTimeout> | null = null;
      el.addEventListener('pointerdown', e => { if ((e as PointerEvent).pointerType !== 'mouse') t = setTimeout(() => { t = null; this.longPressed = true; this.act(recycleA); }, 520); });
      const cancel = () => { if (t) { clearTimeout(t); t = null; } };
      el.addEventListener('pointerup', cancel); el.addEventListener('pointerleave', cancel);
    } else if (c) this.hoverPreview(el, c, o?.exhausted ? ['Exhausted'] : [], this.printed(o));
    return el;
  }

  /** Deck / trash / rune deck pile with a count badge (trash: top card face + eye icon, opens the viewer). */
  private pile(label: string, anchor: string, n: number, top: 'back' | 'rune' | GameObject | null | undefined, onClick: (() => void) | undefined, title: string, cls = ''): HTMLElement {
    let face: HTMLElement | null = null;
    if (n && top === 'back') face = cardBack(undefined, 'sm', ['pile-card']);
    else if (n && top === 'rune') face = cardBack(undefined, 'sm', ['pile-card', 'rune-back']);
    else if (n && top && typeof top === 'object') { const c = this.card(top); face = c ? renderCard(c, { size: 'sm', printed: this.printed(top), eager: true, classes: ['pile-card'] }) : cardBack(undefined, 'sm', ['pile-card']); face.removeAttribute('data-obj'); }
    const el = h(onClick ? 'button' : 'div', { class: ['pile', cls, !n && 'empty', n > 1 && 'stacked'], dataset: { anchor }, title: `${title}: ${n}`, onClick, 'aria-label': `${title}: ${n}` },
      face, h('span', { class: 'pile-n' }, h('b', null, String(n)), h('span', { class: 'pile-l' }, label)),
      onClick ? h('i', { class: 'eye', 'aria-hidden': 'true' }) : null);
    return el;
  }

  private viewZone(title: string, ids: ObjId[]) {
    const s = this.view!.state;
    modal(title, ids.length ? h('div', { class: 'gallery' }, [...ids].reverse().map(id => {
      const o = s.objects[id]; const c = this.card(o);
      if (!c) return cardBack(id, 'md');
      const el = renderCard(c, { size: 'md', obj: o, printed: this.printed(o) }); el.removeAttribute('data-obj');
      this.hoverPreview(el, c, [], this.printed(o));
      return el;
    })) : h('p', { class: 'muted' }, 'Empty.'), undefined, { wide: true });
  }

  /** Non-unit, non-attached cards first? No: table order (timestamp); attached gear rides under its unit. */
  private slots(objs: GameObject[], optObjs: Map<ObjId, string>): HTMLElement[] {
    const s = this.view!.state;
    const attached = new Map<ObjId, GameObject[]>();
    for (const o of objs) if (o.attachedTo && s.objects[o.attachedTo]) (attached.get(o.attachedTo) ?? attached.set(o.attachedTo, []).get(o.attachedTo)!).push(o);
    return objs.filter(o => !(o.attachedTo && objs.some(u => u.id === o.attachedTo))).map(o => this.slot(o, optObjs, attached.get(o.id) ?? []));
  }
  /** A card on the table: rotated 90° when exhausted, attached gear tucked underneath. */
  slot(o: GameObject | undefined, optObjs: Map<ObjId, string>, gear: GameObject[] = []): HTMLElement {
    if (!o) return h('span');
    const el = this.objCard(o, 'sm', optObjs);
    const g = gear.map((x, i) => { const ge = this.objCard(x, 'sm', optObjs); ge.classList.add('gear-under'); ge.style.setProperty('--gi', String(i + 1)); return ge; });
    return h('div', { class: ['slot', o.exhausted && 'exh', o.faceDown && 'fd'], style: { '--gears': String(gear.length) } }, g.reverse(), el);
  }

  /** "Select all" for a location with several units that can move: one standard move takes them together. */
  private selectAllChip(objs: GameObject[]): HTMLElement | null {
    const movable = objs.filter(o => this.idx.movable.has(o.id)).map(o => o.id);
    if (movable.length < 2) return null;
    const all = movable.every(id => this.selUnits.has(id));
    return h('button', {
      class: ['sel-all', all && 'on'], 'data-testid': 'select-all', title: all ? 'Deselect these units' : 'Select every unit here that can move, then pick one destination',
      onClick: (e: Event) => { e.stopPropagation(); this.selHand = null; if (all) movable.forEach(id => this.selUnits.delete(id)); else movable.forEach(id => this.selUnits.add(id)); this.render(); },
    }, all ? `✓ ${movable.length} selected` : `Select all ${movable.length}`);
  }

  private baseZone(p: PlayerId, isMe: boolean, optObjs: Map<ObjId, string>, drop = false, bfOpt?: string): HTMLElement {
    const s = this.view!.state; const pl = s.players[p];
    const objs = (pl?.base ?? []).map(id => s.objects[id]).filter(Boolean);
    return h('div', {
      class: ['zone', 'base', drop && 'drop', bfOpt && 'target'], dataset: { drop: isMe && drop ? 'base' : undefined, zone: `base-${p}` }, 'aria-label': `${pl?.name} base`,
      onClick: drop ? () => this.onDest('base') : bfOpt ? () => this.onTarget(bfOpt) : undefined,
    },
      h('span', { class: 'zlabel' }, 'Base'),
      h('span', { class: 'zcount', title: 'Cards in base' }, String(objs.length)),
      isMe ? this.selectAllChip(objs) : null,
      h('div', { class: 'zone-cards' }, this.slots(objs, optObjs)));
  }

  private battlefield(i: number, drop: boolean, bfOpt: string | undefined, optObjs: Map<ObjId, string>): HTMLElement {
    const s = this.view!.state; const b = s.battlefields[i]; const me = this.me();
    const bfObj = s.objects[b.objId]; const bc = this.card(bfObj);
    const units = this.unitsAt(i);
    const mineU = units.filter(o => o.controller === me), oppU = units.filter(o => o.controller !== me);
    const ctrl = b.controller === null ? 'none' : b.controller === me ? 'me' : 'opp';
    const sd = s.showdown?.battlefieldIndex === i;
    const fd = this.facedownAt(i);
    const bfCard = bc ? renderCard(bc, { size: 'sm', printed: this.printed(bfObj), eager: true, classes: ['bf-card'] }) : h('div', { class: 'card landscape bf-card' });
    bfCard.removeAttribute('data-obj');
    const mightSum = (us: GameObject[]) => us.reduce((a, o) => a + (objMight(o, this.card(o)) ?? 0), 0);
    const ctrlText = ctrl === 'none' ? 'Uncontrolled' : ctrl === 'me' ? 'You control this battlefield' : 'Your opponent controls this battlefield';
    const status = [ctrlText, b.contested ? 'Contested' : '', sd ? (s.showdown!.isCombat ? 'Combat here' : 'Showdown here') : ''].filter(Boolean).join(' · ');
    // control is shown as colour + position (a band on the controller's side), contested as stripes: no labels on the art
    const head = h('div', { class: 'bf-head', dataset: { card: bfObj?.cardId }, tabindex: 0, title: status, 'aria-label': `${bc?.name ?? 'Battlefield'}. ${status}. ${bc?.text ?? ''}` },
      h('span', { class: 'bf-band', 'aria-hidden': 'true' }), bfCard,
      sd ? h('span', { class: 'bf-sd', title: s.showdown!.isCombat ? 'Combat' : 'Showdown', 'aria-hidden': 'true' }, s.showdown!.isCombat ? '⚔' : '◎') : null);
    this.hoverPreview(head, bc, [status, 'Border: blue (your side) = you control · red (their side) = opponent · grey = uncontrolled · striped = contested'], this.printed(bfObj));
    const ctx = this.ctxPrompt && this.ctxPrompt.bf === i ? this.ctxPrompt.el : null;
    return h('div', {
      class: ['bf', `ctrl-${ctrl}`, b.contested && 'contested', sd && 'showdown', drop && 'drop', bfOpt && 'target'],
      dataset: { bf: i, drop: drop ? `bf:${i}` : undefined }, 'aria-label': `Battlefield ${bc?.name ?? i + 1}: ${status}`,
      onClick: drop ? () => this.onDest(i) : bfOpt ? () => this.onTarget(bfOpt) : undefined,
    },
      h('div', { class: 'bf-units opp' }, this.slots(oppU, optObjs)),
      h('div', { class: 'bf-mid' },
        head,
        fd.length ? h('div', { class: 'bf-fd', title: 'Facedown (hidden) card' }, fd.map(o => this.slot(o, optObjs))) : null,
        ctx),
      h('div', { class: 'bf-units me' }, this.selectAllChip(mineU), this.slots(mineU, optObjs)),
      // unit counts / Might totals, small in the box corners (theirs top, yours bottom)
      h('span', { class: ['bf-might', 'opp', !oppU.length && 'none'], title: `Opponent: ${oppU.length} unit${oppU.length === 1 ? '' : 's'}, Might ${mightSum(oppU)}` }, oppU.length ? h('i', { class: 'ico ico-might' }) : null, oppU.length ? String(mightSum(oppU)) : '0'),
      h('span', { class: ['bf-might', 'me', !mineU.length && 'none'], title: `You: ${mineU.length} unit${mineU.length === 1 ? '' : 's'}, Might ${mightSum(mineU)}` }, mineU.length ? h('i', { class: 'ico ico-might' }) : null, mineU.length ? String(mightSum(mineU)) : '0'));
  }

  private handZone(p: PlayerId, optObjs: Map<ObjId, string>): HTMLElement {
    const s = this.view!.state; const pl = s.players[p];
    const ids = pl?.hand ?? [];
    const n = ids.length;
    const spread = Math.min(5, 36 / Math.max(1, n));
    const overlap = n <= 4 ? -0.02 : n <= 6 ? -0.1 : n <= 8 ? -0.2 : n <= 10 ? -0.28 : -0.34;
    const mulligan = isMine(this.view!) && this.view!.pending?.kind === 'mulligan';
    const cards = ids.map((id, i) => {
      const o = s.objects[id]; const off = i - (n - 1) / 2;
      const el = this.objCard(o, 'md', optObjs, true);
      // BASICS BX-4: the current cost (engine PlayerView.costs) when cost modifications change it from the printed cost
      const ec = this.view!.costs?.[id]; const pc = s.cards[o.cardId];
      if (ec && pc && (ec.energy !== (pc.energy ?? 0) || ec.power.length !== (pc.power ?? 0))) {
        const lbl = [String(ec.energy), ...ec.power.map(x => (x === 'any' ? 'A' : x.map(d => d[0]).join('/')))].join(' ');
        el.appendChild(h('span', { class: ['eff-cost', ec.energy < (pc.energy ?? 0) || ec.power.length < (pc.power ?? 0) ? 'down' : 'up'], title: `Current cost: ${lbl}`, 'data-testid': 'eff-cost' }, lbl));
      }
      el.style.setProperty('--rot', `${off * spread}deg`);
      el.style.setProperty('--lift', `${off * off * 1.2}px`);
      // hover zooms in place: grow from the bottom, towards the centre for edge cards (stays on screen)
      el.style.setProperty('--ox', `${n <= 1 ? 50 : Math.round(15 + 70 * (i / (n - 1)))}%`);
      el.style.zIndex = String(i + 1);
      if (mulligan && this.pui.sel.includes(optObjs.get(id) ?? '')) el.classList.add('marked');
      el.addEventListener('pointerenter', e => { if ((e as PointerEvent).pointerType === 'mouse' && !this.dragging) this.handZoom(el); });
      el.addEventListener('pointerleave', () => this.handZoom(null));
      el.addEventListener('focus', () => { if (el.matches(':focus-visible')) this.handZoom(el); });
      el.addEventListener('blur', () => this.handZoom(null));
      el.addEventListener('pointerdown', () => this.handZoom(null));
      return el;
    });
    return h('div', { class: 'hand-wrap' }, h('div', { class: 'hand', style: { '--overlap': String(overlap) }, 'aria-label': `Your hand, ${n} cards` }, cards));
  }

  /** In-place zoom of a hand card: a larger, non-interactive copy rising from the card's spot (kept on screen).
   *  The real card keeps its small hit area, so moving the pointer up to the board isn't blocked. */
  private zoomEl: HTMLElement | null = null;
  handZoom(el: HTMLElement | null) {
    this.zoomEl?.remove(); this.zoomEl = null;
    if (!el || !el.isConnected || window.innerWidth < 600) return;
    const r = el.getBoundingClientRect();
    const hw = parseFloat(getComputedStyle(el).width) || r.width;
    const H = Math.min(window.innerHeight * 0.72, 560), W = Math.min(H / 1.4, hw * 2.1);
    const z = el.cloneNode(true) as HTMLElement;
    z.removeAttribute('data-obj'); z.removeAttribute('tabindex'); z.setAttribute('aria-hidden', 'true');
    z.classList.add('hand-zoom'); z.classList.remove('marked');
    const left = Math.max(6, Math.min(window.innerWidth - W - 6, r.left + r.width / 2 - W / 2));
    Object.assign(z.style, { position: 'fixed', left: left + 'px', bottom: '6px', top: 'auto', margin: '0', transform: 'none', rotate: 'none', zIndex: '45', pointerEvents: 'none' });
    z.style.setProperty('--w', W + 'px');
    document.body.appendChild(z);
    this.zoomEl = z;
  }

  /** Might breakdown lines for the zoom ("+2 Bulwark Hymn (this turn)", "+1 buff", "+3 Assault (attacking)"...). */
  mightBreakdown(o: GameObject, c: CardRec | undefined): string[] {
    if (!c || c.might == null) return [];
    const s = this.view!.state;
    const cur = objMight(o, c);
    const dur = (d?: string) => d === 'static' || d === 'permanent' || !d ? '' : d === 'endOfTurn' ? ' (this turn)' : d === 'endOfCombat' ? ' (this combat)' : d === 'nextTurn' ? ' (until next turn)' : d === 'whileSource' ? ' (while its source stays)' : '';
    const sign = (n: number) => (n > 0 ? '+' : '') + n;
    const srcName = (id: ObjId | null | undefined) => (id ? this.card(s.objects[id])?.name : undefined);
    const lines: string[] = [];
    const ds = (o.derived as { mightSources?: { source: ObjId | null; label?: string; amount: number; duration?: string }[] } | undefined)?.mightSources;
    if (Array.isArray(ds) && ds.length) {
      for (const x of ds) {
        if (!x.amount || (x.source === null && /^base might$/i.test(x.label ?? ''))) continue; // the printed value is the header
        const name = srcName(x.source);
        const label = x.label && name && !x.label.includes(name) ? `${name} — ${x.label}` : x.label ?? name ?? 'effect';
        lines.push(`${sign(x.amount)} ${label}${dur(x.duration)}`);
      }
    } else {
      let known = 0;
      for (const m of o.modifiers ?? []) {
        if (m.setMight != null) { lines.push(`Might set to ${m.setMight} by ${srcName(m.source) ?? 'an effect'}${dur(m.duration)}`); continue; }
        if (m.might) { known += m.might; lines.push(`${sign(m.might)} ${srcName(m.source) ?? m.note ?? 'effect'}${dur(m.duration)}`); }
      }
      const buff = o.counters?.buff ?? 0; if (buff) { known += buff; lines.push(`${sign(buff)} buff`); }
      const kws = objKeywords(o, c);
      const kv = (k: string) => { const m = kws.map(x => new RegExp(`^${k}(?: (\\d+))?$`).exec(x)).find(Boolean); return m ? Number(m[1] ?? 1) : 0; };
      if (o.combatRole === 'attacker' && kv('Assault')) { known += kv('Assault'); lines.push(`+${kv('Assault')} Assault (attacking)`); }
      if (o.combatRole === 'defender' && kv('Shield')) { known += kv('Shield'); lines.push(`+${kv('Shield')} Shield (defending)`); }
      const gear = Object.values(s.objects).filter(g => g.attachedTo === o.id).map(g => this.card(g)?.name).filter(Boolean);
      const rest = cur != null && !o.modifiers?.some(m => m.setMight != null) ? cur - c.might - known : 0;
      if (rest) lines.push(`${sign(rest)} ${gear.length ? `equipment / other effects (${gear.join(', ')})` : 'other effects (static abilities)'}`);
    }
    if (cur === c.might && !lines.length) return [];
    return [`Might ${cur} (printed ${c.might})`, ...lines];
  }

  /** Render a game object as an interactive card. */
  objCard(o: GameObject | undefined, size: 'xs' | 'sm' | 'md', optObjs: Map<ObjId, string>, inHand = false): HTMLElement {
    if (!o) return h('span');
    const c = this.card(o);
    const id = o.id;
    const playable = this.idx.play.has(id);
    const movable = this.idx.movable.has(id);
    const activatable = this.idx.activate.has(id);
    const opt = optObjs.get(id);
    const classes: string[] = [];
    const pend = this.view!.pending;
    if (opt !== undefined) classes.push(this.pui.sel.includes(opt) ? 'selected' : 'targetable');
    else if (playable || movable || activatable) classes.push('legal');
    if (this.selHand === id || this.selUnits.has(id)) classes.push('selected');
    if (this.selUnits.has(id)) classes.push('move-sel');
    if (o.faceDown && c) classes.push('facedown-own');
    const top = this.view!.state.chain[this.view!.state.chain.length - 1];
    if (top && top.source === id && !inHand) classes.push('on-chain');
    const printed = this.printed(o);
    const el = c ? renderCard(c, { size, obj: o, classes, showText: inHand ? false : undefined, printed, eager: true }) : cardBack(id, size, classes);
    if (inHand) el.classList.add('in-hand');
    el.tabIndex = (opt !== undefined || playable || movable || activatable) ? 0 : -1;
    if (opt !== undefined) el.setAttribute('role', 'button');
    const extra: string[] = [];
    extra.push(...this.mightBreakdown(o, c));
    if (o.damage) extra.push(`Damage: ${o.damage}`);
    if (o.exhausted) extra.push('Exhausted');
    if (o.stunned) extra.push('Stunned');
    for (const md of o.modifiers ?? []) if (md.note && !md.might) extra.push(md.note);
    if (movable && opt === undefined) extra.push(this.selUnits.has(id) ? 'Selected to move — pick a highlighted destination' : 'Click to select for a move (select several to move them together)');
    this.hoverPreview(el, c, extra, printed, inHand);
    const acts = this.idx.activate.get(id) ?? [];
    const onActivate = () => {
      if (opt !== undefined) { this.onTarget(opt); return; }
      if (pend?.kind === 'mulligan') return;
      if (playable) { this.onPlayClick(id, el); return; }
      if (movable) {
        if (this.selUnits.has(id)) this.selUnits.delete(id); else this.selUnits.add(id);
        this.selHand = null;
        if (activatable && this.selUnits.has(id)) this.abilityMenu(id, el, true);
        this.render(); return;
      }
      // a single legal ability happens on click; a menu only when there's a real choice
      if (acts.length === 1) { this.act(acts[0]); return; }
      if (activatable) { this.abilityMenu(id, el); return; }
    };
    el.addEventListener('click', e => { e.stopPropagation(); if (!this.dragJustEnded) onActivate(); });
    el.addEventListener('keydown', e => { if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') { e.preventDefault(); onActivate(); } });
    if ((playable || movable) && opt === undefined) this.enableDrag(el, id, playable ? 'play' : 'move');
    return el;
  }

  /** Zoom on hover (mouse), long-press (touch), right-click, or keyboard focus. Hand cards zoom in place via CSS
   *  instead (mouse); they still get the zoom on long-press. */
  private hoverPreview(el: HTMLElement, c: CardRec | undefined, extra: string[] = [], printed: string | null = null, inHand = false) {
    if (!c) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    el.addEventListener('pointerenter', e => { if ((e as PointerEvent).pointerType === 'mouse' && !this.dragging && !inHand) showPreview(c, el, extra, printed); });
    el.addEventListener('pointerleave', () => { hidePreview(); if (timer) clearTimeout(timer); });
    el.addEventListener('focus', () => { if (el.matches(':focus-visible')) showPreview(c, el, extra, printed); });
    el.addEventListener('blur', () => hidePreview());
    el.addEventListener('pointerdown', e => { if ((e as PointerEvent).pointerType !== 'mouse') { timer = setTimeout(() => { showPreview(c, el, extra, printed); this.longPressed = true; }, 420); } });
    el.addEventListener('pointerup', () => { if (timer) clearTimeout(timer); if (this.longPressed) { this.longPressed = false; setTimeout(() => hidePreview(), 1800); } });
    el.addEventListener('contextmenu', e => { e.preventDefault(); showPreview(c, el, extra, printed); });
  }
  private longPressed = false;
  private dragJustEnded = false;

  // ---------- play / move ----------
  playDestinations(id: ObjId): (number | 'base')[] {
    const acts = this.idx.play.get(id) ?? [];
    const out = new Set<number | 'base'>();
    for (const a of acts) {
      if (a.type === 'playCard') out.add(a.destination ?? 'base');
      else if (a.type === 'hide') out.add(a.battlefieldIndex);
    }
    return [...out];
  }
  describe(a: Action): string {
    switch (a.type) {
      case 'playCard': {
        const parts = [a.destination === undefined ? 'Play' : a.destination === 'base' ? 'Play to base' : `Play to ${this.bfName(a.destination)}`];
        if (a.mode) parts.push(`(mode ${a.mode})`); if (a.x !== undefined) parts.push(`(X=${a.x})`); if (a.hidden) parts.push('(hidden)');
        return parts.join(' ');
      }
      case 'hide': return `Hide at ${this.bfName(a.battlefieldIndex)}`;
      case 'activate': return `Activate: ${this.abilityLabel(a.obj, a.abilityIndex)}`;
      case 'move': return `Move ${a.units.length > 1 ? a.units.length + ' units' : this.card(this.obj(a.units[0]))?.name ?? 'unit'} to ${a.to === 'base' ? 'base' : this.bfName(a.to)}`;
      case 'pass': return 'Pass';
      case 'endTurn': return 'End turn';
      case 'concede': return 'Concede';
      case 'assignDamage': return 'Assign damage';
      case 'choose': return 'Choose ' + a.optionIds.join(', ');
      case 'cancel': return 'Cancel';
    }
  }
  abilityLabel(obj: ObjId, i: number): string {
    if (i === 950) return 'Exhaust: add 1 Energy';
    if (i === 951) return 'Recycle: add 1 Power';
    const c = this.card(this.obj(obj)); if (!c) return `ability ${i + 1}`;
    const lines = c.text.split('\n').filter(l => /:/.test(l) && !/^\[(Empowered|Level)/.test(l));
    const t = lines[i] ?? lines[0] ?? c.text.split('\n')[i];
    return t ? t.replace(/\[([^\]]+)\]/g, (_, x) => x === 'T' ? '⟳' : x === 'S' ? 'Might' : x === '>' ? '›' : /^\d+$/.test(x) ? `(${x})` : x).slice(0, 80) : `ability ${i + 1}`;
  }
  private onPlayClick(id: ObjId, el: HTMLElement) {
    const acts = this.idx.play.get(id) ?? [];
    if (acts.length === 1 && (acts[0].type !== 'playCard' || acts[0].destination === undefined || acts[0].destination === 'base')) { this.act(acts[0]); return; }
    // Multiple options: select (board highlights destinations) + popover listing them
    this.selHand = this.selHand === id ? null : id; this.selUnits.clear();
    this.render();
    if (this.selHand) {
      const anchor = this.root.querySelector(`[data-obj="${id}"]`) ?? el;
      const extra = this.idx.activate.get(id) ?? [];
      popover(anchor, this.card(this.obj(id))?.name ?? 'Play', [...acts, ...extra].map(a => ({ label: this.describe(a), onClick: () => { this.selHand = null; this.act(a); } })));
    }
  }
  private abilityMenu(id: ObjId, el: HTMLElement, alsoMove = false) {
    const acts = this.idx.activate.get(id) ?? [];
    const items = acts.map(a => ({ label: this.describe(a), onClick: () => { this.selUnits.delete(id); this.act(a); } }));
    if (alsoMove) items.push({ label: 'Keep selected to move', onClick: () => { /* stays selected */ } });
    setTimeout(() => popover(this.root.querySelector(`[data-obj="${id}"]`) ?? el, this.card(this.obj(id))?.name ?? 'Abilities', items), 0);
  }
  private async onDest(to: number | 'base') {
    if (this.selHand) {
      const id = this.selHand;
      const acts = (this.idx.play.get(id) ?? []).filter(a => (a.type === 'playCard' && (a.destination ?? 'base') === to) || (a.type === 'hide' && a.battlefieldIndex === to));
      if (acts.length === 1) { this.selHand = null; this.act(acts[0]); }
      else if (acts.length > 1) popover(this.root.querySelector(to === 'base' ? '[data-drop="base"]' : `[data-bf="${to}"]`)!, 'Play how?', acts.map(a => ({ label: this.describe(a), onClick: () => { this.selHand = null; this.act(a); } })));
      return;
    }
    if (this.selUnits.size) {
      const units = [...this.selUnits];
      const m = findMove(this.idx, units, to);
      if (!m) { toast('Those units cannot move there together.', 'bad'); return; }
      if (!m.exact && this.session.check) { const err = this.session.check(m.action); if (err) { toast(err, 'bad'); return; } }
      this.selUnits.clear();
      this.act(m.action);
    }
  }
  onTarget(optId: string) {
    const d = this.view?.pending; if (!d) return;
    this.pui.toggle(optId, d);
    const max = d.max ?? 1, min = d.min ?? 1;
    const immediate = ['chooseTargets', 'chooseBattlefield', 'chooseDestination', 'chooseShowdown', 'chooseOrder', 'chooseOpponent', 'chooseCards', 'chooseUnitsToMove', 'chooseMode'].includes(d.kind) && max === 1 && min === 1;
    if (immediate && this.pui.sel.length === 1) { this.submitChoose(this.pui.sel); return; }
    this.render();
  }
  submitChoose(ids: string[], data?: unknown, ordered = false) {
    const v = this.view!; const d = v.pending!;
    const found = findChoose(this.idx, ids, ordered);
    const a: Action = found && data === undefined ? found : { type: 'choose', player: v.you, optionIds: ids, ...(data !== undefined ? { data } : {}) };
    if (!found && this.idx.choose.length && data === undefined && !ordered && this.session.check) {
      const err = this.session.check(a); if (err) { toast(err, 'bad'); return; }
    }
    void d;
    this.act(a);
  }

  // drag & drop (pointer events; works with touch)
  private enableDrag(el: HTMLElement, id: ObjId, kind: 'play' | 'move') {
    el.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0 || this.busy) return;
      const sx = e.clientX, sy = e.clientY;
      let ghost: HTMLElement | null = null; let hot: Element | null = null;
      // dragging a selected unit (or any unit while others are selected) moves the whole selection together
      const units = kind === 'move' ? (this.selUnits.has(id) ? [...this.selUnits] : this.selUnits.size && moveDestinations(this.idx, [...this.selUnits, id]).length ? [...this.selUnits, id] : [id]) : [];
      const dests = kind === 'play' ? this.playDestinations(id) : moveDestinations(this.idx, units);
      const move = (ev: PointerEvent) => {
        if (!ghost && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 10) return;
        if (!ghost) {
          if (!dests.length) return;
          this.dragging = true; hidePreview(); closePopover();
          ghost = el.cloneNode(true) as HTMLElement;
          const r = el.getBoundingClientRect();
          Object.assign(ghost.style, { position: 'fixed', left: '0px', top: '0px', width: r.width + 'px', zIndex: '100', pointerEvents: 'none', opacity: '.92', transform: 'none', margin: '0' });
          ghost.classList.add('dragging');
          document.body.appendChild(ghost);
          el.style.opacity = '.35';
          for (const d of dests) this.root.querySelector(d === 'base' ? '[data-zone="base-' + this.me() + '"]' : `[data-bf="${d}"]`)?.classList.add('drop');
        }
        ghost.style.transform = `translate(${ev.clientX - ghost.offsetWidth / 2}px, ${ev.clientY - ghost.offsetHeight * 0.6}px) rotate(-4deg)`;
        const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-zone^="base-"], [data-bf]') ?? null;
        if (hot !== under) { hot?.classList.remove('drop-hot'); hot = under; if (hot && hot.classList.contains('drop')) hot.classList.add('drop-hot'); }
      };
      const up = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
        if (!ghost) return;
        ghost.remove(); el.style.opacity = '';
        this.dragging = false; this.dragJustEnded = true; setTimeout(() => (this.dragJustEnded = false), 50);
        const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-zone^="base-"], [data-bf]') as HTMLElement | null;
        let to: number | 'base' | null = null;
        if (target?.dataset.bf !== undefined) to = +target.dataset.bf; else if (target?.dataset.zone === `base-${this.me()}`) to = 'base';
        const q = this.queued; this.queued = null;
        if (to !== null && dests.includes(to)) {
          if (kind === 'play') { this.selHand = id; this.selUnits.clear(); } else { this.selUnits = new Set(units); this.selHand = null; }
          this.onDest(to);
        } else this.render();
        if (q) this.onView(q, []);
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    });
  }

  // ---------- centre button / log ----------
  /** The round button dead centre between the battlefields: End turn in the open main phase; Pass when no
   *  chain card / showdown battlefield carries the pass; otherwise a waiting indicator. */
  private endButton(passElsewhere = false): HTMLElement {
    const v = this.view;
    let label = 'Waiting…', enabled = false, primary = false, pulse = false, icon = '⋯', cap = 'Wait';
    if (v && v.state.winner !== null) { label = 'Game over'; cap = 'Over'; }
    else if (v && isMine(v) && !this.spectator()) {
      if (this.idx.endTurn) {
        label = 'End turn'; enabled = true; primary = true; icon = '▶'; cap = 'End turn';
        pulse = !this.idx.play.size && !this.idx.moves.length && !this.idx.activate.size;
      } else if (this.idx.pass && !passElsewhere) { label = this.passLabel(); enabled = true; primary = true; icon = '▶'; cap = 'Pass'; }
      else if (this.idx.pass) { label = 'Pass on the chain card or the showdown battlefield'; icon = '↗'; cap = 'Respond'; }
      else { label = 'Decide…'; cap = 'Decide'; }
    } else if (v) { label = v.pending ? `${v.state.players[v.pending.player]?.name ?? 'Opponent'}…` : 'Waiting…'; cap = 'Wait'; }
    return h('button', { class: ['btn', 'end-btn', 'center-btn', primary ? 'primary' : 'waiting', pulse && 'pulse'], disabled: !enabled, onClick: () => this.onEndClick(), 'aria-label': label, title: label, 'data-testid': enabled && this.idx.endTurn ? 'end-turn' : enabled ? 'pass-end' : undefined },
      h('span', { class: 'cb-ico', 'aria-hidden': 'true' }, icon), h('span', { class: 'cb-cap' }, cap));
  }
  private onEndClick() {
    const a = this.idx.endTurn ?? this.idx.pass;
    if (a) this.act(a);
  }
  /** Game log: a drawer from the right edge (toggled from the HUD). */
  private side(): HTMLElement {
    const s = this.view!.state; const me = this.me();
    const log = s.log.slice(-150).map(l => h('div', { class: ['le', l.player === null ? '' : l.player === me ? 'me' : 'opp'] }, h('span', { class: 't' }, `T${l.turn}`), l.text));
    return h('aside', { class: ['g-side', this.sideOpen && 'open'], 'aria-label': 'Game log' },
      h('div', { class: 'side-sec' }, h('h3', null, 'Game log'), h('button', { class: 'btn small ghost', 'aria-label': 'Close log', onClick: () => { this.sideOpen = false; this.render(); } }, '✕')),
      h('div', { class: 'log', role: 'log', 'aria-live': 'polite' }, log));
  }
  /** Where a prompt belongs: next to the card / zone it is about. */
  private promptAnchor(table: HTMLElement): Element | null {
    const v = this.view!; const d = v.pending; const s = v.state;
    if (!d || !isMine(v)) return null;
    const q = (sel: string) => table.querySelector(sel);
    if (d.kind === 'mulligan' || d.kind === 'mainAction') return null;
    if (d.kind === 'payment') return q('.mat.me .runes-zone');
    if (d.kind === 'assignDamage') {
      const t0 = (d.data?.targets as unknown[] | undefined)?.[0];
      const firstId = typeof t0 === 'string' ? t0 : (t0 as { obj?: ObjId } | undefined)?.obj ?? (d.options?.[0]?.objIds ?? [])[0] ?? '';
      const bf = s.showdown?.battlefieldIndex ?? s.objects[firstId]?.battlefieldIndex;
      if (bf !== undefined && bf !== null) return q(`[data-bf="${bf}"]`);
    }
    if (d.source) {
      if (s.chain.some(c => c.source === d.source)) return q('.chain-dock') ;
      const el = q(`.mat [data-obj="${d.source}"], .bfs [data-obj="${d.source}"]`);
      if (el) return el;
    }
    if (s.chain.length) return q('.chain-dock');
    return null;
  }
  /** Position a prompt beside its anchor (desktop), clamped inside the board and off the highlighted choices
   *  (targets, selectable runes) so they stay clickable. Without an anchor it stays over the battlefields. */
  private placePrompt(el: HTMLElement, table: HTMLElement) {
    const big = el.querySelector('.p-cards');
    const anchor = big ? null : this.promptAnchor(table);
    const tr = table.getBoundingClientRect();
    const w = el.offsetWidth, hgt = el.offsetHeight, pad = 8;
    const hot = [...table.querySelectorAll('.card.targetable, .bf.target, .zone.target, .rune.selectable, .zone.drop, .bf.drop')]
      .filter(e => !el.contains(e)).map(e => e.getBoundingClientRect());
    if (!anchor && (!hot.length || big)) return; // stays centred over the battlefields
    const clamp = (x: number, y: number): [number, number] => [Math.max(tr.left + pad, Math.min(tr.right - w - pad, x)), Math.max(tr.top + pad, Math.min(tr.bottom - hgt - pad, y))];
    const overlap = (x: number, y: number) => hot.reduce((a, r) => a + Math.max(0, Math.min(x + w, r.right) - Math.max(x, r.left)) * Math.max(0, Math.min(y + hgt, r.bottom) - Math.max(y, r.top)), 0);
    const cands: [number, number, number][] = []; // x, y, preference penalty
    const bfs = table.querySelector('.bfs')?.getBoundingClientRect() ?? tr;
    if (anchor) {
      const ar = anchor.getBoundingClientRect();
      const cx = ar.left + ar.width / 2 - w / 2, cy = ar.top + ar.height / 2 - hgt / 2;
      const above: [number, number] = [cx, ar.top - hgt - 10], below: [number, number] = [cx, ar.bottom + 10];
      const left: [number, number] = [ar.left - w - 12, cy], right: [number, number] = [ar.right + 12, cy];
      let order: [number, number][];
      if (anchor.classList.contains('chain-dock')) order = [left, [ar.left - w - 12, bfs.top], [ar.left - w - 12, bfs.bottom - hgt]];
      else if ((anchor as HTMLElement).dataset.bf !== undefined && this.view!.state.battlefields.length > 1) {
        const leftHalf = ar.left + ar.width / 2 < bfs.left + bfs.width / 2;
        order = leftHalf ? [right, left] : [left, right]; // beside the battlefield it is about (over the other one)
      } else order = ar.top + ar.height / 2 < tr.top + tr.height / 2 ? [below, above, right, left] : [above, below, right, left];
      order.forEach(([x, y], i) => cands.push([...clamp(x, y), i * 800]));
    }
    for (const fx of [0.5, 0.25, 0.75, 0.08, 0.92]) for (const fy of [0.5, 0.2, 0.8, 0.02, 0.98])
      cands.push([...clamp(bfs.left + bfs.width * fx - w / 2, bfs.top + bfs.height * fy - hgt / 2), (anchor ? 4000 : 0) + Math.hypot(fx - 0.5, fy - 0.5) * 2000]);
    let best = cands[0]; let bestScore = Infinity;
    for (const c of cands) { const sc = overlap(c[0], c[1]) * 4 + c[2]; if (sc < bestScore) { bestScore = sc; best = c; } }
    el.classList.add('anchored');
    el.style.left = (best[0] - tr.left) + 'px'; el.style.top = (best[1] - tr.top) + 'px';
  }

  private canChooseFor(loser: PlayerId): boolean {
    switch (this.status.mode) {
      case 'hotseat': return true;
      case 'bot': case 'host': return loser === 0;
      case 'guest': return loser === this.me();
      default: return false;
    }
  }
  private gameOver(): HTMLElement {
    const s = this.view!.state; const me = this.me();
    const won = s.winner === me;
    const names = s.players.map(p => p.name);
    const neutral = this.session.canSwitchSeat || this.status.mode === 'botvbot';
    const text = s.winner === null ? 'Game over' : neutral ? `${names[s.winner]} wins` : won ? 'Victory' : 'Defeat';
    const m = this.status.match;
    const inMatch = !!m && m.bestOf > 1;
    const mw = m ? matchWinner(m) : null;
    const loser = s.winner === null ? null : (1 - s.winner) as PlayerId;
    let matchEl: HTMLElement | null = null;
    if (inMatch && m) {
      const score = h('p', { 'data-testid': 'match-score' }, `Best of ${m.bestOf} · game ${m.game} · ${names[0]} ${m.wins[0]} – ${m.wins[1]} ${names[1]}`);
      if (mw !== null) matchEl = h('div', null, score, h('h3', { style: { color: 'var(--gold)' } }, `${names[mw]} wins the match`));
      else if (loser !== null && this.opts.onNextGame && this.canChooseFor(loser)) {
        const you = !neutral;
        matchEl = h('div', null, score,
          h('p', { class: 'muted' }, you ? 'You lost this game, so you choose who goes first next.' : `${names[loser]} lost, so they choose who goes first next.`),
          h('div', { class: 'row', style: { justifyContent: 'center' } },
            h('button', { class: 'btn primary', 'data-testid': 'next-first', onClick: () => this.opts.onNextGame!(loser, true) }, you ? 'Go first' : `${names[loser]} goes first`),
            h('button', { class: 'btn', 'data-testid': 'next-second', onClick: () => this.opts.onNextGame!(loser, false) }, you ? 'Go second' : `${names[1 - loser]} goes first`)));
      } else matchEl = h('div', null, score, h('p', { class: 'muted' }, loser !== null ? `Waiting for ${names[loser]} to choose who goes first in game ${m.game + 1}…` : ''));
    }
    return h('div', { class: 'gameover', 'data-testid': 'gameover' }, h('div', { class: 'panel' },
      h('h2', { style: { color: won && !neutral ? 'var(--gold)' : 'var(--text)' } }, text),
      h('p', { class: 'muted' }, s.players.map(p => `${p.name}: ${p.points}`).join(' · ')),
      matchEl,
      h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '8px' } },
        h('button', { class: 'btn', onClick: () => { this.root.querySelector('.gameover')?.remove(); } }, 'View board'),
        this.opts.onRematch && (!inMatch || mw !== null) ? h('button', { class: 'btn', onClick: () => this.opts.onRematch!() }, inMatch ? 'New match' : 'Rematch') : null,
        h('button', { class: ['btn', !(inMatch && mw === null) && 'primary'], onClick: () => this.opts.onExit() }, 'Main menu'))));
  }
  private endedOverlay(msg: string): HTMLElement {
    return h('div', { class: 'gameover' }, h('div', { class: 'panel' }, h('h2', null, 'Game ended'), h('p', { class: 'muted' }, msg),
      h('button', { class: 'btn primary', onClick: () => this.opts.onExit() }, 'Back to menu')));
  }
}

export type { CardDef, Decision };
export { reducedMotion };

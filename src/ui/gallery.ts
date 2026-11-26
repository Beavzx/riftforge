// Decision gallery (#gallery or #gallery-<kind>): shows the board with a crafted Decision of each kind,
// so every prompt can be screenshotted and exercised without waiting for the engine to produce it.
import type { Action, Decision, DecisionKind, GameEvent, GameState, ObjId, PlayerId, PlayerView } from '../engine/types';
import type { GameSession, SessionStatus } from '../net/session';
import * as Mock from './mock';
import { Board } from './board';
import { h, clear } from './dom';
import { toast } from './overlay';
import type { App } from './main';

export const GALLERY_KINDS: DecisionKind[] = ['mulligan', 'mainAction', 'showdownAction', 'chainResponse', 'chooseTargets', 'chooseMode', 'chooseX', 'optional', 'payment',
  'orderTriggers', 'assignDamage', 'chooseBattlefield', 'chooseCards', 'chooseUnitsToMove', 'chooseDestination', 'chooseNumber', 'confirm'];

class FixedSession implements GameSession {
  status: SessionStatus = { mode: 'hotseat', online: false, opponentConnected: true };
  actions: Action[] = [];
  constructor(private v: PlayerView) {}
  view() { return this.v; }
  async act(a: Action) { this.actions.push(a); (globalThis as Record<string, unknown>).__galleryLast = a; toast('Action: ' + JSON.stringify(a).slice(0, 160)); return null; }
  subscribe(_fn: (v: PlayerView, e: GameEvent[]) => void) { return () => {}; }
  onStatus(_fn: (s: SessionStatus) => void) { return () => {}; }
  seat(): PlayerId { return 0; }
  close() {}
  names() { return this.v.state.players.map(p => p.name); }
}

/** Build a mid-game mock state: both players have runes, units in base and at battlefields, something on the chain. */
export function sampleState(app: App): GameState {
  const decks = app.legalDecks();
  const a = decks[0].deck, b = (decks[1] ?? decks[0]).deck;
  let s = Mock.createGame({ seed: 7, cardDb: app.db.byId, players: [{ name: 'You', deck: a }, { name: 'Rival', deck: b }] });
  s = structuredClone(s);
  for (const p of s.players) { p.mulliganDone = true; for (let i = 0; i < 3; i++) p.hand.push(p.mainDeck.shift()!); }
  for (const id of Object.keys(s.objects)) { const o = s.objects[id]; if (o.zone === 'mainDeck' && s.players[o.owner].hand.includes(id)) o.zone = 'hand'; }
  const put = (p: PlayerId, n: number, zone: 'base' | 'battlefield', bf?: number) => {
    const pl = s.players[p];
    for (let i = 0; i < n; i++) {
      const idx = pl.mainDeck.findIndex(x => s.cards[s.objects[x].cardId]?.type === 'Unit');
      if (idx < 0) return;
      const [id] = pl.mainDeck.splice(idx, 1);
      const o = s.objects[id]; o.zone = zone; o.battlefieldIndex = bf;
      if (zone === 'base') pl.base.push(id);
    }
  };
  put(0, 2, 'base'); put(1, 1, 'base'); put(0, 1, 'battlefield', 0); put(1, 2, 'battlefield', 1); put(0, 1, 'battlefield', 1);
  for (const p of s.players) for (let i = 0; i < 5; i++) { const r = p.runeDeck.shift(); if (r) { s.objects[r].zone = 'runePool'; p.runesInPlay.push(r); } }
  s.objects[s.players[0].runesInPlay[0]].exhausted = true;
  s.battlefields[0].controller = 0; s.battlefields[1].contested = true;
  s.players[0].points = 3; s.players[1].points = 4;
  s.turn = 5; s.activePlayer = 0; s.phase = 'action';
  const firstUnit = Object.values(s.objects).find(o => o.zone === 'battlefield' && o.battlefieldIndex === 1 && o.controller === 1);
  if (firstUnit) firstUnit.damage = 1;
  const spell = s.players[1].mainDeck.find(x => s.cards[s.objects[x].cardId]?.type === 'Spell');
  if (spell) { s.players[1].mainDeck.splice(s.players[1].mainDeck.indexOf(spell), 1); s.objects[spell].zone = 'chain'; s.chain.push({ id: 'c1', kind: 'spell', source: spell, controller: 1, targets: [[firstUnit?.id ?? '']], choices: {}, pending: false }); }
  s.log.push({ turn: 5, player: 1, text: 'Rival plays a spell.' }, { turn: 5, player: 0, text: 'You move a unit.' });
  return s;
}

export function decisionFor(kind: DecisionKind, s: GameState): { d: Decision; legal: Action[] } {
  const me: PlayerId = 0;
  const units = Object.values(s.objects).filter(o => (o.zone === 'base' || o.zone === 'battlefield') && s.cards[o.cardId]?.type === 'Unit');
  const enemy = units.filter(u => u.controller === 1);
  const mine = units.filter(u => u.controller === 0);
  const hand = s.players[0].hand;
  const nm = (id: ObjId) => s.cards[s.objects[id].cardId]?.name ?? id;
  const ch = (ids: string[]) => ({ type: 'choose' as const, player: me, optionIds: ids });
  switch (kind) {
    case 'mulligan': return { d: { kind, player: me, prompt: 'Choose up to 2 cards to recycle', min: 0, max: 2, options: hand.map(o => ({ id: o, label: nm(o), objIds: [o] })) }, legal: [ch([])] };
    case 'mainAction': return { d: { kind, player: me, prompt: 'Your turn' }, legal: Mock.getLegalActions({ ...s, pending: { kind: 'mainAction', player: 0, prompt: '' } }, 0) };
    case 'showdownAction': return { d: { kind, player: me, prompt: 'Showdown at battlefield — you have focus' }, legal: [{ type: 'pass', player: me }] };
    case 'chainResponse': return { d: { kind, player: me, prompt: 'A spell is on the chain. Respond or pass.' }, legal: [{ type: 'pass', player: me }, ...hand.slice(0, 1).map(o => ({ type: 'playCard' as const, player: me, obj: o }))] };
    case 'chooseTargets': return { d: { kind, player: me, prompt: 'Choose a unit to deal 3 to', min: 1, max: 1, options: units.map(u => ({ id: u.id, label: nm(u.id), objIds: [u.id] })) }, legal: units.map(u => ch([u.id])) };
    case 'chooseMode': return { d: { kind, player: me, prompt: 'Choose one —', options: [{ id: 'm1', label: 'Deal 2 to a unit' }, { id: 'm2', label: 'Draw 1' }, { id: 'm3', label: 'Ready a rune' }] }, legal: ['m1', 'm2', 'm3'].map(x => ch([x])) };
    case 'chooseX': return { d: { kind, player: me, prompt: 'Choose X (deal X damage)', data: { min: 0, max: 5 } }, legal: [0, 1, 2, 3, 4, 5].map(x => ch([String(x)])) };
    case 'optional': return { d: { kind, player: me, prompt: 'You may draw a card. Do you?', options: [{ id: 'yes', label: 'Draw' }, { id: 'no', label: 'Decline' }] }, legal: [ch(['yes']), ch(['no'])] };
    case 'payment': {
      const runes = s.players[0].runesInPlay;
      return { d: { kind, player: me, prompt: 'Pay for Firestorm', options: [{ id: 'auto', label: 'Auto-pay' }], data: { cost: { energy: 3, power: { Fury: 1 } }, auto: { exhaust: runes.slice(1, 4), recycle: runes.slice(4, 5) }, runes } }, legal: [ch(['auto'])] };
    }
    case 'orderTriggers': return { d: { kind, player: me, prompt: 'Order your simultaneous triggers', options: mine.slice(0, 3).map((u, i) => ({ id: 't' + i, label: ['When I conquer, draw 1.', 'When I conquer, buff me.', 'Deathknell: channel 1.'][i], objIds: [u.id] })) }, legal: [ch(['t0', 't1', 't2'])] };
    case 'assignDamage': return { d: { kind, player: me, prompt: 'Assign 5 combat damage', data: { amount: 5, targets: enemy.map(e => e.id) } }, legal: [{ type: 'assignDamage', player: me, assignment: Object.fromEntries(enemy.map((e, i) => [e.id, i === 0 ? 5 : 0])) }] };
    case 'chooseBattlefield': return { d: { kind, player: me, prompt: 'Choose a battlefield', options: s.battlefields.map((b, i) => ({ id: 'bf' + i, label: nm(b.objId), data: { battlefieldIndex: i } })) }, legal: s.battlefields.map((_, i) => ch(['bf' + i])) };
    case 'chooseCards': {
      const top = s.players[0].mainDeck.slice(0, 4);
      return { d: { kind, player: me, prompt: 'Look at the top 4. Choose up to 2 to put in hand.', min: 0, max: 2, options: top.map(o => ({ id: o, label: nm(o), objIds: [o] })), data: { zone: 'mainDeck' } }, legal: [ch([])] };
    }
    case 'chooseUnitsToMove': return { d: { kind, player: me, prompt: 'Choose any number of units to move with me', min: 0, max: mine.length, options: mine.map(u => ({ id: u.id, label: nm(u.id), objIds: [u.id] })) }, legal: [ch([])] };
    case 'chooseDestination': return { d: { kind, player: me, prompt: 'Move to where?', options: [{ id: 'base', label: 'Your base' }, ...s.battlefields.map((b, i) => ({ id: 'bf' + i, label: nm(b.objId), data: { battlefieldIndex: i } }))] }, legal: [ch(['base']), ...s.battlefields.map((_, i) => ch(['bf' + i]))] };
    case 'chooseNumber': return { d: { kind, player: me, prompt: 'Choose a number of cards to recycle', data: { min: 1, max: 4 } }, legal: [1, 2, 3, 4].map(x => ch([String(x)])) };
    case 'confirm': return { d: { kind, player: me, prompt: 'Your opponent revealed: Firestorm. Continue.', options: [{ id: 'ok', label: 'Continue' }] }, legal: [ch(['ok'])] };
  }
  return { d: { kind, player: me, prompt: kind }, legal: [] };
}

export function openGallery(app: App, kind?: string) {
  const s = sampleState(app);
  if (!kind || !GALLERY_KINDS.includes(kind as DecisionKind)) {
    clear(app.root);
    app.root.append(h('main', { class: 'screen' }, h('h1', null, 'Decision gallery'), h('div', { class: 'row' },
      GALLERY_KINDS.map(k => h('a', { class: 'btn', href: '#gallery-' + k, onClick: () => setTimeout(() => location.reload(), 0) }, k)))));
    return;
  }
  const { d, legal } = decisionFor(kind as DecisionKind, s);
  // reveal options' objects to the viewer (deck cards for chooseCards)
  const v = Mock.getView(s, 0);
  for (const o of d.options ?? []) for (const id of o.objIds ?? []) v.state.objects[id] = s.objects[id];
  v.pending = d; v.state.pending = d; v.legal = legal;
  if (kind === 'chooseCards' || kind === 'showdownAction') v.state.showdown = { battlefieldIndex: 1, focus: 0, passes: [], isCombat: kind === 'showdownAction', attacker: 0, defender: 1 };
  if (kind !== 'chainResponse' && kind !== 'showdownAction') v.state.chain = kind === 'payment' ? v.state.chain : [];
  const sess = new FixedSession(v);
  app.screen = 'game';
  app.board = new Board(app.root, sess, app.db, { onExit: () => { location.hash = 'gallery'; location.reload(); } });
  (globalThis as Record<string, unknown>).__riftforge = { app, board: app.board, session: sess };
}

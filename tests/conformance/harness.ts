// Conformance harness: builds exact board states for docs/rules-tests.md scenarios and drives the
// engine only through its public API (createGame / applyAction / getPending / getLegalActions /
// validateAction / getView). Board SETUP is done by direct state construction on a quiescent state
// (pending = a top-level main-phase decision, no replay unit), which the engine treats as a normal
// starting point for the next applyAction.
//
// Owned by the CONFORMANCE agent. Never edits src/.
import assert from 'node:assert/strict';
import type { Action, CardDef, CardId, Decision, DeckList, GameState, ObjId, PlayerId, Modifier, ZoneKind, PaymentPlan } from '../../src/engine/types.ts';
import { createGame, applyAction, getLegalActions, validateAction, getView } from '../../src/engine/index.ts';
import { chars, might as mightNow } from '../../src/engine/chars.ts';
import { newObject } from '../../src/engine/state.ts';
import { fixtureDb, cid as fixtureCid } from '../fixtures/conformance/cards.ts';
import { readFileSync } from 'node:fs';
import { getScript } from '../../src/cards/registry.ts';

// Real cards (data/cards.json) for FAQ scenarios. Their scripts come from src/cards/scripts (if present).
const ROOT = new URL('../../', import.meta.url);
let REAL: CardDef[] | null = null;
function realCards(): CardDef[] {
  if (!REAL) { const raw = JSON.parse(readFileSync(new URL('data/cards.json', ROOT), 'utf8')); REAL = (Array.isArray(raw) ? raw : Object.values(raw)) as CardDef[]; }
  return REAL;
}
/** A real card def by id or by "Name" / "Name, Subtitle"; legends also by "<champion tag>, <title>" ("Jayce, Defender of Tomorrow"). */
export function realCard(nameOrId: string): CardDef {
  const all = realCards();
  const legendName = (c: CardDef) => (c.type === 'Legend' && c.tags?.length ? c.tags.map(t => `${t}, ${c.name}`) : []);
  const d = all.find(c => c.id === nameOrId) ?? all.find(c => (c.subtitle ? `${c.name}, ${c.subtitle}` : c.name) === nameOrId) ?? all.find(c => c.name === nameOrId)
    ?? all.find(c => legendName(c).includes(nameOrId));
  if (!d) throw new Error(`unknown real card ${nameOrId}`);
  return d;
}
// Real card scripts (src/cards/scripts/index.ts registers every scripted card; fixtures use "cf-" ids).
import '../../src/cards/scripts/index.ts';
/** null if every named real card has a script, else a todo reason. */
export function needsScripts(...names: string[]): string | false {
  const missing = names.filter(n => !getScript(realCard(n).id));
  return missing.length ? `real card script(s) not registered yet: ${missing.join(', ')}` : false;
}
/** Fixture name/id, or a real card name/id (added to the game's card pool on use). */
export function cid(nameOrId: string): CardId {
  try { return fixtureCid(nameOrId); } catch { return realCard(nameOrId).id; }
}
function defOf(id: CardId): CardDef { return fixtureDb()[id] ?? realCard(id); }

export { getLegalActions, validateAction, getView, applyAction };
export type { GameState, ObjId, PlayerId, Action, Decision };

export const P0 = 0 as PlayerId;
export const P1 = 1 as PlayerId;
export const BF_A = 0;
export const BF_B = 1;

// ------------------------------------------------------------------------------------------------
// decks
// ------------------------------------------------------------------------------------------------

/** A legal 1v1 deck made of fixture cards (Fury/Chaos legend, 39 + champion, 12 Fury runes, 3 battlefields). */
export function legalDeck(o: Partial<DeckList> = {}, bfs: CardId[] = ['cf-bf-a', 'cf-bf-b', 'cf-bf-c']): DeckList {
  const main: CardId[] = [];
  for (let n = 0; n <= 12; n++) for (let k = 0; k < 3; k++) main.push(`cf-v${n}`);
  return { legend: 'cf-legend', champion: 'cf-champ', main, runes: new Array(12).fill('cf-rune-fury'), battlefields: bfs, ...o };
}

export interface NewGameOpts { seed?: number; firstPlayer?: PlayerId; mulligan?: boolean; shuffle?: boolean; battlefieldChoice?: 'random' | 'choose'; p0?: Partial<DeckList>; p1?: Partial<DeckList> }

/** A real new game (full setup through the engine). */
export function newGame(o: NewGameOpts = {}): GameState {
  return createGame({
    seed: o.seed ?? 7, cardDb: fixtureDb(), firstPlayer: o.firstPlayer, skipMulligan: !o.mulligan, skipShuffle: o.shuffle === false,
    battlefieldSelection: o.battlefieldChoice ?? 'random', includeAllCards: true,
    players: [{ name: 'P0', deck: legalDeck(o.p0) }, { name: 'P1', deck: legalDeck(o.p1, ['cf-bf-d', 'cf-bf-e', 'cf-bf-f']) }],
  });
}

// ------------------------------------------------------------------------------------------------
// S0 (docs/rules-tests.md "Standard state")
// ------------------------------------------------------------------------------------------------

export interface S0Opts {
  /** turn player (default P0) */
  tp?: PlayerId;
  victoryScore?: number;
  runes?: number[];
  deck?: number[];
  runeDeck?: number[];
  /** battlefield card ids for BF-A / BF-B (default vanilla) */
  bfA?: string; bfB?: string;
  seed?: number;
  turn?: number;
}

/**
 * S0: 1v1, victory score 8; TP (P0) in their Main phase, turn 3, Neutral Open; BF-A and BF-B
 * uncontrolled and empty; each player has 6 ready Fury runes in play and an empty pool, 20 V(1) in
 * the main deck, 6 runes in the rune deck, 0 points, empty hand.
 */
export function S0(o: S0Opts = {}): GameState {
  const tp = o.tp ?? P0;
  const g = createGame({
    seed: o.seed ?? 11, cardDb: fixtureDb(), firstPlayer: P0, skipMulligan: true, skipShuffle: true, validateDecks: false,
    battlefieldSelection: 'random', includeAllCards: true,
    victoryScore: o.victoryScore,
    players: [
      { name: 'P0', deck: { legend: 'cf-legend', champion: 'cf-champ', main: new Array(25).fill('cf-v1'), runes: new Array(12).fill('cf-rune-fury'), battlefields: ['cf-bf-a', 'cf-bf-a', 'cf-bf-a'] } },
      { name: 'P1', deck: { legend: 'cf-legend', champion: 'cf-champ', main: new Array(25).fill('cf-v1'), runes: new Array(12).fill('cf-rune-fury'), battlefields: ['cf-bf-b', 'cf-bf-b', 'cf-bf-b'] } },
    ],
  });
  g.cards = { ...g.cards, ...fixtureDb() };
  // real token definitions (createGame adds every Token of the card DB; fixtures win when a token of that name exists): RJ#2649
  for (const d of realCards()) {
    if (!(d.supertypes.includes('Token') || d.type === 'Token')) continue;
    if (Object.values(g.cards).some(c => c.name === d.name && (c.supertypes.includes('Token') || c.type === 'Token'))) continue;
    g.cards[d.id] = d;
  }
  // wipe hands / decks / runes and rebuild exactly
  for (const pl of g.players) {
    for (const id of [...pl.hand, ...pl.mainDeck, ...pl.runeDeck, ...pl.runesInPlay, ...pl.trash, ...pl.base]) delete g.objects[id];
    pl.hand = []; pl.mainDeck = []; pl.runeDeck = []; pl.runesInPlay = []; pl.trash = []; pl.base = []; pl.banishment = [];
    const p = pl.id;
    for (let i = 0; i < (o.deck?.[p] ?? 20); i++) pl.mainDeck.push(newObject(g, 'cf-v1', p, 'mainDeck').id);
    for (let i = 0; i < (o.runeDeck?.[p] ?? 6); i++) pl.runeDeck.push(newObject(g, 'cf-rune-fury', p, 'runeDeck').id);
    for (let i = 0; i < (o.runes?.[p] ?? 6); i++) pl.runesInPlay.push(newObject(g, 'cf-rune-fury', p, 'runePool').id);
    pl.points = 0; pl.xp = 0; pl.pool = { energy: 0, power: {} }; pl.poolRestricted = [];
    pl.turnsTaken = 1;
  }
  if (o.bfA) setBattlefieldCard(g, BF_A, o.bfA);
  if (o.bfB) setBattlefieldCard(g, BF_B, o.bfB);
  g.turn = o.turn ?? 3;
  g.activePlayer = tp;
  g.phase = 'action';
  g.priority = null;
  g.chain = [];
  g.showdown = null;
  g.ex.playedThisTurn = [[], []];
  g.ex.counts = {}; g.ex.usage = {}; g.ex.turnFacts = {};
  g.ex.unit = null;
  g.log = [];
  if (tp === P1) g.players[1].turnsTaken = 1; else g.players[1].turnsTaken = 1;
  g.pending = { kind: 'mainAction', player: tp, prompt: 'Your turn', inStep: false };
  touch(g);
  return g;
}

/** Invalidate engine caches keyed on (timestamp, nextObj) after direct setup mutations. */
export function touch(g: GameState): void { g.timestamp++; }

export function setBattlefieldCard(g: GameState, bf: number, cardId: string): void {
  const id = cid(cardId);
  if (!g.cards[id]) g.cards = { ...g.cards, [id]: defOf(id) };
  g.objects[g.battlefields[bf].objId].cardId = id;
  touch(g);
}

// ------------------------------------------------------------------------------------------------
// setup helpers (mutating; use only on a quiescent state)
// ------------------------------------------------------------------------------------------------

export type Where = 'base' | number | 'hand' | 'trash' | 'deckTop' | 'deckBottom' | 'banishment' | { facedown: number; hiddenTurn?: number };

export interface PutOpts { ready?: boolean; damage?: number; controller?: PlayerId; stunned?: boolean; buff?: boolean; token?: boolean }

/** Create a fixture card object for player p at a location. Units default to ready. */
export function put(g: GameState, p: PlayerId, card: string, where: Where = 'base', o: PutOpts = {}): ObjId {
  const id = cid(card);
  if (!g.cards[id]) g.cards = { ...g.cards, [id]: defOf(id) };
  const def = g.cards[id];
  let zone: ZoneKind;
  if (typeof where === 'object') zone = 'facedown';
  else if (where === 'base') zone = 'base';
  else if (typeof where === 'number') zone = 'battlefield';
  else if (where === 'hand') zone = 'hand';
  else if (where === 'trash') zone = 'trash';
  else if (where === 'banishment') zone = 'banishment';
  else zone = 'mainDeck';
  const ctrl = o.controller ?? p;
  const obj = newObject(g, id, p, zone, { controller: ctrl });
  if (o.token || def.supertypes.includes('Token')) obj.isToken = true;
  if (typeof where === 'number') obj.battlefieldIndex = where;
  if (typeof where === 'object') { obj.battlefieldIndex = where.facedown; obj.faceDown = true; obj.hiddenTurn = where.hiddenTurn ?? g.turn - 1; }
  if (where === 'base') g.players[ctrl].base.push(obj.id);
  if (where === 'hand') g.players[p].hand.push(obj.id);
  if (where === 'trash') g.players[p].trash.push(obj.id);
  if (where === 'banishment') g.players[p].banishment.push(obj.id);
  if (where === 'deckTop') g.players[p].mainDeck.unshift(obj.id);
  if (where === 'deckBottom') g.players[p].mainDeck.push(obj.id);
  obj.exhausted = !(o.ready ?? true);
  obj.damage = o.damage ?? 0;
  if (o.stunned) obj.stunned = true;
  if (o.buff) obj.counters.buff = 1;
  touch(g);
  // a unit put on the board was there before the action under test: record its Mighty status as a cleanup would (R-11
  // trackMighty), so a later on-board change to 5+ "becomes Mighty" (RJ#8556; entering with a static still doesn't, principle 9)
  if ((zone === 'base' || zone === 'battlefield') && (def.type === 'Unit' || def.might !== null)) {
    const m = ((g.ex.memo.__mighty as Record<string, number> | undefined) ?? (g.ex.memo.__mighty = {})) as Record<string, number>;
    m[`${obj.id}#${obj.epoch ?? 0}`] = (mightNow(g, obj.id) ?? 0) >= 5 ? 1 : 0;
  }
  return obj.id;
}

export const hand = (g: GameState, p: PlayerId, card: string) => put(g, p, card, 'hand');

/** Give p control of a battlefield (setup). */
export function control(g: GameState, bf: number, p: PlayerId | null): void { g.battlefields[bf].controller = p; touch(g); }

/** Replace p's runes in play with n ready runes of a domain. */
export function setRunes(g: GameState, p: PlayerId, n: number, domain: RuneDomain = 'fury', ready = true): ObjId[] {
  const pl = g.players[p];
  for (const id of pl.runesInPlay) delete g.objects[id];
  pl.runesInPlay = [];
  return addRunes(g, p, n, domain, ready);
}
export type RuneDomain = 'fury' | 'chaos' | 'mind' | 'calm' | 'body' | 'order';
export function addRunes(g: GameState, p: PlayerId, n: number, domain: RuneDomain = 'fury', ready = true): ObjId[] {
  const out: ObjId[] = [];
  for (let i = 0; i < n; i++) {
    const o = newObject(g, `cf-rune-${domain}`, p, 'runePool');
    o.exhausted = !ready;
    g.players[p].runesInPlay.push(o.id);
    out.push(o.id);
  }
  touch(g);
  return out;
}
/** Give p `each` ready runes of every domain (for real cards of any domain). */
export function fundAll(g: GameState, p: PlayerId, each = 4): void {
  setRunes(g, p, 0);
  for (const d of ['fury', 'chaos', 'mind', 'calm', 'body', 'order'] as RuneDomain[]) addRunes(g, p, each, d);
}
export function clearDeck(g: GameState, p: PlayerId): void { for (const id of g.players[p].mainDeck) delete g.objects[id]; g.players[p].mainDeck = []; touch(g); }
export function fillTrash(g: GameState, p: PlayerId, n: number, card = 'V(1)'): ObjId[] { const out: ObjId[] = []; for (let i = 0; i < n; i++) out.push(put(g, p, card, 'trash')); return out; }

/** Add a modifier directly (setup), e.g. +3 Might this turn. */
export function mod(g: GameState, id: ObjId, m: Partial<Modifier>): void {
  g.objects[id].modifiers.push({ source: null, layer: m.might !== undefined ? 3 : 2, duration: 'endOfTurn', timestamp: ++g.timestamp, ...m } as Modifier);
  touch(g);
}

/** Direct "prevent the next n damage this turn" shield (setup), as ctx.prevent() would create. */
export function addPrevent(g: GameState, id: ObjId, n: number | 'all'): void {
  g.ex.delayed.push({ id: `dtest${++g.timestamp}`, controller: g.objects[id].controller, source: null, key: 'builtin:prevent', data: { obj: id, epoch: g.objects[id].epoch ?? 0, remaining: n }, expires: 'endOfTurn', turn: g.turn, timestamp: g.timestamp });
  touch(g);
}

// ------------------------------------------------------------------------------------------------
// driving
// ------------------------------------------------------------------------------------------------

export function act(g: GameState, a: Action): GameState { return applyAction(g, a).state; }
/** Apply and also return the events. */
export function actEv(g: GameState, a: Action) { return applyAction(g, a); }

/** Error message from the engine for an action (validate or throw), or null if accepted. */
export function rejects(g: GameState, a: Action): string | null {
  const v = validateAction(g, a);
  if (v) return v;
  try { const r = applyAction(g, a); if (r.events.some(e => e.type === 'rollback')) return `rolled back: ${String(r.events.find(e => e.type === 'rollback')!.reason)}`; return null; } catch (e) { return (e as Error).message; }
}

export function pend(g: GameState): Decision {
  assert.ok(g.pending, `expected a pending decision (winner=${g.winner}, phase=${g.phase})`);
  return g.pending!;
}

/** Answer the pending in-step decision with option ids. */
export function choose(g: GameState, ...ids: string[]): GameState {
  const d = pend(g);
  return act(g, { type: 'choose', player: d.player, optionIds: ids });
}
export const yes = (g: GameState) => choose(g, 'yes');
export const no = (g: GameState) => choose(g, 'no');

/** Pass priority/focus (or end the turn if it's a main-phase decision and endTurn=true). */
export function pass(g: GameState): GameState {
  const d = pend(g);
  assert.notEqual(d.kind, 'mainAction', 'pass() called on a main-phase decision; use endTurn()');
  assert.ok(!d.inStep, `pass() called on an in-step decision ${d.kind}: ${d.prompt}`);
  return act(g, { type: 'pass', player: d.player });
}
export function passN(g: GameState, n: number): GameState { for (let i = 0; i < n; i++) g = pass(g); return g; }

export function endTurn(g: GameState, p: PlayerId = pend(g).player): GameState { return act(g, { type: 'endTurn', player: p }); }

/** Pass on the chain until it is empty (only chainResponse decisions; stops at anything else). */
export function resolveChain(g: GameState, limit = 30): GameState {
  for (let i = 0; i < limit && g.chain.length > 0; i++) {
    const d = g.pending;
    if (!d || d.kind !== 'chainResponse') return g;
    g = pass(g);
  }
  return g;
}

/** Pass until the pending decision isn't a chainResponse/showdownAction (or limit). */
export function passAll(g: GameState, limit = 40): GameState {
  for (let i = 0; i < limit; i++) {
    const d = g.pending;
    if (!d || d.inStep || (d.kind !== 'chainResponse' && d.kind !== 'showdownAction')) return g;
    g = pass(g);
  }
  return g;
}

export interface Answers {
  targets?: (ObjId | string)[][];
  /** answers to 'optional' (yes/no) decisions in order */
  may?: boolean[];
  dest?: 'base' | number;
  mode?: string[];
  cards?: string[][];
  numbers?: number[];
  battlefields?: number[];
  locations?: ('base' | number)[];
  order?: string[][];
}

/**
 * Answer in-step decisions of player p from an answer script, in the order they come. Stops at the
 * first decision it has no answer for (leaving it pending for the test to inspect).
 */
export function answer(g: GameState, a: Answers, p?: PlayerId): GameState {
  const q = { targets: [...(a.targets ?? [])], may: [...(a.may ?? [])], mode: [...(a.mode ?? [])], cards: [...(a.cards ?? [])], numbers: [...(a.numbers ?? [])], battlefields: [...(a.battlefields ?? [])], locations: [...(a.locations ?? [])], order: [...(a.order ?? [])] };
  let dest = a.dest;
  for (let i = 0; i < 50; i++) {
    const d = g.pending;
    if (!d || !d.inStep || (p !== undefined && d.player !== p)) return g;
    let ids: string[] | null = null;
    switch (d.kind) {
      case 'chooseTargets': if (q.targets.length) ids = q.targets.shift()!.map(String); break;
      case 'optional': if (q.may.length) ids = [q.may.shift() ? 'yes' : 'no']; break;
      case 'chooseDestination':
        if (dest !== undefined) { ids = [String(dest)]; dest = undefined; }
        else if (q.locations.length) ids = [String(q.locations.shift())];
        break;
      case 'chooseMode': if (q.mode.length) ids = [q.mode.shift()!]; break;
      case 'chooseCards': if (q.cards.length) ids = q.cards.shift()!; break;
      case 'chooseNumber': if (q.numbers.length) ids = [String(q.numbers.shift())]; break;
      case 'chooseBattlefield': if (q.battlefields.length) ids = [String(q.battlefields.shift())]; break;
      case 'chooseOrder': case 'orderTriggers': if (q.order.length) ids = q.order.shift()!; break;
    }
    if (!ids) return g;
    g = act(g, { type: 'choose', player: d.player, optionIds: ids });
  }
  return g;
}

/** Play a card from anywhere the engine allows and answer its in-step decisions. */
export function play(g: GameState, p: PlayerId, obj: ObjId, a: Answers & { payment?: PaymentPlan } = {}): GameState {
  const action: Action = { type: 'playCard', player: p, obj, ...(a.dest !== undefined ? { destination: a.dest } : {}), ...(a.payment ? { payment: a.payment } : {}) };
  g = act(g, action);
  return answer(g, { ...a, dest: undefined }, p);
}

/** Put a fixture card in p's hand and play it. Returns [state, objId]. */
export function cast(g: GameState, p: PlayerId, card: string, a: Answers = {}): [GameState, ObjId] {
  const id = hand(g, p, card);
  return [play(g, p, id, a), id];
}

export function move(g: GameState, p: PlayerId, units: ObjId[], to: 'base' | number): GameState {
  return act(g, { type: 'move', player: p, units, to });
}

export function activate(g: GameState, p: PlayerId, obj: ObjId, abilityIndex: number, a: Answers = {}): GameState {
  g = act(g, { type: 'activate', player: p, obj, abilityIndex });
  return answer(g, a, p);
}

/**
 * Fast-forward to player p's next main-phase decision: ends other players' turns, passes on chains and
 * showdowns, and answers in-step decisions with the first legal action. Use only where the
 * intervening decisions are irrelevant to the scenario.
 */
export function toMainOf(g: GameState, p: PlayerId, limit = 80): GameState {
  for (let i = 0; i < limit; i++) {
    const d = g.pending;
    if (!d) return g;
    if (d.kind === 'mainAction' && d.player === p && i > 0) return g;
    if (d.kind === 'mainAction') { g = act(g, { type: 'endTurn', player: d.player }); continue; }
    if (d.inStep) { const l = getLegalActions(g, d.player); assert.ok(l.length, `no legal answer for ${d.kind}`); g = act(g, l[0]); continue; }
    g = act(g, { type: 'pass', player: d.player });
  }
  return g;
}
/** End the current turn and fast-forward to the next player's main phase. */
export function nextTurn(g: GameState): GameState {
  g = endTurn(g, g.activePlayer);
  for (let i = 0; i < 80; i++) {
    const d = g.pending;
    if (!d || d.kind === 'mainAction') return g;
    if (d.inStep) { const l = getLegalActions(g, d.player); assert.ok(l.length, `no legal answer for ${d.kind}`); g = act(g, l[0]); continue; }
    g = act(g, { type: 'pass', player: d.player });
  }
  return g;
}

/** Collect events over several steps. */
export class EventLog {
  events: { type: string; [k: string]: unknown }[] = [];
  act(g: GameState, a: Action): GameState { const r = applyAction(g, a); this.events.push(...r.events); return r.state; }
  pass(g: GameState): GameState { return this.act(g, { type: 'pass', player: pend(g).player }); }
  choose(g: GameState, ...ids: string[]): GameState { return this.act(g, { type: 'choose', player: pend(g).player, optionIds: ids }); }
  of(type: string) { return this.events.filter(e => e.type === type); }
  /** pass on chain/showdown decisions until something else is pending */
  passAll(g: GameState, limit = 40): GameState {
    for (let i = 0; i < limit; i++) { const d = g.pending; if (!d || d.inStep || (d.kind !== 'chainResponse' && d.kind !== 'showdownAction')) return g; g = this.pass(g); }
    return g;
  }
}

/**
 * Combat setup: P1 controls BF-A with `def` units there; P0 has `atk` units ready in base and moves
 * them all to BF-A. Returns the state right after the move (normally the combat showdown, P0 focus).
 */
export function attackSetup(atk: string[], def: string[], o: S0Opts & { defOpts?: PutOpts[]; atkOpts?: PutOpts[] } = {}): { g: GameState; atk: ObjId[]; def: ObjId[] } {
  const g0 = S0(o);
  const d = def.map((c, i) => put(g0, P1, c, BF_A, o.defOpts?.[i] ?? {}));
  if (d.length) control(g0, BF_A, P1);
  const a = atk.map((c, i) => put(g0, P0, c, 'base', o.atkOpts?.[i] ?? {}));
  const g = move(g0, P0, a, BF_A);
  return { g, atk: a, def: d };
}

// ------------------------------------------------------------------------------------------------
// inspection
// ------------------------------------------------------------------------------------------------

export const zone = (g: GameState, id: ObjId): string => g.objects[id]?.zone ?? 'gone';
export function locOf(g: GameState, id: ObjId): 'base' | number | null {
  const o = g.objects[id];
  if (!o) return null;
  if (o.zone === 'base') return 'base';
  if (o.zone === 'battlefield' || o.zone === 'facedown') return o.battlefieldIndex ?? null;
  return null;
}
/** Current Might (typed as a number for test arithmetic; the value is null only for objects without Might, e.g. gear). */
export const mightOf = (g: GameState, id: ObjId): number => chars(g, id).might as number;
export const hasKeyword = (g: GameState, id: ObjId, kw: string): boolean => chars(g, id).keywords.has(kw);
export const kwValue = (g: GameState, id: ObjId, kw: string): number => chars(g, id).keywords.get(kw) ?? 0;
export const readyRunes = (g: GameState, p: PlayerId) => g.players[p].runesInPlay.filter(r => !g.objects[r].exhausted).length;
export const exhaustedRunes = (g: GameState, p: PlayerId) => g.players[p].runesInPlay.filter(r => g.objects[r].exhausted).length;

/** Top-level legal actions of a given type for p. */
export function legal(g: GameState, p: PlayerId, type?: Action['type']): Action[] {
  return getLegalActions(g, p).filter(a => !type || a.type === type);
}
export function canPlayNow(g: GameState, p: PlayerId, obj: ObjId, dest?: 'base' | number): boolean {
  return legal(g, p, 'playCard').some(a => a.type === 'playCard' && a.obj === obj && (dest === undefined || a.destination === dest));
}
export function playDests(g: GameState, p: PlayerId, obj: ObjId): ('base' | number)[] {
  return legal(g, p, 'playCard').filter(a => a.type === 'playCard' && a.obj === obj).map(a => (a as { destination?: 'base' | number }).destination!).filter(d => d !== undefined);
}
export function moveDests(g: GameState, p: PlayerId, unit: ObjId): ('base' | number)[] {
  const s = new Set<'base' | number>();
  for (const a of legal(g, p, 'move')) if (a.type === 'move' && a.units.length === 1 && a.units[0] === unit) s.add(a.to);
  return [...s];
}
export function optionIds(g: GameState): string[] { return (pend(g).options ?? []).map(o => o.id); }

export function expectPending(g: GameState, kind: Decision['kind'], player: PlayerId, msg = ''): Decision {
  const d = pend(g);
  assert.equal(d.kind, kind, `${msg} expected pending ${kind} for P${player}, got ${d.kind} for P${d.player}: ${d.prompt}`);
  assert.equal(d.player, player, `${msg} expected pending ${kind} for P${player}, got P${d.player}`);
  return d;
}

export function chainLabels(g: GameState): string[] { return g.chain.map(c => `${c.kind}:${g.objects[c.source] ? g.cards[g.objects[c.source].cardId]?.name : c.source}`); }
export function chainSources(g: GameState): ObjId[] { return g.chain.map(c => c.source); }

export { assert };
export type { CardDef };

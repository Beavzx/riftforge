// Public engine API: createGame / getPending / getLegalActions / validateAction / applyAction / getView.
import type { Action, CardDef, CardId, Decision, Domain, GameEvent, GameSetup, GameState, PlayerId, PlayerView, ObjId } from './types.ts';
import { seedToState, shuffle } from './rng.ts';
import { newObject } from './state.ts';
import { beginRun, Suspend, Rollback } from './ask.ts';
import { cancelableFor, cancelBase } from './cancel.ts';
import { orderTriggers, finalizeTriggers, resolveTop, passPriority, allPassed } from './chain.ts';
import { hasQueuedTriggers, hasUnorderedTriggers } from './events.ts';
import { cleanupSteps, STAGE_PHASES } from './cleanup.ts';
import { runTask, endMainPhase } from './turn.ts';
import { showdownAllPassed, closeShowdown, showdownPass, startShowdown, startStaged } from './showdown.ts';
import { playCardAction, activateAction, hideAction, payStandardMove, effectivePlayCost } from './play.ts';
import { legalActions, validate } from './legal.ts';
import { moveUnits, exhaust, declareWinner, banish } from './actions.ts';
import { chooseOne } from './ask.ts';
import { validateDeck } from './deck.ts';
import { officialBanlist } from './banlist.ts';
import { log, cardName, clone, EngineError, activePlayers, turnOrderFrom } from './util.ts';
import { resetCharsGuards, chars } from './chars.ts';
import { emit } from './events.ts';
import { ruleApplies } from './rules.ts';
import { aliasView, hiddenIdsFor, makeViewKey, scrubber, trackHidden } from './hidden-ids.ts';
import { SYNTHETIC_TOKENS } from '../cards/tokens.ts';

export { EngineError };

const MAX_LOOP = 20000;

// ---------------- creation ----------------

export function createGame(setup: GameSetup): GameState {
  const mode = setup.mode ?? '1v1';
  const nBf = mode === '1v1' ? 3 : 3;
  if (setup.validateDecks !== false) {
    setup.players.forEach((pl, i) => {
      const probs = validateDeck(pl.deck, setup.cardDb, { battlefields: nBf, banlist: setup.enforceBanlist ? (setup.banlist ?? officialBanlist(mode === '2v2' ? 'constructed2v2' : 'standard')) : [] });
      if (probs.length) throw new EngineError(`player ${i} deck is illegal: ${probs.map(p => p.message).join('; ')}`);
    });
    // CR 491.8.h-i (2v2, DECISIONS #2194): teammates (seats 0/2, 1/3) can't use the same Champion Legend nor the same Battlefields
    if (mode === '2v2') for (const [a, b] of [[0, 2], [1, 3]]) {
      const da = setup.players[a]?.deck, db = setup.players[b]?.deck;
      if (!da || !db) continue;
      if (da.legend === db.legend) throw new EngineError(`2v2: teammates ${a} and ${b} can't use the same Champion Legend (CR 491.8.h)`);
      const shared = da.battlefields.filter(x => db.battlefields.includes(x));
      if (shared.length) throw new EngineError(`2v2: teammates ${a} and ${b} can't use the same Battlefields (${shared.join(', ')}; CR 491.8.i)`);
    }
  }
  const cards: Record<CardId, CardDef> = {};
  const want = (id: CardId) => { const d = setup.cardDb[id]; if (!d) throw new EngineError(`unknown card ${id}`); cards[id] = d; };
  for (const pl of setup.players) {
    [pl.deck.legend, pl.deck.champion, ...pl.deck.main, ...pl.deck.runes, ...pl.deck.battlefields].forEach(want);
  }
  for (const [id, d] of Object.entries(setup.cardDb)) if (d.supertypes.includes('Token') || d.type === 'Token') cards[id] = d;
  if (setup.includeAllCards) Object.assign(cards, setup.cardDb);
  for (const d of SYNTHETIC_TOKENS) if (!Object.values(cards).some(c => c.name === d.name && c.supertypes.includes('Token'))) cards[d.id] = d;
  for (const pl of setup.players) for (const id of pl.deck.extraLegends ?? []) want(id);
  const g: GameState = {
    version: 1, seed: setup.seed, rng: seedToState(setup.seed), nextObj: 1, timestamp: 0, cards, objects: {},
    players: setup.players.map((pl, i) => ({
      id: i as PlayerId, name: pl.name, points: 0, legend: '', championZone: [], hand: [], mainDeck: [], runeDeck: [],
      trash: [], banishment: [], base: [], runesInPlay: [], pool: { energy: 0, power: {} }, mulliganDone: false, conceded: false,
      xp: 0, poolRestricted: [], turnsTaken: 0,
    })),
    battlefields: [], turn: 0, activePlayer: 0, firstPlayer: (setup.firstPlayer ?? -1) as PlayerId, phase: 'setup', priority: null,
    chain: [], showdown: null, pending: null, triggerQueue: [], winner: null, log: [], actionCount: 0, mode,
    // CR 491.2 (2v2): teams by seat parity — seats 0/2 vs 1/3 (util.ts opponents/isOpponent use the same rule; RJ#6609, #572)
    ...(mode === '2v2' ? { teams: [[0, 2], [1, 3]] as PlayerId[][] } : {}),
    victoryScore: setup.victoryScore ?? (mode === '2v2' ? 11 : 8),
    ex: {
      firstChooser: setup.previousLoser,
      unit: null, tasks: [], passes: [], chainOpener: null, delayed: [], playedThisTurn: setup.players.map(() => []), usage: {},
      setAsideBattlefields: setup.players.map(() => []), manualPay: setup.players.map((_, i) => !!setup.manualPay?.[i]), extraTurns: [], staged: [],
      dirty: false, lastEvents: [], stepGuard: 0, combat: null, revealed: [], bfChoice: setup.battlefieldSelection ?? setup.battlefieldChoice ?? 'choose',
      damageSrc: {}, turnFacts: {}, counts: {}, attachCount: 0, links: {}, playPermissions: [], memo: {}, extraLegends: setup.players.map(() => []),
      hid: {},   // HIDDEN-IDS alias record (hidden-ids.ts trackHidden)
    },
  };
  setup.players.forEach((pl, i) => {
    const p = i as PlayerId;
    const P = g.players[p];
    P.legend = newObject(g, pl.deck.legend, p, 'legendZone').id;
    P.championZone.push(newObject(g, pl.deck.champion, p, 'championZone').id);
    // F-5: shuffle the card list first, then create the objects, so object ids carry no deck-list information
    // (same RNG use and resulting card order as shuffling the objects)
    const main = [...pl.deck.main], runeList = [...pl.deck.runes];
    if (!setup.skipShuffle) { shuffle(g, main); shuffle(g, runeList); }
    for (const id of main) P.mainDeck.push(newObject(g, id, p, 'mainDeck').id);
    for (const id of runeList) P.runeDeck.push(newObject(g, id, p, 'runeDeck').id);
    for (const id of pl.deck.battlefields) g.ex.setAsideBattlefields[p].push(newObject(g, id, p, 'setAside').id);
    for (const id of pl.deck.extraLegends ?? []) g.ex.extraLegends[p].push(newObject(g, id, p, 'setAside').id);
  });
  g.ex.tasks.push({ t: 'chooseBattlefields' }, { t: 'firstPlayer' }, { t: 'openingDraw' });
  g.ex.tasks.push({ t: setup.skipMulligan ? 'noop' : 'mulliganAll' }, { t: 'startGame' });
  g.ex.viewKey = makeViewKey(setup.seed, setup.viewSecret);   // HIDDEN-IDS: keys the view aliases (not from g.rng)
  log(g, null, 'Game created');
  const r0 = run(g, [], false);
  trackHidden(null, r0.state, r0.events);
  return r0.state;
}

// ---------------- main loop ----------------

function quiescentDecision(g: GameState, kind: Decision['kind'], player: PlayerId, prompt: string): Decision {
  return { kind, player, prompt, inStep: false };
}

function extraTask(g: GameState, t: { t: string }): boolean {
  if (t.t === 'noop') return true;
  if (t.t === 'mulliganAll') { g.ex.tasks.unshift(...turnOrderFrom(g, g.firstPlayer).map(p => ({ t: 'mulligan', player: p }))); return true; }
  return false;
}

export function advance(g: GameState): void {
  for (let i = 0; i < MAX_LOOP; i++) {
    if (g.winner !== null) { g.pending = null; g.phase = 'gameOver'; g.ex.tasks = []; return; }
    if (g.pending) return;
    // R-16: order new triggers, run the cleanup, then finalize the pending items (targets etc. see the cleaned-up board)
    if (hasUnorderedTriggers(g)) { orderTriggers(g); g.ex.dirty = true; continue; }
    if (g.ex.dirty) { g.ex.dirty = false; cleanupSteps(g); continue; }
    if (hasQueuedTriggers(g)) { finalizeTriggers(g); continue; }
    if (g.chain.length > 0) {
      if (g.priority === null || g.players[g.priority].conceded) g.priority = g.chain[g.chain.length - 1].controller;
      if (allPassed(g)) { resolveTop(g); continue; }
      g.pending = quiescentDecision(g, 'chainResponse', g.priority, 'Respond to the chain or pass');
      return;
    }
    // an open showdown runs before the remaining turn tasks (a showdown staged in the Ending Phase, RJ#1317)
    if (g.showdown && g.showdown.stage === 'open') {
      if (showdownAllPassed(g)) { closeShowdown(g); continue; }
      g.pending = quiescentDecision(g, 'showdownAction', g.showdown.focus, 'Showdown: play an Action/Reaction or pass');
      return;
    }
    // RJ#1317 / CR 323.11: staged showdowns begin in any Neutral Open state, also in the Ending Phase (before Expiration),
    // so their conquests and the final-point check belong to this turn; likewise in the start-of-turn phases, before the remaining
    // Hold / Channel / Draw / Main-start tasks (CR 308-310, DECISIONS #11019 / #9254, ENGINE-9)
    if (STAGE_PHASES.has(g.phase) && !g.showdown && g.ex.staged.length > 0) { startStaged(g); continue; }
    if (g.ex.tasks.length > 0) {
      const t = g.ex.tasks.shift()!;
      if (!extraTask(g, t)) runTask(g, t);
      g.ex.dirty = true;
      continue;
    }
    if (g.showdown) {
      // closing stage with no tasks left should not happen; recover
      g.showdown = null; g.ex.combat = null; continue;
    }
    if (g.ex.staged.length > 0 && g.phase === 'action') { startStaged(g); continue; }
    if (g.ex.staged.length > 0) { g.ex.staged = []; continue; }
    if (g.phase === 'action') {
      g.pending = quiescentDecision(g, 'mainAction', g.activePlayer, 'Your turn: play cards, move units, or end your turn');
      return;
    }
    throw new EngineError(`engine stalled in phase ${g.phase}`);
  }
  throw new EngineError('engine loop limit exceeded');
}

function applyTop(g: GameState, a: Action): void {
  const p = a.player;
  switch (a.type) {
    case 'playCard': playCardAction(g, a); break;
    case 'activate': activateAction(g, a); break;
    case 'hide': hideAction(g, a); break;
    case 'move': {
      payStandardMove(g, p, a.units, a.to, (a as { payment?: import('./types.ts').PaymentPlan }).payment);   // applied costs (B2-2)
      exhaust(g, a.units, p);                       // CR 144: exhausting is the cost
      emit(g, { type: 'standardMove', player: p, units: a.units, to: a.to });
      moveUnits(g, a.units, a.to, 'standard', p);
      break;
    }
    case 'pass':
    case 'endTurn': {
      if (g.chain.length > 0) passPriority(g, p);
      else if (g.showdown && g.showdown.stage === 'open') showdownPass(g, p);
      else endMainPhase(g);
      break;
    }
    default: throw new EngineError(`cannot apply ${a.type} here`);
  }
  g.ex.dirty = true;
}

interface RunResult { state: GameState; events: GameEvent[] }

/** Run from a quiescent base state with a list of actions (first is top-level if base has a quiescent pending). */
function run(base: GameState, actions: Action[], top: boolean, eventsFrom = 0, prevCancel?: PlayerId): RunResult {
  const g = cloneState(base);
  g.ex.lastEvents = [];
  g.ex.unit = null;
  delete g.ex.cancelFor;
  resetCharsGuards();
  beginRun(actions, top ? 1 : 0);
  try {
    if (top) { g.pending = null; applyTop(g, actions[0]); }
    advance(g);
  } catch (e) {
    if (e instanceof Suspend) {
      g.pending = e.decision;
      g.ex.unit = { base, actions };
      // UI-CANCEL: may the player still back out of the play in progress?
      const cf = cancelableFor(base, g, actions, top, e.decision, prevCancel);
      if (cf !== undefined) g.ex.cancelFor = cf;
      const events = g.ex.lastEvents.slice(eventsFrom);
      (g.ex as { unitEvents?: number }).unitEvents = g.ex.lastEvents.length;
      return { state: g, events };
    }
    if (e instanceof Rollback) {
      const r = cloneState(base);
      r.ex.unit = null;
      log(r, actions[0]?.player ?? null, `Action undone: ${e.reason}`);
      r.ex.lastEvents = [{ type: 'rollback', reason: e.reason }];
      // F-3d: remember the undone top-level action (bots skip it until something else happens)
      if (actions[0]) { const m = r.ex.memo ?? (r.ex.memo = {}); m.__rolledBack = [...((m.__rolledBack as string[] | undefined) ?? []), JSON.stringify(actions[0])].slice(-20); }
      return { state: r, events: r.ex.lastEvents };
    }
    throw e;
  }
  g.ex.unit = null;
  return { state: g, events: g.ex.lastEvents.slice(eventsFrom) };
}

/** PERF: the replay base of a new top-level action, i.e. cloneState(s) with ex.unit = null, but sharing s's contents
 *  instead of deep-copying them. Safe because applyAction never mutates its input (ARCHITECTURE.md), run() deep-copies
 *  the base before changing anything (and again on rollback), and a stored base (ex.unit.base) is only ever read or
 *  copied. Same keys in the same order as cloneState's result. */
function snapshotBase(s: GameState): GameState {
  const { cards, ex, log: lg, ...rest } = s;
  const { unit: _u, lastEvents: _e, ...exRest } = ex;
  const c = { ...rest, ex: { ...exRest, unit: null, lastEvents: [] } } as unknown as GameState;
  c.cards = cards;
  c.log = lg;
  return c;
}

function cloneState(s: GameState): GameState {
  const { cards, ex, log: lg, ...rest } = s;
  const { unit, lastEvents, ...exRest } = ex;
  const c = clone({ ...rest, ex: exRest }) as GameState;
  c.cards = cards;               // card defs are immutable
  c.log = lg.slice();            // log entries are never mutated after creation
  c.ex.unit = unit;              // bases are immutable snapshots: share them
  c.ex.lastEvents = [];
  void lastEvents;
  return c;
}

// ---------------- public API ----------------

export function getPending(state: GameState): Decision | null {
  return state.pending;
}

export function getLegalActions(state: GameState, player: PlayerId): Action[] {
  return legalActions(state, player);
}

export function validateAction(state: GameState, action: Action): string | null {
  return validate(state, action);
}

export function applyAction(state: GameState, action: Action): { state: GameState; events: GameEvent[] } {
  const r = applyActionInner(state, action);
  // HIDDEN-IDS: re-alias hidden zones whose members changed (hidden-ids.ts). A cancel returns the exact pre-play state,
  // alias record included: nothing hidden from anyone moved or was shown during a cancelable play (cancel.ts).
  if (action.type !== 'cancel') trackHidden(state, r.state, r.events);
  return r;
}

function applyActionInner(state: GameState, action: Action): { state: GameState; events: GameEvent[] } {
  const err = validate(state, action);
  if (err) throw new EngineError(err);
  if (action.type === 'concede') return concede(state, action.player);
  if (action.type === 'cancel') return cancelPlay(state, action.player);
  let res: RunResult;
  if (state.pending?.inStep && state.ex.unit) {
    const u = state.ex.unit;
    const from = (state.ex as { unitEvents?: number }).unitEvents ?? 0;
    res = run(u.base, [...u.actions, action], !!(u.base.pending && !u.base.pending.inStep), from, state.ex.cancelFor);
  } else {
    res = run(snapshotBase(state), [action], true);
  }
  res.state.actionCount = state.actionCount + 1;
  if (res.events[0]?.type !== 'rollback' && !res.state.pending?.inStep && res.state.ex.memo) delete res.state.ex.memo.__rolledBack;
  return res;
}

/** UI-CANCEL: return to the state before the play began (validated by legal.ts). Only actionCount moves on (it is the
 *  network version, which must keep increasing); no log entry (the opponent never saw the play, see getView). */
function cancelPlay(state: GameState, p: PlayerId): { state: GameState; events: GameEvent[] } {
  const r = cloneState(cancelBase(state));
  r.ex.unit = null;
  r.actionCount = state.actionCount + 1;
  r.ex.lastEvents = [{ type: 'playCancelled', player: p }];
  return { state: r, events: r.ex.lastEvents };
}

function concede(state: GameState, p: PlayerId): { state: GameState; events: GameEvent[] } {
  const g = cloneState(state);
  g.ex.unit = null;
  delete g.ex.cancelFor;
  g.ex.lastEvents = [];
  g.players[p].conceded = true;
  log(g, p, `${g.players[p].name} concedes`);
  const left = activePlayers(g);
  if (left.length === 1) { declareWinner(g, left[0], 'opponent conceded'); return { state: g, events: g.ex.lastEvents }; }
  // CR 491.6.a (2v2): teammates win or lose together — one player's concession ends the game for their team
  if (g.mode === '2v2') { const w = left.find(q => q % 2 !== p % 2); if (w !== undefined) { declareWinner(g, w, 'the opposing team conceded'); return { state: g, events: g.ex.lastEvents }; } }
  // CR 652: removal steps (multiplayer)
  const owned: ObjId[] = Object.values(g.objects).filter(o => (o.controller === p || o.owner === p) && ['base', 'battlefield', 'facedown', 'runePool'].includes(o.zone) && !g.battlefields.some(b => b.objId === o.id)).map(o => o.id);
  banish(g, owned);
  g.chain = g.chain.filter(c => c.controller !== p);
  g.pending = null;
  if (g.activePlayer === p) { g.ex.tasks = [{ t: 'nextTurn' }]; g.chain = []; g.showdown = null; }
  beginRun([], 0);
  try { advance(g); } catch (e) { if (e instanceof Suspend) { g.pending = e.decision; g.ex.unit = { base: cloneState(g), actions: [] }; } else throw e; }
  return { state: g, events: g.ex.lastEvents };
}

/** Redacted view for one player (hidden hands, deck order, facedown cards, engine internals). */
export function getView(state: GameState, viewer: PlayerId): PlayerView {
  // UI-CANCEL: while a player can still cancel their play, everyone else sees the board as it was before the play began
  // (the card being played, its choices and partial payment stay private until it finalizes)
  const cf = state.ex.cancelFor;
  if (cf !== undefined && cf !== viewer && state.pending?.inStep && state.ex.unit) {
    const v = getView(cancelBase(state), viewer);
    v.state.actionCount = state.actionCount;
    v.pending = v.state.pending = { kind: state.pending.kind, player: state.pending.player, prompt: `${state.players[cf]?.name ?? 'Opponent'} is making choices`, inStep: true };
    v.legal = [];
    return v;
  }
  const s = cloneState(state);
  s.ex.unit = null;
  s.rng = 0;
  // public derived values (post-layer)
  for (const o of Object.values(s.objects)) {
    if (!['base', 'battlefield', 'legendZone', 'chain'].includes(o.zone) && !(o.zone === 'facedown' && o.controller === viewer)) continue;
    try {
      const c = chars(state, o.id);
      o.derived = { might: c.might, keywords: [...c.keywords.entries()].map(([k, v]) => (v > 1 || ['Assault', 'Shield', 'Deflect', 'Hunt', 'Disarm'].includes(k) ? `${k} ${v}` : k)), tags: c.tags, type: c.type, name: c.name, controller: o.controller, ...(c.mightSources ? { mightSources: c.mightSources } : {}) };
    } catch { /* ignore */ }
  }
  // hidden from the viewer: hands of others, decks, set-aside cards, others' facedown cards (minus revealed ones and
  // the objects shown in the viewer's own decision) — hidden-ids.ts hiddenIdsFor
  const hidden = hiddenIdsFor(state, viewer);
  for (const o of Object.values(s.objects)) if (hidden.has(o.id)) { o.cardId = 'hidden'; o.modifiers = []; o.counters = {}; }
  // HIDDEN-IDS (BX-5): hidden objects appear under opaque per-view aliases; zone arrays list them in alias order (no deck
  // position / hand order); every other mention of them is neutralised; seed, view key and engine memo are stripped
  const aliases = aliasView(state, s, viewer, hidden);
  // F-5: card definitions only for what the viewer may know (own cards, visible objects, tokens and battlefields)
  const known = new Set<string>();
  for (const o of Object.values(s.objects)) {
    if (o.cardId !== 'hidden') known.add(o.cardId);
    for (const m of o.modifiers) if (m.copyOf) known.add(m.copyOf);
  }
  for (const o of Object.values(state.objects)) if (o.owner === viewer) known.add(o.cardId);
  for (const [id, d] of Object.entries(state.cards)) if (d.type === 'Battlefield' || d.type === 'Token' || d.supertypes.includes('Token')) known.add(id);
  s.cards = Object.fromEntries(Object.entries(state.cards).filter(([id]) => known.has(id)));
  let pending: Decision | null = s.pending;
  if (pending && pending.player !== viewer) pending = { kind: pending.kind, player: pending.player, prompt: pending.prompt, inStep: pending.inStep };
  if (pending && pending.player === viewer && pending.data?.private === false) pending = { ...pending };
  const costs: NonNullable<PlayerView['costs']> = {};
  const vp = state.players[viewer];
  if (vp) for (const id of [...vp.hand, ...vp.championZone]) { const c = effectivePlayCost(state, viewer, id); if (c) costs[id] = { energy: c.energy, power: c.power as (Domain[] | 'any')[] }; }
  // HIDDEN-IDS: the parts of the view built outside `s` get the same final scrub (keys / values naming a hidden id)
  const view: PlayerView = { you: viewer, state: s, pending, legal: legalActions(state, viewer), costs };
  if (aliases.size) { const { scrub } = scrubber(aliases); if (view.pending !== s.pending) view.pending = scrub(view.pending) as Decision | null; view.costs = scrub(view.costs) as typeof costs; }
  return view;
}

/** Engine-internal: run a full game step without the purity clone (used by fuzz/bots for speed). */
export function step(state: GameState, action: Action): GameState {
  return applyAction(state, action).state;
}

// AI-CORE: competence-puzzle helper for AI tests (pilot puzzles in tests/ai/plans/* use it; see docs/ai-plans.md).
// Builds a quiet main-phase position from two real meta decks (legends, champions, battlefields, decks as listed),
// with empty hands / boards / rune pools that the test then fills by card NAME, and asks the AI what it would do.
import { readFileSync } from 'node:fs';
import { createGame, applyAction, validateAction } from '../../../src/engine/index.ts';
import type { Action, CardDef, CardId, DeckList, GameState, ObjId, PlayerId, Domain } from '../../../src/engine/types.ts';
import { place, attachNow, setPoints, touch, type PlaceOpts } from '../../../src/engine/testkit.ts';
import { SearchAI, fastPolicy, describe, type SearchOptions } from '../../../src/ai/index.ts';

const DB: Record<CardId, CardDef> = JSON.parse(readFileSync(new URL('../../../data/cards.json', import.meta.url), 'utf8'));
export const deckFile = (f: string): DeckList => {
  const file = /\.json$/.test(f) ? f : f;
  return (JSON.parse(readFileSync(new URL(`../../../data/meta-decks/${file}`, import.meta.url), 'utf8')) as { deck: DeckList }).deck;
};

export interface PuzzleOpts {
  me: string;            // meta deck file of player 0 (the AI under test), e.g. '01-azir.json'
  opp: string;           // meta deck file of player 1
  turn?: number;         // g.turn (default 5); player 0 is the active player in its main phase
  seed?: number;
  /** battlefield card names for battlefield 0 / 1 (default: one of each player's listed battlefields) */
  bfs?: [string?, string?];
  /** keep each player's library as listed (default true: shuffled by the seed) */
  keepDecks?: boolean;
  /** remove the chosen champions from the champion zones (default false) */
  noChampion?: boolean;
}

export interface Puzzle {
  g: GameState;
  /** card id by name ("Name" or "Name, Subtitle"); prefers the version in that player's deck */
  id(name: string, p?: PlayerId): CardId;
  /** replace p's runes in play (ready) by these counts per domain, e.g. { Calm: 3, Order: 2 }; exhausted: { Calm: 1 } */
  runes(p: PlayerId, ready: Partial<Record<Domain, number>>, exhausted?: Partial<Record<Domain, number>>): ObjId[];
  hand(p: PlayerId, names: string[]): ObjId[];
  base(p: PlayerId, name: string, o?: PlaceOpts): ObjId;
  at(p: PlayerId, name: string, bf: number, o?: PlaceOpts): ObjId;
  token(p: PlayerId, name: string, loc: 'base' | number, o?: PlaceOpts): ObjId;
  facedown(p: PlayerId, name: string, bf: number, hiddenTurn?: number): ObjId;
  equip(gear: ObjId, unit: ObjId): void;
  points(p: PlayerId, n: number): void;
  control(bf: number, p: PlayerId | null): void;
  /** put named cards on top of p's library (first = top) */
  deckTop(p: PlayerId, names: string[]): ObjId[];
  legend(p: PlayerId): ObjId;
}

function findId(name: string, deck?: DeckList): CardId {
  const want = name.toLowerCase();
  const match = (d: CardDef) => d.name.toLowerCase() === want || `${d.name}, ${d.subtitle ?? ''}`.toLowerCase() === want;
  const inDeck = deck ? [deck.legend, deck.champion, ...deck.main, ...deck.battlefields, ...deck.runes, ...(deck.sideboard ?? [])].find(id => DB[id] && match(DB[id])) : undefined;
  if (inDeck) return inDeck;
  const any = Object.values(DB).filter(match);
  if (!any.length) throw new Error(`puzzle: no card named "${name}"`);
  return (any.find(d => d.supertypes.includes('Token') || d.type === 'Token') ?? any[0]).id;
}

export function puzzle(o: PuzzleOpts): Puzzle {
  const decks = [deckFile(o.me), deckFile(o.opp)];
  const g = createGame({ seed: o.seed ?? 1, cardDb: DB, battlefieldSelection: 'random', firstPlayer: 0, skipMulligan: true, validateDecks: false, includeAllCards: true,
    skipShuffle: o.keepDecks ?? false, players: [{ name: 'AI', deck: decks[0] }, { name: 'OPP', deck: decks[1] }] });
  for (const pl of g.players) {
    for (const id of [...pl.hand, ...pl.runesInPlay, ...pl.base, ...pl.trash]) { const ob = g.objects[id]; if (ob) { if (ob.zone === 'runePool') { ob.zone = 'runeDeck'; pl.runeDeck.push(id); } else { ob.zone = 'mainDeck'; pl.mainDeck.push(id); } } }
    if (o.noChampion) { for (const id of pl.championZone) { g.objects[id].zone = 'mainDeck'; pl.mainDeck.push(id); } pl.championZone = []; }
    pl.hand = []; pl.runesInPlay = []; pl.base = []; pl.trash = [];
    pl.points = 0; pl.xp = 0; pl.pool = { energy: 0, power: {} }; pl.poolRestricted = [];
    pl.turnsTaken = Math.max(1, Math.floor((o.turn ?? 5) / 2));
  }
  const bfObjs = new Set(g.battlefields.map(b => b.objId));
  for (const id in g.objects) { const ob = g.objects[id]; if (!bfObjs.has(id) && (ob.zone === 'battlefield' || ob.zone === 'facedown')) { ob.zone = 'mainDeck'; delete ob.battlefieldIndex; g.players[ob.owner].mainDeck.push(id); } }
  g.battlefields.forEach(b => { b.controller = null; b.contested = false; b.scoredThisTurnBy = []; });
  (o.bfs ?? []).forEach((nm, i) => { if (nm && g.battlefields[i]) { g.objects[g.battlefields[i].objId].cardId = findId(nm); } });
  g.turn = o.turn ?? 5; g.activePlayer = 0; g.phase = 'action'; g.priority = null; g.chain = []; g.showdown = null;
  g.ex.playedThisTurn = [[], []]; g.ex.counts = {}; g.ex.usage = {}; g.ex.turnFacts = {}; g.ex.unit = null; g.ex.tasks = [];
  g.pending = { kind: 'mainAction', player: 0, prompt: 'Your turn', inStep: false };
  touch(g);
  const z: Puzzle = {
    g,
    id: (name, p = 0) => findId(name, decks[p]),
    runes(p, ready, exhausted = {}) {
      const pl = g.players[p];
      for (const id of pl.runesInPlay) { g.objects[id].zone = 'runeDeck'; g.objects[id].exhausted = false; pl.runeDeck.push(id); }
      pl.runesInPlay = [];
      const out: ObjId[] = [];
      const take = (dom: Domain, n: number, exh: boolean) => {
        for (let i = 0; i < n; i++) {
          let idx = pl.runeDeck.findIndex(id => g.cards[g.objects[id].cardId]?.domains.includes(dom));
          let id: ObjId;
          if (idx >= 0) { id = pl.runeDeck.splice(idx, 1)[0]; g.objects[id].zone = 'runePool'; pl.runesInPlay.push(id); }
          else { const rc = Object.values(DB).find(d => d.type === 'Rune' && d.domains.includes(dom))!; id = place(g, p, rc.id, 'runes'); }
          g.objects[id].exhausted = exh; out.push(id); void idx; idx = -1;
        }
      };
      for (const [d, n] of Object.entries(ready)) take(d as Domain, n ?? 0, false);
      for (const [d, n] of Object.entries(exhausted)) take(d as Domain, n ?? 0, true);
      touch(g);
      return out;
    },
    hand: (p, names) => names.map(n => place(g, p, findId(n, decks[p]), 'hand')),
    base: (p, name, op = {}) => place(g, p, findId(name, decks[p]), 'base', op),
    at: (p, name, bf, op = {}) => place(g, p, findId(name, decks[p]), bf, op),
    token: (p, name, loc, op = {}) => {
      const tid = Object.values(g.cards).find(d => d.name.toLowerCase() === name.toLowerCase() && (d.type === 'Token' || d.supertypes.includes('Token') || d.id.startsWith('tok-')))?.id ?? findId(name, decks[p]);
      return place(g, p, tid, loc, { ...op, token: true });
    },
    facedown: (p, name, bf, hiddenTurn) => place(g, p, findId(name, decks[p]), 'base', { faceDownAt: bf, hiddenTurn: hiddenTurn ?? g.turn - 1 }),
    equip: (gear, unit) => attachNow(g, gear, unit),
    points: (p, n) => setPoints(g, p, n),
    control: (bf, p) => { g.battlefields[bf].controller = p; touch(g); },
    deckTop: (p, names) => names.slice().reverse().map(n => place(g, p, findId(n, decks[p]), 'deckTop')).reverse(),
    legend: p => g.players[p].legend,
  };
  return z;
}

/** The AI's next action for p (fresh AI with default options unless given). */
export function aiAction(g: GameState, p: PlayerId = 0, opts: SearchOptions = {}): Action | null {
  return new SearchAI({ seed: 1, ...opts }).choose(g, p);
}

export interface TurnResult { actions: Action[]; names: string[]; state: GameState; log: string[] }

/**
 * Play p's turn to its end with the AI (the opponent answers its own decisions with the heuristic bot, or with
 * `oppPass` = always pass). Stops when the opponent's main phase starts, the game ends, or after `cap` actions.
 */
export function aiTurn(g: GameState, p: PlayerId = 0, opts: SearchOptions & { oppPass?: boolean; cap?: number } = {}): TurnResult {
  const ai = new SearchAI({ seed: 1, ...opts });
  const actions: Action[] = [], names: string[] = [];
  const log0 = g.log.length;
  for (let i = 0; i < (opts.cap ?? 120) && g.winner === null; i++) {
    const d = g.pending;
    if (!d) break;
    if (d.player !== p && !d.inStep && d.kind === 'mainAction') break;
    let a: Action | null;
    if (d.player === p) a = ai.choose(g, p);
    else a = opts.oppPass && !d.inStep ? { type: 'pass', player: d.player } : fastPolicy(g, d.player);
    if (!a || validateAction(g, a) !== null) break;
    if (d.player === p) { actions.push(a); names.push(describe(g, a)); }
    g = applyAction(g, a).state;
  }
  return { actions, names, state: g, log: g.log.slice(log0).map(e => e.text) };
}

export { describe };

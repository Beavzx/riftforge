// Riftforge "gym" bridge: drive the rules engine from any language over JSON lines on stdin/stdout.
//
//   node --import tsx tools/gym-server.ts
//
// One JSON request per line, one JSON response per line. Requests:
//   {"cmd":"decks"}                                       -> {"decks":[{"file","legend","player","placing"}...]}
//   {"cmd":"reset","seed":1,"decks":["01-...json","02-...json"],"firstPlayer":0}
//        decks: meta-deck file names from data/meta-decks, or inline DeckList objects
//                                                        -> observation (see below)
//   {"cmd":"step","index":3}        take legal[3] for the player to act
//   {"cmd":"step","action":{...}}   take an explicit Action (validated; illegal -> {"error":...}, state unchanged)
//   {"cmd":"bot"}                   let the built-in engine bot (src/engine/bot.ts) act for the player to act
//   {"cmd":"save"} -> {"id":"s1"}   snapshot the current state (for tree search); {"cmd":"load","id":"s1"} restores it
//   {"cmd":"state"}                 full (unredacted) GameState — for debugging/search only, never show it to a player
//
// Observation: {"toAct":p, "kind":decision kind, "prompt":..., "inStep":bool, "legal":[Action...],
//               "view": PlayerView for toAct (hidden info redacted), "done":bool, "winner":p|null,
//               "points":[...], "turn":n, "events":[types of events from the last step]}
// Set "view":false in reset/step to omit the (large) view.
import { createInterface } from 'node:readline';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame, applyAction, getLegalActions, validateAction, getView, chooseAction } from '../src/engine/index.ts';
import type { Action, CardDef, CardId, DeckList, GameState } from '../src/engine/types.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cardDb: Record<CardId, CardDef> = JSON.parse(readFileSync(join(ROOT, 'data/cards.json'), 'utf8'));
const deckDir = join(ROOT, 'data/meta-decks');
const deckFiles = () => readdirSync(deckDir).filter(f => /^\d+-.*\.json$/.test(f)).sort();
const loadDeck = (d: string | DeckList): DeckList => typeof d === 'string' ? JSON.parse(readFileSync(join(deckDir, d), 'utf8')).deck : d;

let g: GameState | null = null;
let lastEvents: string[] = [];
const saves = new Map<string, GameState>();
let saveN = 0;

function obs(withView = true) {
  if (!g) return { error: 'no game: send reset first' };
  const d = g.pending;
  const done = g.winner !== null || !d;
  const p = d?.player ?? 0;
  return {
    toAct: done ? null : p, kind: d?.kind ?? null, prompt: d?.prompt ?? null, inStep: !!d?.inStep,
    legal: done ? [] : getLegalActions(g, p),
    view: withView && !done ? getView(g, p) : undefined,
    done, winner: g.winner, points: g.players.map(x => x.points), turn: g.turn, events: lastEvents,
  };
}

function handle(req: any): unknown {
  switch (req.cmd) {
    case 'decks':
      return { decks: deckFiles().map(f => { const j = JSON.parse(readFileSync(join(deckDir, f), 'utf8')); return { file: f, legend: j.legendName, player: j.player, placing: j.placing }; }) };
    case 'reset': {
      const decks: [string | DeckList, string | DeckList] = req.decks ?? [deckFiles()[0], deckFiles()[1]];
      g = createGame({
        seed: req.seed ?? 1, cardDb, battlefieldSelection: 'random', firstPlayer: req.firstPlayer, enforceBanlist: false,
        players: decks.map((d, i) => ({ name: typeof d === 'string' ? d : `P${i}`, deck: loadDeck(d) })),
      });
      lastEvents = []; saves.clear();
      return obs(req.view !== false);
    }
    case 'step': case 'bot': {
      if (!g) return { error: 'no game' };
      const d = g.pending;
      if (!d || g.winner !== null) return { error: 'game over' };
      let a: Action | null;
      if (req.cmd === 'bot') a = chooseAction(g, d.player) ?? getLegalActions(g, d.player)[0] ?? null;
      else if (typeof req.index === 'number') a = getLegalActions(g, d.player)[req.index] ?? null;
      else a = req.action ?? null;
      if (!a) return { error: 'no such action' };
      const err = validateAction(g, a);
      if (err) return { error: `illegal: ${err}` };
      const r = applyAction(g, a);
      g = r.state; lastEvents = r.events.map(e => e.type);
      return obs(req.view !== false);
    }
    case 'save': { if (!g) return { error: 'no game' }; const id = `s${++saveN}`; saves.set(id, structuredClone(g)); return { id }; }
    case 'load': { const s = saves.get(req.id); if (!s) return { error: 'unknown save' }; g = structuredClone(s); return obs(req.view !== false); }
    case 'state': return g ?? { error: 'no game' };
    default: return { error: `unknown cmd ${req.cmd}` };
  }
}

const rl = createInterface({ input: process.stdin });
rl.on('line', line => {
  if (!line.trim()) return;
  let out: unknown;
  try { out = handle(JSON.parse(line)); } catch (e) { out = { error: (e as Error).message }; }
  process.stdout.write(JSON.stringify(out) + '\n');
});

// Interaction fuzzer core (FUZZ agent). Used by tools/fuzz.ts (CLI, worker_threads) and tests/fuzz/*.test.ts.
//
// - genDeck(): random LEGAL decks from the whole card pool (validated with the engine's validateDeck),
//   optionally biased toward interaction-dense cards (data/card-analysis.json patterns).
// - playFuzzGame(): plays one game with per-seat policies (uniform random legal, "chaos" = random answers
//   drawn from the full decision space incl. manual payments / damage assignments, heuristic bot) and checks
//   invariants after every action (see INVARIANTS below).
// - replaySpec(): deterministic replay of a recorded game (optionally lenient: invalid actions are skipped),
//   used for determinism checks, minimisation and the regression tests.
// - minimize(): shrinks the action log and both decks while the same failure signature reproduces.
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createGame, applyAction, getLegalActions, validateAction, getView, validateDeck, EngineError, chooseAction,
} from '../src/engine/index.ts';
import type { Action, CardDef, CardId, Decision, DeckList, GameEvent, GameSetup, GameState, ObjId, PaymentPlan, PlayerId } from '../src/engine/types.ts';
import { makeRng } from '../src/engine/rng.ts';
import { ruleApplies } from '../src/engine/rules.ts';
import { checkInvariants, checkViewIds } from '../tests/fixtures/invariants.ts';
import { isAction } from '../src/net/protocol.ts';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- card pool

export type Db = Record<CardId, CardDef>;
let DB: Db | null = null;
export function loadDb(): Db {
  if (!DB) DB = JSON.parse(readFileSync(join(ROOT, 'data/cards.json'), 'utf8')) as Db;
  return DB;
}

interface Analysis { abilities: { kind: string; patterns: string[] }[] }
let DENSITY: Record<CardId, number> | null = null;
/** Interaction density per card: triggers, statics, replacements, copy/control/counter, play-from-zone, "weird" patterns. */
export function density(): Record<CardId, number> {
  if (DENSITY) return DENSITY;
  const a = JSON.parse(readFileSync(join(ROOT, 'data/card-analysis.json'), 'utf8')) as Record<CardId, Analysis>;
  const out: Record<CardId, number> = {};
  const heavy = /^(weird|replacement):|effect:(copy|take-control|gain-control-spell|lose-control|counter|swap-|double-|extra-turn|replace-battlefield|add-battlefield|repeat-effect|become-unit|set-might|set-base-might)|static:(copy|trigger-doubling|turn-structure|victory-rule|cant|must)/;
  const mid = /^(trigger|static|play|choice):|effect:(play-card-from-zone|return-from-trash|delayed-trigger|attach|detach|recall|move|ready|stun|kill|banish|return-to-hand|discard|predict|look-top|reveal)|condition:/;
  for (const [id, c] of Object.entries(a)) {
    let s = 0;
    for (const ab of c.abilities ?? []) {
      if (['triggered', 'static', 'replacement', 'activated', 'play-modifier'].includes(ab.kind)) s += 1;
      for (const p of ab.patterns ?? []) s += heavy.test(p) ? 3 : mid.test(p) ? 1 : 0;
    }
    out[id] = s;
  }
  DENSITY = out;
  return out;
}

const nameKey = (c: CardDef) => (c.subtitle ? `${c.name}, ${c.subtitle}` : c.name);
const isToken = (c: CardDef) => c.type === 'Token' || c.supertypes.includes('Token');
const fits = (c: CardDef, id: Set<string>) => c.domains.filter(d => d !== 'Colorless').every(d => id.has(d));
function championTag(legend: CardDef, champ: CardDef): string | null {
  const shared = legend.tags.filter(t => champ.tags.includes(t));
  if (shared.length) return shared.find(t => t === champ.name) ?? shared[shared.length - 1];
  return legend.tags[legend.tags.length - 1] ?? null;
}

export interface DeckOpts { dense?: boolean; extraCards?: number }

/** A random legal deck from the whole pool. Throws if the validator rejects 20 attempts in a row. */
export function genDeck(r: () => number, opts: DeckOpts = {}, db: Db = loadDb()): DeckList {
  const all = Object.values(db);
  const legends = all.filter(c => c.type === 'Legend');
  const champs = all.filter(c => c.type === 'Unit' && c.supertypes.includes('Champion') && !c.supertypes.includes('Signature') && !isToken(c));
  const mains = all.filter(c => ['Unit', 'Gear', 'Spell'].includes(c.type) && !isToken(c));
  const runes = all.filter(c => c.type === 'Rune');
  const bfs = all.filter(c => c.type === 'Battlefield');
  const dens = density();
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  let lastErr = '';
  for (let attempt = 0; attempt < 20; attempt++) {
    const legend = pick(legends);
    const ident = new Set<string>(legend.domains);
    const cands = champs.filter(c => fits(c, ident) && legend.tags.some(t => c.tags.includes(t)));
    if (!cands.length) { lastErr = `no champion for ${legend.name}`; continue; }
    const champ = pick(cands);
    const tag = championTag(legend, champ);
    const pool = mains.filter(c => fits(c, ident) && (!c.supertypes.includes('Signature') || (tag !== null && c.tags.includes(tag))));
    const weight = (c: CardDef) => {
      let w = opts.dense ? 1 + 2 * (dens[c.id] ?? 0) : 1;
      if (tag && c.tags.includes(tag)) w *= 2;                 // legend/champion synergy
      return w;
    };
    const weights = pool.map(weight);
    const totalW = weights.reduce((s, x) => s + x, 0);
    const wpick = () => { let x = r() * totalW; for (let i = 0; i < pool.length; i++) { x -= weights[i]; if (x <= 0) return pool[i]; } return pool[pool.length - 1]; };
    const count = new Map<string, number>([[nameKey(champ), 1]]);
    let sigs = 0;
    const main: CardId[] = [];
    const want = 39 + (opts.extraCards ?? 0);
    for (let guard = 0; main.length < want && guard < 5000; guard++) {
      const c = wpick();
      const k = nameKey(c);
      const have = count.get(k) ?? 0;
      const unique = /\[Unique\]/.test(c.text) || c.keywords.includes('Unique');
      const anyNumber = /Your deck can have any number of cards named/.test(c.text);
      let lim = anyNumber ? 99 : unique ? 1 - have : 3 - have;
      if (c.supertypes.includes('Signature')) lim = Math.min(lim, 3 - sigs);
      if (lim <= 0) continue;
      const n = Math.min(lim, 1 + Math.floor(r() * 3), want - main.length);
      for (let i = 0; i < n; i++) main.push(c.id);
      count.set(k, have + n);
      if (c.supertypes.includes('Signature')) sigs += n;
    }
    const doms = legend.domains.filter(d => d !== 'Colorless');
    const runeFor = (d: string) => runes.find(x => x.domains.includes(d as never))!.id;
    const rl: CardId[] = [];
    if (doms.length <= 1) for (let i = 0; i < 12; i++) rl.push(runeFor(doms[0] ?? 'Fury'));
    else { const k = 3 + Math.floor(r() * 7); for (let i = 0; i < 12; i++) rl.push(runeFor(i < k ? doms[0] : doms[1 + Math.floor(r() * (doms.length - 1))])); }
    const bfPool = bfs.filter(c => fits(c, ident));
    const chosen: CardDef[] = [];
    for (let guard = 0; chosen.length < 3 && guard < 500; guard++) { const b = pick(bfPool); if (!chosen.some(x => x.name === b.name)) chosen.push(b); }
    const deck: DeckList = { legend: legend.id, champion: champ.id, main, runes: rl, battlefields: chosen.map(c => c.id) };
    if (main.some(id => /choose up to 3 different legends/.test(db[id].text))) {
      const others = legends.filter(l => l.id !== legend.id);
      const ex: CardId[] = [];
      for (let guard = 0; ex.length < 3 && guard < 100; guard++) { const l = pick(others); if (!ex.includes(l.id)) ex.push(l.id); }
      deck.extraLegends = ex;
    }
    const probs = validateDeck(deck, db, { battlefields: 3 });
    if (!probs.length) return deck;
    lastErr = probs.map(p => p.message).join('; ');
  }
  throw new Error(`genDeck: could not build a legal deck: ${lastErr}`);
}

// ---------------------------------------------------------------- game specs

export type Policy = 'random' | 'chaos' | 'bot';

export interface GameSpec {
  seed: number;
  decks: [DeckList, DeckList];
  policies: [Policy, Policy];
  manualPay: [boolean, boolean];
  battlefieldSelection: 'random' | 'choose';
  dense: boolean;
  /** META-AUDIT: the meta-deck files the decks came from (FUZZ_META) */
  meta?: [string, string];
  validateDecks?: boolean;      // false for minimised decks (fillers may exceed copy limits)
}

let META_DECKS: { file: string; deck: DeckList }[] | null = null;
/** META-AUDIT: FUZZ_META=1 plays two of the 20 Bologna lists (data/meta-decks, uniform pairs, so common legends meet most). */
function metaDecks(): { file: string; deck: DeckList }[] {
  if (META_DECKS) return META_DECKS;
  const dir = join(ROOT, 'data/meta-decks');
  return META_DECKS = readdirSync(dir).filter(f => /^\d+-.*\.json$/.test(f)).sort()
    .map(f => ({ file: f, deck: (JSON.parse(readFileSync(join(dir, f), 'utf8')) as { deck: DeckList }).deck }));
}

export function makeSpec(seed: number, denseRatio = 0.4): GameSpec {
  const r = makeRng(seed * 7919 + 17);
  const dense = r() < denseRatio;
  const pol = (): Policy => { const x = r(); return x < 0.35 ? 'random' : x < 0.75 ? 'chaos' : 'bot'; };
  if (process.env.FUZZ_META) {
    const md = metaDecks();
    const a = md[Math.floor(r() * md.length)], b = md[Math.floor(r() * md.length)];
    const strip = (d: DeckList): DeckList => { const { sideboard: _s, ...rest } = d as DeckList & { sideboard?: unknown }; return structuredClone(rest) as DeckList; };
    return {
      seed, decks: [strip(a.deck), strip(b.deck)], policies: [pol(), pol()], manualPay: [r() < 0.3, r() < 0.3],
      battlefieldSelection: r() < 0.5 ? 'choose' : 'random', dense: false, meta: [a.file, b.file],
    };
  }
  return {
    seed,
    decks: [genDeck(r, { dense, extraCards: r() < 0.1 ? Math.floor(r() * 6) : 0 }), genDeck(r, { dense, extraCards: r() < 0.1 ? Math.floor(r() * 6) : 0 })],
    policies: [pol(), pol()],
    manualPay: [r() < 0.3, r() < 0.3],
    battlefieldSelection: r() < 0.5 ? 'choose' : 'random',
    dense,
  };
}

export function setupOf(spec: GameSpec): GameSetup {
  return {
    seed: spec.seed, cardDb: loadDb(), battlefieldSelection: spec.battlefieldSelection, manualPay: [...spec.manualPay],
    validateDecks: spec.validateDecks !== false,
    players: [{ name: 'A', deck: spec.decks[0] }, { name: 'B', deck: spec.decks[1] }],
  };
}

// ---------------------------------------------------------------- failures

export interface Failure {
  kind: string;               // invariant / failure category
  message: string;
  step: number;               // index of the action (in the action log) at/after which it was detected
  turn: number;
  stack?: string;
  detail?: string;            // e.g. first differing path
  action?: Action;            // the action that triggered it (for probes: the probe)
  probe?: 'apply' | 'reject'; // the failure is about a probe action (not part of the game log)
  pendingKind?: string;
  cards?: string[];           // card names involved (pending source, chain, action objects)
  cardIds?: CardId[];
}

export function normalize(msg: string): string {
  return msg.replace(/\bc\d+_\d+\b/g, 'cN').replace(/\bo\d+\b/g, 'oN').replace(/\bd\d+\b/g, 'dN').replace(/\b\d+\b/g, 'N').replace(/\s+/g, ' ').slice(0, 220);
}
function topFrame(stack?: string): string {
  if (!stack) return '';
  for (const line of stack.split('\n').slice(1)) {
    const m = /(src\/[^\s:)]+):(\d+)/.exec(line);
    if (m) { const fn = /at (\S+) \(/.exec(line); return `${m[1]}${fn ? '#' + fn[1].replace(/^Object\./, '') : ''}`; }
  }
  return '';
}
export function signature(f: Failure): string {
  return `${f.kind}|${normalize(f.message)}|${topFrame(f.stack)}`;
}
export function sigHash(sig: string): string { return createHash('sha1').update(sig).digest('hex').slice(0, 10); }

const SOFT = new Set(['legal-rollback', 'bot-loop', 'bot-invalid', 'long-game', 'id-order-leak', 'cards-map-leak', 'undefined-prop']);
export const isSoft = (f: Failure) => SOFT.has(f.kind);

// ---------------------------------------------------------------- helpers

function stringify(g: GameState): string {
  return JSON.stringify(g);
}

/** JSON purity: functions, undefined in arrays, non-finite numbers, class instances, cycles. */
function purityProblems(x: unknown, path: string, out: string[], seen: Set<unknown>, depth = 0): void {
  if (out.length > 3 || depth > 60) return;
  if (x === null) return;
  const t = typeof x;
  if (t === 'function' || t === 'symbol' || t === 'bigint') { out.push(`${path}: ${t}`); return; }
  if (t === 'number') { if (!Number.isFinite(x as number)) out.push(`${path}: non-finite number ${x}`); return; }
  if (t !== 'object') return;
  if (seen.has(x)) { out.push(`${path}: cycle`); return; }
  const proto = Object.getPrototypeOf(x);
  if (proto !== Object.prototype && proto !== Array.prototype && proto !== null) { out.push(`${path}: non-plain object ${proto?.constructor?.name}`); return; }
  seen.add(x);
  if (Array.isArray(x)) x.forEach((v, i) => { if (v === undefined) out.push(`${path}[${i}]: undefined`); else purityProblems(v, `${path}[${i}]`, out, seen, depth + 1); });
  else for (const [k, v] of Object.entries(x as object)) {
    if (k === 'cards' && path.endsWith('base') || (k === 'cards' && path === '$')) continue;
    if (v !== undefined) purityProblems(v, `${path}.${k}`, out, seen, depth + 1);
  }
  seen.delete(x);
}

function objCardNames(g: GameState, ids: (ObjId | undefined)[]): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    if (!id) continue;
    const o = g.objects[id];
    if (o && g.cards[o.cardId]) out.add(nameKey(g.cards[o.cardId]));
  }
  return [...out];
}

function involved(g: GameState, a?: Action): ObjId[] {
  const ids: ObjId[] = [];
  const d = g.pending;
  if (d?.source) ids.push(d.source);
  for (const c of g.chain) ids.push(c.source);
  if (a && 'obj' in a) ids.push(a.obj);
  if (a?.type === 'move') ids.push(...a.units);
  if (a?.type === 'choose') for (const id of a.optionIds) if (g.objects[id]) ids.push(id);
  return ids;
}

/** Message for anything thrown (engine Suspend/Rollback objects are not Errors). */
function errText(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  const d = (e as { decision?: Decision })?.decision;
  if (d) return `Suspend escaped (in-step ${d.kind} asked outside a step: "${d.prompt.replace(/\b\d+\b/g, 'N').slice(0, 90)}")`;
  const rs = (e as { reason?: string })?.reason;
  if (rs) return `Rollback escaped: ${rs}`;
  return `non-Error thrown: ${JSON.stringify(e)?.slice(0, 120)}`;
}

function mkFail(g: GameState, kind: string, message: string, step: number, extra: Partial<Failure> = {}): Failure {
  const ids = involved(g, extra.action);
  return {
    kind, message, step, turn: g.turn, pendingKind: g.pending?.kind,
    cards: objCardNames(g, ids), cardIds: [...new Set(ids.map(i => g.objects[i]?.cardId).filter(Boolean) as string[])], ...extra,
  };
}

// ---------------------------------------------------------------- policies

function randomSubset<T>(r: () => number, xs: T[], min: number, max: number): T[] {
  const n = min + Math.floor(r() * (Math.max(min, max) - min + 1));
  const pool = [...xs];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, Math.min(n, pool.length));
}

function randomPlan(g: GameState, p: PlayerId, r: () => number): PaymentPlan {
  const runes = g.players[p].runesInPlay;
  const ready = runes.filter(id => !g.objects[id]?.exhausted);
  return { exhaust: randomSubset(r, ready, 0, ready.length), recycle: randomSubset(r, runes, 0, Math.min(3, runes.length)) };
}

/** A random answer drawn from the whole decision space (not just the enumerated sample), validated. */
function chaosInStep(g: GameState, d: Decision, legal: Action[], r: () => number): Action {
  const p = d.player;
  const tryIt = (a: Action) => validateAction(g, a) === null;
  if (d.kind === 'payment') {
    if (r() < 0.5) {
      const sug = d.data?.suggested as PaymentPlan | undefined;
      const cands: PaymentPlan[] = [];
      for (let i = 0; i < 6; i++) cands.push(randomPlan(g, p, r));
      if (sug) cands.push(sug);
      for (const plan of cands) { const a: Action = { type: 'choose', player: p, optionIds: ['manual'], data: plan }; if (tryIt(a)) return a; }
    }
    return { type: 'choose', player: p, optionIds: ['auto'] };
  }
  if (d.kind === 'assignDamage') {
    const ts = (d.data?.targets as { obj: ObjId }[] | undefined) ?? [];
    const total = (d.data?.total as number | undefined) ?? 0;
    for (let i = 0; i < 12 && ts.length; i++) {
      const asg: Record<ObjId, number> = {};
      for (let k = 0; k < total; k++) { const t = ts[Math.floor(r() * ts.length)].obj; asg[t] = (asg[t] ?? 0) + 1; }
      const a: Action = { type: 'assignDamage', player: p, assignment: asg };
      if (tryIt(a)) return a;
    }
    return legal[Math.floor(r() * legal.length)];
  }
  const opts = d.options ?? [];
  const min = d.min ?? 1, max = Math.min(d.max ?? 1, opts.length);
  for (let i = 0; i < 8; i++) {
    const a: Action = { type: 'choose', player: p, optionIds: randomSubset(r, opts.map(o => o.id), min, max) };
    if (tryIt(a)) return a;
  }
  return legal[Math.floor(r() * legal.length)];
}

function pickAction(pol: Policy, g: GameState, d: Decision, legal: Action[], r: () => number, seed: number): Action {
  if (pol === 'bot') return chooseAction(g, d.player, { randomness: 0.4, seed }) ?? legal[0];
  if (d.inStep) return pol === 'chaos' ? chaosInStep(g, d, legal, r) : legal[Math.floor(r() * legal.length)];
  const nonEnd = legal.filter(x => x.type !== 'endTurn' && x.type !== 'pass');
  let a = nonEnd.length && r() < 0.72 ? nonEnd[Math.floor(r() * nonEnd.length)] : legal[Math.floor(r() * legal.length)];
  if (pol === 'chaos' && (a.type === 'playCard' || a.type === 'activate' || a.type === 'hide') && r() < 0.12) a = { ...a, payment: randomPlan(g, d.player, r) };
  return a;
}

// ---------------------------------------------------------------- probes (illegal / malformed actions)

/** Actions that must be rejected by validateAction and applyAction (wire-shaped: pass net/protocol isAction). */
function illegalProbes(g: GameState, d: Decision, legal: Action[], r: () => number): Action[] {
  const p = d.player;
  const q = (1 - p) as PlayerId;
  const out: Action[] = [];
  const any = legal[Math.floor(r() * legal.length)];
  if (any) out.push({ ...any, player: q } as Action);                         // wrong player
  out.push({ type: 'choose', player: q, optionIds: [] });
  const oppHand = g.players[q].hand;
  const oppUnits = Object.values(g.objects).filter(o => o.controller === q && (o.zone === 'base' || o.zone === 'battlefield')).map(o => o.id);
  const myUnits = Object.values(g.objects).filter(o => o.controller === p && (o.zone === 'base' || o.zone === 'battlefield')).map(o => o.id);
  if (d.inStep) {
    const opts = d.options ?? [];
    out.push({ type: 'choose', player: p, optionIds: ['zz-no-such-option'] });
    if (opts.length) out.push({ type: 'choose', player: p, optionIds: [opts[0].id, opts[0].id] });
    const max = d.max ?? 1, min = d.min ?? 1;
    if (d.kind !== 'assignDamage' && d.kind !== 'payment') {
      if (opts.length > max) out.push({ type: 'choose', player: p, optionIds: opts.slice(0, max + 1).map(o => o.id) });
      if (min >= 1) out.push({ type: 'choose', player: p, optionIds: opts.slice(0, min - 1).map(o => o.id) });
    }
    out.push({ type: 'pass', player: p });
    out.push({ type: 'endTurn', player: p });
    if (oppHand.length) out.push({ type: 'playCard', player: p, obj: oppHand[0] });
    if (d.kind === 'assignDamage') {
      const ts = (d.data?.targets as { obj: ObjId }[] | undefined) ?? [];
      const total = (d.data?.total as number | undefined) ?? 0;
      if (ts.length) out.push({ type: 'assignDamage', player: p, assignment: { [ts[0].obj]: total + 1 } });
      out.push({ type: 'assignDamage', player: p, assignment: { 'o999999': total } });
      out.push({ type: 'choose', player: p, optionIds: [] });
    }
    if (d.kind === 'payment') {
      if (g.players[q].runesInPlay.length) out.push({ type: 'choose', player: p, optionIds: ['manual'], data: { exhaust: g.players[q].runesInPlay.slice(0, 2), recycle: [] } });
      out.push({ type: 'choose', player: p, optionIds: ['auto', 'manual'] });
    }
  } else {
    out.push({ type: 'choose', player: p, optionIds: [] });
    out.push({ type: 'assignDamage', player: p, assignment: {} });
    if (oppHand.length) out.push({ type: 'playCard', player: p, obj: oppHand[Math.floor(r() * oppHand.length)] });
    const deckTop = g.players[p].mainDeck[0];
    if (deckTop) out.push({ type: 'playCard', player: p, obj: deckTop });
    out.push({ type: 'playCard', player: p, obj: 'o999999' });
    out.push({ type: 'activate', player: p, obj: g.players[q].legend, abilityIndex: 0 });
    out.push({ type: 'activate', player: p, obj: 'o999999', abilityIndex: 0 });
    if (oppUnits.length) out.push({ type: 'move', player: p, units: [oppUnits[0]], to: 0 });
    if (myUnits.length) {
      out.push({ type: 'move', player: p, units: [myUnits[0], myUnits[0]], to: 'base' });
      out.push({ type: 'move', player: p, units: [myUnits[0]], to: 9 });
    }
    out.push({ type: 'move', player: p, units: [], to: 0 });
    const hand = g.players[p].hand;
    if (hand.length) out.push({ type: 'hide', player: p, obj: hand[0], battlefieldIndex: 9 });
    if (g.chain.length || g.showdown) out.push({ type: 'endTurn', player: p });
    // a legal play to an impossible destination
    const pc = legal.find(a => a.type === 'playCard' && a.destination !== undefined);
    if (pc && pc.type === 'playCard') out.push({ ...pc, destination: 9 });
  }
  return out.filter(a => isAction(a));
}

/** Readable, id-free description of a probe action (used in messages, so signatures group by root cause). */
function probeLabel(g: GameState, a: Action): string {
  const own = (id: string) => { const o = g.objects[id]; if (!o) return 'missing object'; const c = g.cards[o.cardId]; return `${o.controller === a.player ? 'own' : "opponent's"} ${o.zone} ${c?.type ?? '?'}`; };
  switch (a.type) {
    case 'playCard': return `playCard(${own(a.obj)}${a.destination !== undefined ? ` -> ${typeof a.destination === 'number' ? (g.battlefields[a.destination] ? 'bf' : 'bad bf') : a.destination}` : ''})`;
    case 'activate': { const o = g.objects[a.obj]; return o && o.controller !== a.player ? "activate(opponent's object)" : `activate(${own(a.obj)} #${a.abilityIndex >= 900 ? a.abilityIndex : 'n'})`; }
    case 'hide': return `hide(${own(a.obj)} -> ${g.battlefields[a.battlefieldIndex] ? 'bf' : 'bad bf'})`;
    case 'move': return `move(${a.units.map(own).join(',') || 'none'} -> ${typeof a.to === 'number' ? (g.battlefields[a.to] ? 'bf' : 'bad bf') : a.to})`;
    case 'choose': return `choose(${a.optionIds.length} options${a.data ? ' +data' : ''})`;
    case 'assignDamage': return `assignDamage(${Object.keys(a.assignment).length} targets)`;
    default: return a.type;
  }
}

/** Top-level candidates the enumerator must list iff validateAction accepts them (playCard/activate/hide). */
function topLevelCandidates(g: GameState, p: PlayerId): Action[] {
  const out: Action[] = [];
  const dests: (number | 'base' | undefined)[] = [undefined, 'base', ...g.battlefields.map((_, i) => i)];
  const zonesPlayable = new Set(['hand', 'trash', 'facedown', 'championZone', 'banishment', 'mainDeck']);
  for (const o of Object.values(g.objects)) {
    if (o.controller === p && zonesPlayable.has(o.zone) || (o.owner === p && zonesPlayable.has(o.zone))) {
      if (o.zone === 'mainDeck' && g.players[p].mainDeck[0] !== o.id) continue;
      for (const d of dests) out.push(d === undefined ? { type: 'playCard', player: p, obj: o.id } : { type: 'playCard', player: p, obj: o.id, destination: d });
    }
    if ((o.zone === 'base' || o.zone === 'battlefield' || o.zone === 'legendZone' || o.zone === 'runePool')) {
      for (const i of [0, 1, 2, 3, 4, 900, 901, 950, 951]) out.push({ type: 'activate', player: p, obj: o.id, abilityIndex: i });
    }
    if (o.zone === 'hand' && o.owner === p) g.battlefields.forEach((_, i) => out.push({ type: 'hide', player: p, obj: o.id, battlefieldIndex: i }));
  }
  return out;
}

function actionKey(a: Action, g?: GameState): string {
  switch (a.type) {
    case 'playCard': {
      const t = g?.objects[a.obj] ? g.cards[g.objects[a.obj].cardId]?.type : undefined;
      return `play|${a.obj}|${t === 'Spell' ? '' : a.destination ?? ''}`;
    }
    case 'activate': return `act|${a.obj}|${a.abilityIndex}`;
    case 'hide': return `hide|${a.obj}|${a.battlefieldIndex}`;
    default: return JSON.stringify(a);
  }
}

// ---------------------------------------------------------------- invariants

export interface CheckOpts {
  probeIllegal: number;     // probability per step of probing malformed/illegal actions
  probeLegal: number;       // probability per step of applying an extra random legal action (must not throw)
  enumCheck: number;        // probability per top-level step of validate-vs-enumerate consistency
  jsonCheck: number;        // probability per step of JSON round-trip re-application
  viewCheck: number;        // probability per step of getView redaction checks
  maxTurns: number;
  maxSteps: number;
  determinism: boolean;
}
export const DEFAULT_CHECKS: CheckOpts = { probeIllegal: 0.25, probeLegal: 0.2, enumCheck: 0.08, jsonCheck: 0.06, viewCheck: 0.15, maxTurns: 60, maxSteps: 5000, determinism: true };
export const NO_CHECKS: CheckOpts = { probeIllegal: 0, probeLegal: 0, enumCheck: 0, jsonCheck: 0, viewCheck: 0, maxTurns: 1e9, maxSteps: 1e9, determinism: false };

/** Structural invariants beyond tests/fixtures/invariants.ts. */
function structural(g: GameState): string[] {
  const errs: string[] = [];
  const np = g.players.length;
  const okP = (x: unknown) => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < np;
  for (const [k, o] of Object.entries(g.objects)) {
    if (o.id !== k) errs.push(`object key ${k} has id ${o.id}`);
    if (!okP(o.owner)) errs.push(`${k} invalid owner ${o.owner}`);
    if (!okP(o.controller)) errs.push(`${k} invalid controller ${o.controller}`);
    if (!g.cards[o.cardId]) errs.push(`${k} unknown cardId ${o.cardId}`);
    if (!Number.isInteger(o.damage)) errs.push(`${k} non-integer damage ${o.damage}`);
    if (o.zone === 'facedown' && (o.battlefieldIndex === undefined || !g.battlefields[o.battlefieldIndex])) errs.push(`${k} facedown at invalid battlefield ${o.battlefieldIndex}`);
    if (o.attachedTo && !['base', 'battlefield'].includes(o.zone)) errs.push(`${k} attached while in ${o.zone}`);
    for (const [c, n] of Object.entries(o.counters)) if (typeof n !== 'number' || !Number.isFinite(n)) errs.push(`${k} counter ${c}=${n}`);
  }
  g.battlefields.forEach((b, i) => {
    if (!g.objects[b.objId]) errs.push(`battlefield ${i} card ${b.objId} missing`);
    if (b.controller !== null && !okP(b.controller)) errs.push(`battlefield ${i} invalid controller ${b.controller}`);
  });
  for (const c of g.chain) {
    // tokens cease to exist when they leave the board (CR 179); abilities on the chain are independent of their source
    if (!g.objects[c.source] && c.kind === 'spell') errs.push(`${c.kind} chain item source ${c.source} missing`);
    if (!okP(c.controller)) errs.push(`chain item ${c.id} invalid controller`);
    if (c.kind === 'spell' && g.objects[c.source] && g.objects[c.source].zone !== 'chain') errs.push(`spell ${c.id} source ${c.source} in ${g.objects[c.source].zone}`);
    for (const grp of c.targets ?? []) for (const t of grp) if (typeof t !== 'string') errs.push(`chain item ${c.id} non-string target`);
  }
  const chainSrc = new Set(g.chain.map(c => c.source));
  for (const o of Object.values(g.objects)) if (o.zone === 'chain' && !chainSrc.has(o.id) && !g.pending?.inStep) errs.push(`${o.id} in chain zone without a chain item`);
  for (const p of g.players) {
    if (!Number.isInteger(p.points)) errs.push(`p${p.id} non-integer points`);
    if (p.xp < 0) errs.push(`p${p.id} negative xp`);
    for (const [dname, n] of Object.entries(p.pool.power)) if ((n ?? 0) < 0) errs.push(`p${p.id} negative ${dname} power`);
    for (const id of p.runesInPlay) { const o = g.objects[id]; if (o && g.cards[o.cardId]?.type !== 'Rune') errs.push(`${id} in runesInPlay is not a rune`); }
  }
  if (g.winner === null && g.pending) {
    const d = g.pending;
    if (!okP(d.player)) errs.push(`pending for invalid player ${d.player}`);
    else if (g.players[d.player].conceded) errs.push('pending decision for a conceded player');
    if (!d.inStep) {
      if (d.kind === 'mainAction' && (g.chain.length || (g.showdown && g.showdown.stage === 'open'))) errs.push('mainAction pending with a chain or open showdown');
      if (d.kind === 'mainAction' && d.player !== g.activePlayer) errs.push('mainAction pending for the non-turn player');
      if (d.kind === 'chainResponse' && !g.chain.length) errs.push('chainResponse pending with an empty chain');
      if (d.kind === 'chainResponse' && g.priority !== d.player) errs.push(`chainResponse for p${d.player} but priority p${g.priority}`);
      if (d.kind === 'showdownAction' && (!g.showdown || g.showdown.focus !== d.player)) errs.push(`showdownAction for p${d.player} but focus ${g.showdown?.focus}`);
    }
    const other = (1 - d.player) as PlayerId;
    if (np === 2 && getLegalActions(g, other).length) errs.push(`non-pending player p${other} has legal actions`);
  }
  const sd = g.showdown;
  if (sd) {
    if (!g.battlefields[sd.battlefieldIndex]) errs.push(`showdown at invalid battlefield ${sd.battlefieldIndex}`);
    if (!okP(sd.focus)) errs.push(`showdown focus invalid ${sd.focus}`);
    if (sd.isCombat) {
      if (!okP(sd.attacker) || !okP(sd.defender) || sd.attacker === sd.defender) errs.push(`combat attacker/defender invalid ${sd.attacker}/${sd.defender}`);
      if (g.ex.combat && g.ex.combat.bf !== sd.battlefieldIndex) errs.push(`combat bf ${g.ex.combat.bf} != showdown bf ${sd.battlefieldIndex}`);
    }
  }
  return errs;
}

function hiddenFor(g: GameState, viewer: PlayerId, id: ObjId): boolean {
  const o = g.objects[id];
  if (g.ex.revealed.includes(id)) return false;
  if (o.zone === 'mainDeck' || o.zone === 'runeDeck' || o.zone === 'setAside') return true;
  if (o.zone === 'hand' && o.owner !== viewer) return true;
  // CR 422.4 (RJ#10525): facedown cards are revealed to all players when the game ends
  // ("you can look at their facedown cards this turn" — Scuttle Crab's seeFacedown rule — lets the viewer see them; ENGINE-4, 76397dd349)
  if (o.zone === 'facedown' && o.controller !== viewer && g.winner === null && g.phase !== 'gameOver' && !ruleApplies(g, 'seeFacedown', viewer, id)) return true;
  return false;
}

/** getView redaction checks. `prev` = state before the step (for log-entry leaks). */
/** Objects each viewer has seen face up at some point (identity stays known: ids persist across zones). */
export type Known = [Set<ObjId>, Set<ObjId>];
export function newKnown(): Known { return [new Set(), new Set()]; }
function learn(g: GameState, known: Known, events: GameEvent[]): void {
  for (const viewer of [0, 1] as (0 | 1)[]) {
    for (const id in g.objects) if (!hiddenFor(g, viewer, id)) known[viewer].add(id);
    for (const e of events) {
      if (e.type === 'draw' || e.type === 'look') continue;
      if (typeof e.obj === 'string') known[viewer].add(e.obj);
      for (const id of (Array.isArray(e.objs) ? e.objs : []) as ObjId[]) known[viewer].add(id);
    }
  }
}
function viewProblems(g: GameState, prev: GameState | null, events: GameEvent[], known?: Known): Failure['kind'][] | string[] {
  const errs: string[] = [];
  // objects that were public at some point during the step (any event about them other than a private draw/look)
  const revealedNow = new Set<ObjId>();
  for (const e of events) {
    if (e.type === 'draw' || e.type === 'look') continue;
    if (typeof e.obj === 'string') revealedNow.add(e.obj);
    for (const id of (Array.isArray(e.objs) ? e.objs : []) as ObjId[]) revealedNow.add(id);
    for (const id of (Array.isArray(e.units) ? e.units : []) as ObjId[]) revealedNow.add(id);
  }
  for (const viewer of [0, 1] as (0 | 1)[]) {
    const v = getView(g, viewer);
    const own = new Set<ObjId>();
    if (g.pending && g.pending.player === viewer) { for (const o of g.pending.options ?? []) for (const id of o.objIds ?? []) own.add(id); if (g.pending.source) own.add(g.pending.source); }
    const hidden: ObjId[] = [];
    // UI-CANCEL: while a play can still be cancelled, the others are shown the board from before it (getView)
    const ref = g.ex.cancelFor !== undefined && g.ex.cancelFor !== viewer && g.pending?.inStep && g.ex.unit ? g.ex.unit.base : g;
    for (const id of Object.keys(ref.objects)) {
      if (!hiddenFor(ref, viewer, id) || (ref === g && own.has(id))) continue;
      hidden.push(id);
      // HIDDEN-IDS: hidden objects are listed under opaque aliases, never under their internal id
      const vo = v.state.objects[id];
      if (vo && vo.cardId !== 'hidden') errs.push(`view p${viewer}: ${ref.objects[id].zone} object ${id} shows cardId ${vo.cardId}`);
    }
    // HIDDEN-IDS (BX-5): no internal id of a hidden object anywhere, aliases fresh when a hidden zone gains a member
    errs.push(...checkViewIds(g, viewer, v, known?.[viewer], prev ? getView(prev, viewer) : undefined));
    if (v.state.ex.unit) errs.push(`view p${viewer}: replay unit not stripped`);
    if (v.pending && v.pending.player !== viewer && (v.pending.options || v.pending.data)) errs.push(`view p${viewer}: opponent's decision options/data leaked`);
    // cardIds of hidden objects appearing anywhere else in the view (except the cards map and objects)
    const visibleIds = new Set(Object.values(v.state.objects).map(o => o.cardId));
    const suspect = new Map<string, ObjId>();
    for (const id of hidden) { const c = ref.objects[id].cardId; if (!visibleIds.has(c)) suspect.set(c, id); }
    if (suspect.size) {
      const { objects: _o, cards: _c, log: _l, chain: _ch, ...rest } = v.state;
      // LKI snapshots (event.lki) describe objects at a time they were public
      const blob = JSON.stringify({ rest, pending: v.pending, legal: v.legal }, (k, val) => (k === 'lki' ? undefined : val));
      for (const [c, id] of suspect) if (blob.includes(`"${c}"`)) {
        const m = new RegExp(`.{0,60}"${c.replace(/[-]/g, '\\-')}".{0,20}`).exec(blob);
        errs.push(`view p${viewer}: hidden card ${c} (${id}) appears in view: ${m?.[0] ?? ''}`);
      }
    }
    // log entries added this step that name a hidden object
    if (prev) for (const e of g.log.slice(prev.log.length)) {
      for (const id of e.ref ?? []) {
        const o = g.objects[id];
        if (!o || !hiddenFor(g, viewer, id) || revealedNow.has(id) || known?.[viewer].has(id)) continue;
        if (!prev.objects[id] || !hiddenFor(prev, viewer, id)) continue;
        const nm = g.cards[o.cardId]?.name;
        if (nm && e.text.includes(nm)) errs.push(`view p${viewer}: log "${e.text.slice(0, 80)}" names hidden ${o.zone} object ${id}`);
      }
    }
  }
  return errs;
}

function jsonPure(g: GameState): string[] {
  const out: string[] = [];
  purityProblems(g, '$', out, new Set());
  return out;
}

// ---------------------------------------------------------------- the game loop

export interface GameResult {
  spec: GameSpec;
  actions: Action[];
  steps: number;
  turns: number;
  winner: PlayerId | null;
  failure: Failure | null;      // first hard failure (ends the game)
  soft: Failure[];              // soft findings (game continues)
  ms: number;
  stats: Record<string, number>;
}

function eventsHaveRollback(ev: GameEvent[]): string | null {
  const r = ev.find(e => e.type === 'rollback');
  return r ? String(r.reason) : null;
}

const CHAIN_ID = /^c\d+_\d+$/;
let MASK_BATCH = true;
export function setMaskEngineCounters(on: boolean): void { MASK_BATCH = on; }
/** First differing path between two JSON-ish values (undefined props = absent, key order ignored), or null. */
export function diffPath(a: unknown, b: unknown, path = '$'): string | null {
  if (a === b) return null;
  // F-2 (engine): chain item ids embed a module-level counter (play.ts newItemId); compare only the timestamp part
  if (MASK_BATCH && typeof a === 'string' && typeof b === 'string' && CHAIN_ID.test(a) && CHAIN_ID.test(b) && a.split('_')[0] === b.split('_')[0]) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) return null;
    return `${path}: ${JSON.stringify(a)?.slice(0, 80)} != ${JSON.stringify(b)?.slice(0, 80)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: array vs object`;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    if (a.length !== bb.length) return `${path}: length ${a.length} != ${bb.length}`;
    for (let i = 0; i < a.length; i++) { const d = diffPath(a[i], bb[i], `${path}[${i}]`); if (d) return d; }
    return null;
  }
  const ao = a as Record<string, unknown>, bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) {
    if (k === 'batch' && MASK_BATCH) continue;   // F-2 (engine): events.ts batchSeq is a module-level counter stored in state
    const d = diffPath(ao[k], bo[k], `${path}.${k}`); if (d) return d;
  }
  return null;
}
function stateDiff(x: GameState, y: GameState): string | null {
  const s = (g: GameState) => ({ ...g, ex: { ...g.ex, unit: null, lastEvents: [] }, cards: null });
  return diffPath(s(x), s(y));
}


export function playFuzzGame(spec: GameSpec, checks: CheckOpts = DEFAULT_CHECKS): GameResult {
  const t0 = Date.now();
  const r = makeRng(spec.seed * 104729 + 3);
  const actions: Action[] = [];
  const soft: Failure[] = [];
  const softSeen = new Set<string>();
  const stats: Record<string, number> = { probesIllegal: 0, probesLegal: 0, enumChecks: 0, jsonChecks: 0, viewChecks: 0, rollbacks: 0 };
  const addSoft = (f: Failure) => { const s = signature(f); if (!softSeen.has(s)) { softSeen.add(s); soft.push(f); } };
  const res = (g: GameState | null, failure: Failure | null): GameResult => ({
    spec, actions, steps: actions.length, turns: g?.turn ?? 0, winner: g?.winner ?? null, failure, soft, ms: Date.now() - t0, stats,
  });
  let g: GameState;
  try { g = createGame(setupOf(spec)); } catch (e) {
    return res(null, { kind: 'create-throw', message: String((e as Error).message), stack: (e as Error).stack, step: 0, turn: 0 });
  }
  // id-order leak: hidden objects keep the id assigned in deck-list order (checked once per game)
  let prevTurn = g.turn, prevActive = g.activePlayer;
  const known = newKnown();
  learn(g, known, []);
  const noRepeat = new Set<string>();
  let unitStart: Action | null = null;
  let lastRb = { step: 0, a: null as Action | null, type: '' };
  for (let step = 0; ; step++) {
    if (g.winner !== null) break;
    if (step >= checks.maxSteps) return res(g, mkFail(g, 'step-cap', `game did not end within ${checks.maxSteps} actions (turn ${g.turn})`, step));
    if (g.turn > checks.maxTurns) { addSoft(mkFail(g, 'long-game', `game exceeded ${checks.maxTurns} turns`, step)); break; }
    const d = g.pending;
    if (!d) return res(g, mkFail(g, 'no-pending', 'no pending decision and no winner', step));
    let legal: Action[];
    const pre = stringify(g);
    try { legal = getLegalActions(g, d.player); } catch (e) {
      return res(g, mkFail(g, 'legal-throw', errText(e), step, { stack: (e as Error).stack }));
    }
    if (stringify(g) !== pre) return res(g, mkFail(g, 'query-mutated', `getLegalActions mutated the state at ${diffPath(JSON.parse(pre), JSON.parse(stringify(g)))?.split(':')[0].replace(/\[\d+\]/g, '[i]').replace(/\.o\d+/g, '.oN')}`, step));
    if (!legal.length) return res(g, mkFail(g, 'no-legal-actions', `no legal actions for pending ${d.kind}`, step));
    // invariants on the current state
    let inv: string[];
    try { inv = [...checkInvariants(g), ...structural(g)]; } catch (e) {
      return res(g, mkFail(g, 'invariant-throw', errText(e), step, { stack: (e as Error).stack }));
    }
    if (inv.length) return res(g, mkFail(g, 'invariant', inv[0], step, { stack: undefined }));
    // pools: resources are lost at the end of each turn (CR 167, 317.2.d)
    if (g.turn !== prevTurn) {
      const pl = g.players[prevActive];
      const pw = Object.values(pl.pool.power).reduce((s, x) => s + (x ?? 0), 0);
      if (prevActive !== g.activePlayer && (pl.pool.energy > 0 || pw > 0)) return res(g, mkFail(g, 'pool-not-emptied', `p${prevActive} kept ${pl.pool.energy} energy / ${pw} power after the end of their turn`, step));
      prevTurn = g.turn; prevActive = g.activePlayer;
    }
    const before = stringify(g);
    // probes: illegal actions must be rejected without changing the state
    if (r() < checks.probeIllegal) {
      for (const a of illegalProbes(g, d, legal, r)) {
        stats.probesIllegal++;
        let verr: string | null;
        try { verr = validateAction(g, a); } catch (e) {
          addSoft(mkFail(g, 'validate-throw', `validateAction threw on ${a.type}: ${(e as Error).message}`, step, { stack: (e as Error).stack, action: a, probe: 'reject' }));
          continue;
        }
        if (verr === null) {
          addSoft(mkFail(g, 'illegal-accepted', `validateAction accepted ${probeLabel(g, a)}${d.inStep ? ` (pending ${d.kind})` : ''}`, step, { action: a, probe: 'reject' }));
          continue;
        }
        let threw = false;
        try { applyAction(g, a); } catch (e) { threw = true; if (!(e instanceof EngineError)) addSoft(mkFail(g, 'reject-wrong-error', `applyAction threw ${(e as Error).name} for an illegal ${a.type}: ${(e as Error).message}`, step, { stack: (e as Error).stack, action: a, probe: 'reject' })); }
        if (!threw) addSoft(mkFail(g, 'illegal-applied', `applyAction accepted illegal ${probeLabel(g, a)}: ${verr}`, step, { action: a, probe: 'reject' }));
      }
      if (stringify(g) !== before) return res(g, mkFail(g, 'input-mutated', 'a rejected action mutated the input state', step));
    }
    // validate vs enumerate (top-level)
    if (!d.inStep && r() < checks.enumCheck) {
      stats.enumChecks++;
      const listed = new Set(legal.map(x => actionKey(x, g)));
      for (const a of topLevelCandidates(g, d.player)) {
        let verr: string | null;
        try { verr = validateAction(g, a); } catch (e) {
          addSoft(mkFail(g, 'validate-throw', `validateAction threw on ${a.type}: ${(e as Error).message}`, step, { stack: (e as Error).stack, action: a, probe: 'reject' }));
          continue;
        }
        const k = actionKey(a, g);
        if (verr === null && !listed.has(k) && !(a.type === 'playCard' && a.destination === undefined)) {
          addSoft(mkFail(g, 'enum-missing', `validateAction accepts ${probeLabel(g, a)} but getLegalActions does not list it`, step, { action: a, probe: 'apply' }));
        }
      }
      for (const a of legal) {
        const verr = validateAction(g, a);
        if (verr) addSoft(mkFail(g, 'listed-invalid', `getLegalActions lists ${probeLabel(g, a)} but validateAction says: ${verr}`, step, { action: a, probe: 'apply' }));
      }
    }
    // extra legal action (not taken) must apply without throwing
    if (r() < checks.probeLegal && legal.length > 1) {
      const a = legal[Math.floor(r() * legal.length)];
      stats.probesLegal++;
      try {
        const rr = applyAction(g, a);
        const rb = eventsHaveRollback(rr.events);
        if (rb) { stats.rollbacks++; if (!d.inStep && !('payment' in a && a.payment)) addSoft(mkFail(g, 'legal-rollback', `listed ${a.type} rolled back: ${rb}`, step, { action: a, probe: 'apply' })); }
      } catch (e) {
        addSoft(mkFail(g, 'apply-throw', `${(e as Error).name}: ${(e as Error).message}`, step, { stack: (e as Error).stack, action: a, probe: 'apply' }));
      }
      if (stringify(g) !== before) return res(g, mkFail(g, 'input-mutated', `applying listed ${a.type} mutated the input state`, step, { action: a, probe: 'apply' }));
    }
    // the action actually taken
    // a listed action that rolled back leaves the state unchanged: don't pick it again until something else happens
    const fresh = noRepeat.size ? legal.filter(x => !noRepeat.has(JSON.stringify(x))) : legal;
    let a = pickAction(spec.policies[d.player as 0 | 1], g, d, fresh.length ? fresh : legal, r, spec.seed);
    if (noRepeat.has(JSON.stringify(a)) && fresh.length) {
      // the heuristic bot would pick the rolled-back action forever (F-3): note it once, then play on randomly
      addSoft(mkFail(g, 'bot-loop', `bot re-picks a listed ${lastRb.type} that rolls back`, lastRb.step, { action: lastRb.a ?? undefined }));
      a = fresh[Math.floor(r() * fresh.length)];
    }
    // the policy's choice must be valid (the heuristic bot builds its own answers; F-4)
    const perr = validateAction(g, a);
    if (perr !== null) {
      addSoft(mkFail(g, 'bot-invalid', `${spec.policies[d.player as 0 | 1]} policy produced an invalid ${d.inStep ? d.kind + ' answer' : a.type}: ${perr}`, step, { action: a, probe: 'reject' }));
      a = legal[Math.floor(r() * legal.length)];
    }
    let out: { state: GameState; events: GameEvent[] };
    try { out = applyAction(g, a); } catch (e) {
      actions.push(a);
      return res(g, mkFail(g, 'apply-throw', `${(e as Error).name}: ${(e as Error).message}`, step, { stack: (e as Error).stack, action: a }));
    }
    actions.push(a);
    if (stringify(g) !== before) return res(g, mkFail(g, 'input-mutated', `applying ${a.type} mutated the input state`, step, { action: a }));
    const rb = eventsHaveRollback(out.events);
    if (!d.inStep) unitStart = a;
    if (rb) lastRb = { step, a, type: unitStart?.type ?? a.type };
    // a unit rolled back by the chaos policy's random manual payment says nothing about its other answers (ENGINE-4, seed 696329)
    const randomPay = !!unitStart && 'payment' in unitStart && !!unitStart.payment;
    if (rb && !randomPay) { noRepeat.add(JSON.stringify(a)); if (unitStart) noRepeat.add(JSON.stringify(unitStart)); } else if (!out.state.pending?.inStep) noRepeat.clear();
    if (rb) { stats.rollbacks++; const fromList = legal.includes(a); if (fromList && !d.inStep && !(('payment' in a) && a.payment)) addSoft(mkFail(g, 'legal-rollback', `listed ${a.type} rolled back: ${rb}`, step, { action: a })); }
    const ng = out.state;
    // points never decrease except through an effect (pointsLost event)
    for (const p of ng.players) {
      const old = g.players[p.id].points;
      if (p.points < old && !out.events.some(e => e.type === 'pointsLost' && e.player === p.id)) return res(ng, mkFail(ng, 'points-decreased', `p${p.id} points ${old} -> ${p.points} without a pointsLost event`, step, { action: a }));
    }
    if (r() < checks.jsonCheck) {
      stats.jsonChecks++;
      const pure = jsonPure(ng);
      if (pure.length) return res(ng, mkFail(ng, 'json-impure', pure[0], step, { action: a }));
      try {
        const rt = JSON.parse(before) as GameState;
        const o2 = applyAction(rt, a);
        const dp = stateDiff(o2.state, ng);
        if (dp) return res(ng, mkFail(ng, 'json-roundtrip', `applying ${a.type} to a JSON round-tripped state gives a different result at ${dp.replace(/\[\d+\]/g, '[i]').replace(/\.o\d+/g, '.oN').split(':')[0]}`, step, { action: a, detail: dp }));
      } catch (e) {
        return res(ng, mkFail(ng, 'json-roundtrip', `applying ${a.type} to a JSON round-tripped state threw: ${(e as Error).message}`, step, { action: a, stack: (e as Error).stack }));
      }
    }
    if (r() < checks.viewCheck || ng.winner !== null) {
      stats.viewChecks++;
      let vp: string[];
      try { vp = viewProblems(ng, g, out.events, known) as string[]; } catch (e) {
        return res(ng, mkFail(ng, 'view-throw', errText(e), step, { stack: (e as Error).stack, action: a }));
      }
      if (vp.length) return res(ng, mkFail(ng, 'view-leak', vp[0], step, { action: a }));
    }
    learn(ng, known, out.events);
    g = ng;
  }
  // determinism: replaying the action log from the seed reproduces the identical final state
  if (checks.determinism) {
    try {
      const h = replaySpec(spec, actions, { lenient: false });
      if (h.error) return res(g, { kind: 'replay-throw', message: h.error.message, stack: h.error.stack, step: h.applied, turn: g.turn });
      const dp = stateDiff(h.state!, g);
      if (dp) return res(g, { kind: 'nondeterminism', message: `replaying the action log produced a different final state at ${dp.split(':')[0].replace(/\[\d+\]/g, '[i]').replace(/\.o\d+/g, '.oN')}`, detail: dp, step: actions.length, turn: g.turn });
    } catch (e) { return res(g, { kind: 'replay-throw', message: String((e as Error).message), stack: (e as Error).stack, step: actions.length, turn: g.turn }); }
  }
  return res(g, null);
}

// ---------------------------------------------------------------- replay / repro

export interface ReplayResult { state: GameState | null; applied: number; skipped: number; error: Error | null }

export function replaySpec(spec: GameSpec, actions: Action[], o: { lenient: boolean }): ReplayResult {
  let g = createGame(setupOf(spec));
  let applied = 0, skipped = 0;
  for (const a of actions) {
    if (g.winner !== null) break;
    if (o.lenient && validateAction(g, a) !== null) { skipped++; continue; }
    try { g = applyAction(g, a).state; applied++; } catch (e) { return { state: g, applied, skipped, error: e as Error }; }
  }
  return { state: g, applied, skipped, error: null };
}

export interface Repro {
  hash: string;
  signature: string;
  kind: string;
  message: string;
  stack?: string;
  cards: string[];
  cardIds: CardId[];
  spec: GameSpec;
  actions: Action[];           // game log up to (and including) the failing action
  probe?: { action: Action; expect: 'apply' | 'reject' };
  original: { seed: number; steps: number; turn: number; policies: [Policy, Policy] };
  minimized: { actions: number; deckCards: number; ms: number };
  found: string;               // ISO date
  count?: number;              // occurrences in the last run
  triage?: { owner: 'script' | 'engine' | 'data' | 'fuzzer' | 'unknown'; status: 'open' | 'fixed' | 'filed' | 'wontfix'; note: string; ref?: string };
}

/**
 * Re-check a repro: replay `actions` (lenient or strict), with per-step invariant checks, then the probe.
 * Returns the failure found (if any). `want` restricts to failures with that signature.
 */
export function checkRepro(spec: GameSpec, actions: Action[], probe: Repro['probe'], o: { lenient: boolean; want?: string; kind?: string }): Failure | null {
  let g: GameState;
  try { g = createGame(setupOf(spec)); } catch (e) { return { kind: 'create-throw', message: String((e as Error).message), stack: (e as Error).stack, step: 0, turn: 0 }; }
  const match = (f: Failure | null) => (f && (!o.want || signature(f) === o.want) ? f : null);
  if (o.kind === 'nondeterminism') {
    // replay twice: plain, and with the queries the fuzzer makes (legal actions + both views) before every action
    const plain = replaySpec(spec, actions, { lenient: o.lenient });
    let h = g;
    for (const a of actions) {
      if (h.winner !== null) break;
      if (h.pending) { getLegalActions(h, h.pending.player); getView(h, 0); getView(h, 1); }
      if (validateAction(h, a) !== null) { if (o.lenient) continue; break; }
      h = applyAction(h, a).state;
    }
    const dp = plain.state ? stateDiff(plain.state, h) : null;
    return dp ? { kind: 'nondeterminism', message: `replaying the action log produced a different final state at ${dp.split(':')[0].replace(/\[\d+\]/g, '[i]').replace(/\.o\d+/g, '.oN')}`, detail: dp, step: actions.length, turn: h.turn } : null;
  }
  const stateChecks = (step: number): Failure | null => {
    if (g.winner !== null) return null;
    if (!g.pending) return mkFail(g, 'no-pending', 'no pending decision and no winner', step);
    let legal: Action[];
    try { legal = getLegalActions(g, g.pending.player); } catch (e) { return mkFail(g, 'legal-throw', errText(e), step, { stack: (e as Error).stack }); }
    if (!legal.length) return mkFail(g, 'no-legal-actions', `no legal actions for pending ${g.pending.kind}`, step);
    try { const inv = [...checkInvariants(g), ...structural(g)]; if (inv.length) return mkFail(g, 'invariant', inv[0], step); } catch (e) { return mkFail(g, 'invariant-throw', String((e as Error).message), step, { stack: (e as Error).stack }); }
    return null;
  };
  const viewKinds = o.kind === 'view-leak';
  let unitTop: Action | null = null;
  const known = newKnown();
  if (viewKinds) learn(g, known, []);
  for (let i = 0; i < actions.length; i++) {
    const f = match(stateChecks(i));
    if (f) return f;
    if (g.winner !== null) return null;
    const a = actions[i];
    if (validateAction(g, a) !== null) { if (o.lenient) continue; return null; }
    if (!g.pending?.inStep) unitTop = a;
    const before = viewKinds || o.kind === 'points-decreased' ? g : null;
    let out: { state: GameState; events: GameEvent[] };
    try { out = applyAction(g, a); } catch (e) { const ff = match(mkFail(g, 'apply-throw', `${(e as Error).name}: ${(e as Error).message}`, i, { stack: (e as Error).stack, action: a })); if (ff) return ff; return null; }
    if (!probe && (o.kind === 'bot-loop' || o.kind === 'legal-rollback') && i === actions.length - 1) {
      const rb = eventsHaveRollback(out.events);
      if (rb) { const ff = match(mkFail(g, o.kind, o.kind === 'bot-loop' ? `bot re-picks a listed ${unitTop?.type ?? a.type} that rolls back` : `listed ${a.type} rolled back: ${rb}`, i, { action: a })); if (ff) return ff; }
    }
    if (o.kind === 'json-impure') { const pure = jsonPure(out.state); if (pure.length) { const ff = match(mkFail(out.state, 'json-impure', pure[0], i, { action: a })); if (ff) return ff; } }
    if (o.kind === 'json-roundtrip') {
      try { const o2 = applyAction(JSON.parse(stringify(g)), a); const dp = stateDiff(o2.state, out.state); if (dp) { const ff = match(mkFail(out.state, 'json-roundtrip', `applying ${a.type} to a JSON round-tripped state gives a different result at ${dp.replace(/\[\d+\]/g, '[i]').replace(/\.o\d+/g, '.oN').split(':')[0]}`, i, { action: a, detail: dp })); if (ff) return ff; } }
      catch (e) { const ff = match(mkFail(out.state, 'json-roundtrip', `applying ${a.type} to a JSON round-tripped state threw: ${(e as Error).message}`, i, { action: a, stack: (e as Error).stack })); if (ff) return ff; }
    }
    if (o.kind === 'points-decreased' && before) for (const p of out.state.players) {
      const old = before.players[p.id].points;
      if (p.points < old && !out.events.some(e => e.type === 'pointsLost' && e.player === p.id)) { const ff = match(mkFail(out.state, 'points-decreased', `p${p.id} points ${old} -> ${p.points} without a pointsLost event`, i, { action: a })); if (ff) return ff; }
    }
    if (viewKinds) { const vp = viewProblems(out.state, before, out.events, known) as string[]; if (vp.length) { const ff = match(mkFail(out.state, 'view-leak', vp[0], i, { action: a })); if (ff) return ff; } learn(out.state, known, out.events); }
    g = out.state;
  }
  const f = match(stateChecks(actions.length));
  if (f) return f;
  if (probe && g.winner === null) {
    const a = probe.action;
    if (o.kind === 'bot-invalid') {
      // re-ask the bot (deterministic settings + the game's seed); the recorded answer is only a hint
      const p = g.pending!.player;
      let verr: string | null = null;
      for (const opts of [{ randomness: 0 }, { randomness: 0.4, seed: spec.seed }, { randomness: 0.4, seed: spec.seed + 1 }]) {
        const b = chooseAction(g, p, opts);
        if (b) { verr = validateAction(g, b); if (verr) break; }
      }
      return verr ? match(mkFail(g, 'bot-invalid', `${rpPolicy(spec, g)} policy produced an invalid ${g.pending?.inStep ? g.pending.kind + ' answer' : a.type}: ${verr}`, actions.length, { action: a, probe: 'reject' })) : null;
    }
    if (probe.expect === 'reject') {
      let verr: string | null;
      try { verr = validateAction(g, a); } catch (e) { return match(mkFail(g, 'validate-throw', `validateAction threw on ${a.type}: ${(e as Error).message}`, actions.length, { stack: (e as Error).stack, action: a, probe: 'reject' })); }
      if (verr === null) return match(mkFail(g, 'illegal-accepted', `validateAction accepted ${probeLabel(g, a)}${g.pending?.inStep ? ` (pending ${g.pending.kind})` : ''}`, actions.length, { action: a, probe: 'reject' }));
      try { applyAction(g, a); } catch (e) {
        if (!(e instanceof EngineError)) return match(mkFail(g, 'reject-wrong-error', `applyAction threw ${(e as Error).name} for an illegal ${a.type}: ${(e as Error).message}`, actions.length, { stack: (e as Error).stack, action: a, probe: 'reject' }));
        return null;
      }
      return match(mkFail(g, 'illegal-applied', `applyAction accepted illegal ${probeLabel(g, a)}: ${verr}`, actions.length, { action: a, probe: 'reject' }));
    } else {
      if (o.kind === 'enum-missing') {
        const legal = getLegalActions(g, a.player);
        if (validateAction(g, a) === null && !legal.some(x => actionKey(x, g) === actionKey(a, g))) return match(mkFail(g, 'enum-missing', `validateAction accepts ${probeLabel(g, a)} but getLegalActions does not list it`, actions.length, { action: a, probe: 'apply' }));
        return null;
      }
      if (o.kind === 'listed-invalid') {
        const verr = validateAction(g, a);
        if (verr && getLegalActions(g, a.player).some(x => actionKey(x, g) === actionKey(a, g))) return match(mkFail(g, 'listed-invalid', `getLegalActions lists ${probeLabel(g, a)} but validateAction says: ${verr}`, actions.length, { action: a, probe: 'apply' }));
        return null;
      }
      try { const rr = applyAction(g, a); const rb = eventsHaveRollback(rr.events); if (rb && o.kind === 'legal-rollback') return match(mkFail(g, 'legal-rollback', `listed ${a.type} rolled back: ${rb}`, actions.length, { action: a, probe: 'apply' })); }
      catch (e) { return match(mkFail(g, 'apply-throw', `${(e as Error).name}: ${(e as Error).message}`, actions.length, { stack: (e as Error).stack, action: a, probe: 'apply' })); }
    }
  }
  return null;
}

function rpPolicy(spec: GameSpec, g: GameState): string { return spec.policies[(g.pending?.player ?? 0) as 0 | 1]; }

// ---------------------------------------------------------------- minimisation

function fillerFor(db: Db): CardId {
  const vanilla = Object.values(db).filter(c => c.type === 'Unit' && !c.text.trim() && !isToken(c) && !c.supertypes.includes('Champion') && (c.energy ?? 0) <= 3);
  vanilla.sort((a, b) => (a.energy ?? 0) - (b.energy ?? 0) || a.id.localeCompare(b.id));
  return (vanilla.find(c => c.domains.includes('Colorless' as never)) ?? vanilla[0]).id;
}

export function minimize(fr: GameResult, f: Failure, budgetMs = 60000): Repro {
  const t0 = Date.now();
  const sig = signature(f);
  const kind = f.kind;
  const probe = f.probe && f.action ? { action: f.action, expect: f.probe } : undefined;
  // the failing action is the last logged one unless the failure is a probe or a state check
  let actions = fr.actions.slice(0, probe ? f.step : f.step + 1);
  let spec: GameSpec = JSON.parse(JSON.stringify(fr.spec));
  const repro = (sp: GameSpec, acts: Action[]) => {
    if (Date.now() - t0 > budgetMs) return false;
    try { return checkRepro(sp, acts, probe, { lenient: true, want: sig, kind }) !== null; } catch { return false; }
  };
  const confirmed = ['nondeterminism', 'replay-throw', 'step-cap', 'long-game'].includes(kind) ? false : repro(spec, actions);
  if (confirmed) {
    // 1. ddmin over the action log (lenient replay drops actions that become invalid)
    let n = 2;
    while (actions.length >= 2 && Date.now() - t0 < budgetMs * 0.6) {
      const chunk = Math.ceil(actions.length / n);
      let reduced = false;
      for (let i = 0; i < n; i++) {
        const cand = [...actions.slice(0, i * chunk), ...actions.slice((i + 1) * chunk)];
        if (cand.length < actions.length && repro(spec, cand)) { actions = cand; n = Math.max(n - 1, 2); reduced = true; break; }
      }
      if (!reduced) { if (n >= actions.length) break; n = Math.min(actions.length, n * 2); }
    }
    // re-anchor: keep only the actions that are actually applied in the lenient replay (strict replay then works)
    actions = strictify(spec, actions);
    // 2. deck shrink: replace uninvolved cards with a vanilla filler
    const filler = fillerFor(loadDb());
    const keep = new Set<CardId>(f.cardIds ?? []);
    const tryDecks = (repl: Set<CardId>) => {
      const sp: GameSpec = JSON.parse(JSON.stringify(spec));
      sp.validateDecks = false;
      for (const dk of sp.decks) dk.main = dk.main.map(id => (repl.has(id) ? filler : id));
      return repro(sp, actions) ? sp : null;
    };
    let cands = [...new Set(spec.decks.flatMap(dk => dk.main))].filter(id => !keep.has(id) && id !== filler);
    const all = tryDecks(new Set(cands));
    if (all) { spec = all; }
    else {
      // greedy halves
      let parts = [cands];
      while (parts.length && Date.now() - t0 < budgetMs * 0.9) {
        const part = parts.shift()!;
        const sp = tryDecks(new Set(part));
        if (sp) { spec = sp; cands = cands.filter(c => !part.includes(c)); continue; }
        if (part.length > 1) parts.push(part.slice(0, part.length >> 1), part.slice(part.length >> 1));
      }
    }
    actions = strictify(spec, actions);
  }
  // decks were legal when generated; don't let later data/validator changes stop the repro from loading
  spec.validateDecks = false;
  const deckCards = spec.decks.reduce((s, dk) => s + new Set(dk.main).size, 0);
  return {
    hash: sigHash(sig), signature: sig, kind, message: f.message, stack: f.stack?.split('\n').slice(0, 12).join('\n'),
    cards: f.cards ?? [], cardIds: f.cardIds ?? [], spec, actions, probe,
    original: { seed: fr.spec.seed, steps: fr.steps, turn: f.turn, policies: fr.spec.policies },
    minimized: { actions: actions.length, deckCards, ms: Date.now() - t0 }, found: new Date().toISOString(),
  };
}

/** Drop the actions a lenient replay would skip, so a strict replay applies every remaining action. */
function strictify(spec: GameSpec, actions: Action[]): Action[] {
  let g = createGame(setupOf(spec));
  const out: Action[] = [];
  for (const a of actions) {
    if (g.winner !== null) break;
    if (validateAction(g, a) !== null) continue;
    out.push(a);
    try { g = applyAction(g, a).state; } catch { break; }
  }
  return out;
}

/** Does this repro still fail (strict replay first, lenient as fallback)? */
export function reproFails(rp: Repro): Failure | null {
  return checkRepro(rp.spec, rp.actions, rp.probe, { lenient: false, kind: rp.kind, want: rp.signature })
    ?? checkRepro(rp.spec, rp.actions, rp.probe, { lenient: true, kind: rp.kind, want: rp.signature });
}
/** Does this repro fail with ANY failure of the same kind (signature may drift as code moves)? */
export function reproFailsKind(rp: Repro): Failure | null {
  const f = checkRepro(rp.spec, rp.actions, rp.probe, { lenient: true, kind: rp.kind });
  return f && f.kind === rp.kind && normalize(f.message) === normalize(rp.message) ? f : null;
}

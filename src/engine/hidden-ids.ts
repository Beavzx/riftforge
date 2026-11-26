// HIDDEN-IDS (BASICS BX-5): opaque per-view aliases for objects hidden from the viewer.
//
// The engine's object ids ("o42") are stable for a card's whole life, so a client that saw a card public (played, in
// trash, revealed) could follow it by id into a hidden zone and know which hand card / facedown card / deck card it is.
// getView therefore never ships the internal id of an object hidden from the viewer. Instead each such object gets
//
//   alias = "h" + SHA-256(viewKey | viewer | id | epoch | zone instance | zone counter)  (first 14 hex digits)
//
//  - viewKey: per-game secret (GameSetup.viewSecret, else derived from the seed). It lives in state.ex on the host and is
//    never part of a view (the seed isn't either), so an alias reveals nothing about the card, its id or creation order.
//    It is not drawn from state.rng, so game logic and replays are unaffected.
//  - zone instance: "<zone>:<owner>" (hand, main deck, rune deck, set aside) or "facedown:<bf>:<controller>".
//  - zone counter (state.ex.hid, updated after every applyAction by trackHidden): bumped for a viewer whenever the set of
//    objects hidden from them in that zone instance gains a member (an object entered the zone, or an object there became
//    hidden again — a reveal / look / "see facedown" ended), when an event of the step named one of its members, or when
//    the members' relative order changed (shuffle). Bumping re-aliases every hidden member at once ("the owner mixes
//    their hand"): set difference can't tell the viewer which alias is the card that just went in, and so they can't
//    tell later which hand card was hidden facedown, recycled, discarded...
//  - aliases are stable while nothing enters the zone (cards leaving don't re-alias the rest), so consecutive views
//    keep the same ids for UI animations.
//
// Everything else in the view that names a hidden object (log refs, modifier sources, chain targets, ex bookkeeping,
// decision data) is history, not location: it is replaced by 'hidden' (keys naming one are dropped), so it can't link
// an alias to a public sighting. Hidden objects themselves keep only location fields (no epoch / timestamp / statuses).
// Zone arrays list aliases in alias order (no deck position, hand order or entry order), and the objects map lists
// hidden objects after the visible ones, also in alias order (no creation order).
import type { GameEvent, GameObject, GameState, ObjId, PlayerId } from './types.ts';
import { ruleApplies } from './rules.ts';

// ---------------------------------------------------------------- SHA-256 (pure, sync; small inputs)

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const W = new Uint32Array(64);

function utf8(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) { const d = s.charCodeAt(i + 1); if (d >= 0xdc00 && d < 0xe000) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; } }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

/** SHA-256 of a string (UTF-8), as lowercase hex. */
export function sha256hex(msg: string): string {
  const bytes = utf8(msg);
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const hi = Math.floor(bitLen / 0x100000000), lo = bitLen >>> 0;
  bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a, h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = (bytes[off + 4 * i] << 24) | (bytes[off + 4 * i + 1] << 16) | (bytes[off + 4 * i + 2] << 8) | bytes[off + 4 * i + 3];
    for (let i = 16; i < 64; i++) {
      const a = W[i - 15], b = W[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K256[i] + W[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

// ---------------------------------------------------------------- key, visibility, zone instances

/** The per-game view key (state.ex.viewKey; derived from the seed for states made without one). Host-only. */
export function viewKeyOf(g: GameState): string {
  return g.ex.viewKey ?? sha256hex(`riftforge-view-key|${g.seed}`);
}
/** createGame: the key for a new game. GameSetup.viewSecret (online hosts pass a random one) or a seed-derived default. */
export function makeViewKey(seed: number, secret?: string): string {
  return sha256hex(secret !== undefined ? `riftforge-view-secret|${secret}` : `riftforge-view-key|${seed}`);
}

/** Objects hidden from `viewer` in `g` — exactly what getView redacts. */
export function hiddenIdsFor(g: GameState, viewer: PlayerId): Set<ObjId> {
  const revealed = new Set(g.ex.revealed);
  // objects referenced by the viewer's own pending decision are visible to them (setup battlefields, predict, mulligan)
  if (g.pending && g.pending.player === viewer) {
    for (const o of g.pending.options ?? []) for (const id of o.objIds ?? []) revealed.add(id);
    if (g.pending.source) revealed.add(g.pending.source);
  }
  const over = g.winner !== null || g.phase === 'gameOver';
  const out = new Set<ObjId>();
  for (const id in g.objects) {
    const o = g.objects[id];
    let hidden = false;
    if (o.zone === 'mainDeck' || o.zone === 'runeDeck' || o.zone === 'setAside') hidden = true;
    else if (o.zone === 'hand') hidden = o.owner !== viewer;
    // CR 422.4 (RJ#10525): facedown cards are revealed to all players when the game ends
    else if (o.zone === 'facedown') hidden = o.controller !== viewer && !over && !ruleApplies(g, 'seeFacedown', viewer, id);
    if (hidden && !revealed.has(id)) out.add(id);
  }
  return out;
}

/** The hidden zone instance an object is in (aliases are scoped to it). */
export function zoneInstance(o: GameObject): string {
  return o.zone === 'facedown' ? `facedown:${o.battlefieldIndex ?? '-'}:${o.controller}` : `${o.zone}:${o.owner}`;
}

/** state.ex.hid: per viewer, per zone instance: [counter, members at the last checkpoint ("id.epoch" in zone order)]. */
export type HidRecord = Record<string, Record<string, [number, string]>>;

function membersInOrder(g: GameState, ids: ObjId[]): Map<string, ObjId[]> {
  const byZone = new Map<string, ObjId[]>();
  const add = (id: ObjId) => { const k = zoneInstance(g.objects[id]); let a = byZone.get(k); if (!a) byZone.set(k, a = []); a.push(id); };
  const set = new Set(ids);
  // zones with an order: the player arrays (top of deck first); everything else in object order
  for (const p of g.players) for (const arr of [p.hand, p.mainDeck, p.runeDeck]) for (const id of arr) if (set.delete(id)) add(id);
  for (const id of set) add(id);
  return byZone;
}

function eventObjs(events: GameEvent[]): Set<ObjId> {
  const out = new Set<ObjId>();
  const take = (x: unknown) => { if (typeof x === 'string') out.add(x); else if (Array.isArray(x)) for (const y of x) take(y); };
  for (const e of events) { take(e.obj); take(e.objs); take(e.units); take(e.target); take(e.targets); take(e.cards); }
  return out;
}

/**
 * Checkpoint after a step (game.ts applyAction / createGame): update state.ex.hid of `g` from the record of `prev`
 * (the state the players were last shown). `events` = the step's events.
 */
export function trackHidden(prev: GameState | null, g: GameState, events: GameEvent[]): void {
  const old: HidRecord = prev?.ex.hid ?? {};
  const rec: HidRecord = {};
  const touched = eventObjs(events);
  const masked = g.ex.cancelFor !== undefined && !!g.pending?.inStep && !!g.ex.unit;
  for (const p of g.players) {
    const v = p.id;
    const was = old[v] ?? {};
    // UI-CANCEL: while a play can still be cancelled, the others are shown the board from before it: nothing changed for them
    if (masked && g.ex.cancelFor !== v) { rec[v] = was; continue; }
    const now: Record<string, [number, string]> = {};
    for (const k in was) now[k] = [was[k][0], ''];        // keep the counters of zones that are empty now (never reuse an alias)
    for (const [k, ids] of membersInOrder(g, [...hiddenIdsFor(g, v)])) {
      const mem = ids.map(id => `${id}.${g.objects[id].epoch ?? 0}`);
      const prevRec = was[k];
      let bump = !prevRec;
      if (!bump) {
        const before = prevRec[1] ? prevRec[1].split(',') : [];
        const bset = new Set(before);
        bump = mem.some(m => !bset.has(m)) || ids.some(id => touched.has(id));
        if (!bump) {
          // relative order of the members that stayed (a shuffle / reorder re-aliases the zone)
          const nset = new Set(mem);
          const a = before.filter(m => nset.has(m));
          bump = a.some((m, i) => m !== mem[i]);
        }
      }
      now[k] = [(prevRec?.[0] ?? 0) + (bump ? 1 : 0), mem.join(',')];
    }
    rec[v] = now;
  }
  g.ex.hid = rec;
}

// ---------------------------------------------------------------- the view rewrite

const ID_TOKEN = /o\d+/g;
const ZONE_KEYS = new Set(['hand', 'mainDeck', 'runeDeck', 'trash', 'banishment', 'base', 'runesInPlay', 'championZone']);

const isWordChar = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;

/** Does `x` contain a hidden internal id as a whole token (not part of a longer word: "o58" in "x:o58#5", not in "o580")? */
function keyHasHidden(A: Map<ObjId, string>, x: string): boolean {
  if (A.has(x)) return true;
  if (!/o\d/.test(x)) return false;
  ID_TOKEN.lastIndex = 0;
  for (let m = ID_TOKEN.exec(x); m; m = ID_TOKEN.exec(x)) {
    if (A.has(m[0]) && !isWordChar(x.charCodeAt(m.index - 1)) && !isWordChar(x.charCodeAt(m.index + m[0].length))) { ID_TOKEN.lastIndex = 0; return true; }
  }
  return false;
}

/**
 * Scrubber for the hidden-id set `A` (internal id -> alias): strings equal to or embedding a hidden id get the token
 * replaced by 'hidden'; object keys equal to or embedding one are dropped. `scrub` works in place on private copies.
 */
export function scrubber(A: Map<ObjId, string>): { scrubStr: (x: string) => string; scrub: (x: unknown) => unknown } {
  const scrubStr = (x: string): string => {
    if (A.has(x)) return 'hidden';
    if (!/o\d/.test(x)) return x;
    return x.replace(ID_TOKEN, (m, at: number) => (A.has(m) && !isWordChar(x.charCodeAt(at - 1)) && !isWordChar(x.charCodeAt(at + m.length)) ? 'hidden' : m));
  };
  const scrub = (x: unknown, depth = 0): unknown => {
    if (typeof x === 'string') return scrubStr(x);
    if (!x || typeof x !== 'object') return x;
    if (depth > 200) return null;              // never ship what we did not scrub (view states are shallow JSON trees)
    if (Array.isArray(x)) { for (let i = 0; i < x.length; i++) x[i] = scrub(x[i], depth + 1); return x; }
    const r = x as Record<string, unknown>;
    for (const k of Object.keys(r)) {
      if (keyHasHidden(A, k)) { delete r[k]; continue; }
      r[k] = scrub(r[k], depth + 1);
    }
    return r;
  };
  return { scrubStr, scrub: (x: unknown) => scrub(x) };
}

/**
 * Rewrite a redacted view state `s` (a private copy made by getView from `state`) for `viewer`: hidden objects get
 * aliases, every other mention of them is neutralised. `hidden` = hiddenIdsFor(state, viewer).
 */
export function aliasView(state: GameState, s: GameState, viewer: PlayerId, hidden: Set<ObjId>): Map<ObjId, string> {
  const key = viewKeyOf(state);
  const counters = state.ex.hid?.[viewer] ?? {};
  const A = new Map<ObjId, string>();
  for (const id of hidden) {
    const o = state.objects[id];
    if (!o) continue;
    const zk = zoneInstance(o);
    A.set(id, 'h' + sha256hex(`${key}|${viewer}|${id}|${o.epoch ?? 0}|${zk}|${counters[zk]?.[0] ?? 0}`).slice(0, 14));
  }
  // engine-internal secrets and bookkeeping never leave the host
  delete s.ex.viewKey; delete s.ex.hid;
  s.ex.memo = {};
  s.ex.lastEvents = [];
  s.seed = 0;
  if (!A.size) return A;
  const isHid = (x: string) => A.has(x);
  const { scrubStr, scrub } = scrubber(A);
  // objects: visible ones (original order, contents scrubbed), then hidden ones as bare location records in alias order
  const objects: Record<ObjId, GameObject> = {};
  for (const id in s.objects) if (!A.has(id)) objects[id] = scrub(s.objects[id]) as GameObject;
  for (const [id, al] of [...A].sort((a, b) => (a[1] < b[1] ? -1 : 1))) {
    const o = state.objects[id];
    const fd = o.zone === 'facedown';
    objects[al] = {
      id: al, cardId: 'hidden', owner: o.owner, controller: o.controller, zone: o.zone,
      exhausted: fd ? o.exhausted : false, faceDown: o.faceDown, damage: 0, counters: {}, modifiers: [],
      enteredThisTurn: fd ? o.enteredThisTurn : false, timestamp: 0,
      ...(fd ? { battlefieldIndex: o.battlefieldIndex, ...(o.hiddenTurn !== undefined ? { hiddenTurn: o.hiddenTurn } : {}) } : {}),
    };
  }
  s.objects = objects;
  // zone arrays: visible members keep their order, hidden ones follow as aliases in alias order
  const zone = (arr: ObjId[]): ObjId[] => {
    if (!arr.some(isHid)) return arr;
    return [...arr.filter(id => !A.has(id)), ...arr.filter(isHid).map(id => A.get(id)!).sort()];
  };
  for (const p of s.players) {
    p.hand = zone(p.hand); p.mainDeck = zone(p.mainDeck); p.runeDeck = zone(p.runeDeck);
    p.trash = zone(p.trash); p.banishment = zone(p.banishment); p.base = zone(p.base); p.runesInPlay = zone(p.runesInPlay); p.championZone = zone(p.championZone);
    const pr = p as unknown as Record<string, unknown>;
    for (const k of Object.keys(pr)) if (!ZONE_KEYS.has(k)) pr[k] = scrub(pr[k]);
  }
  if (s.ex.setAsideBattlefields) s.ex.setAsideBattlefields = s.ex.setAsideBattlefields.map(zone);
  if (s.ex.extraLegends) s.ex.extraLegends = s.ex.extraLegends.map(zone);
  // final pass over everything else (history / bookkeeping) and again over objects and players: any key or value anywhere
  // that is or embeds a hidden internal id ("o58", "a:o64", "B4:mv:mfCaptain:o58#5") is dropped / replaced by 'hidden'.
  // Idempotent on what is already redacted (aliases are not engine ids). Not `cards` (definitions only), not `log`
  // (entries are shared with the real state; handled below), not ex.unit (null in views).
  for (const k of Object.keys(s)) {
    if (k === 'cards' || k === 'log') continue;
    if (k === 'ex') {
      const ex = s.ex as unknown as Record<string, unknown>;
      for (const ek of Object.keys(ex)) { if (ek === 'unit') continue; if (keyHasHidden(A, ek)) delete ex[ek]; else ex[ek] = scrub(ex[ek]); }
      continue;
    }
    (s as Record<string, unknown>)[k] = scrub((s as Record<string, unknown>)[k]);
  }
  // log entries are shared with the real state: copy the ones that need changes
  s.log = s.log.map(e => {
    const ref = e.ref?.some(isHid) ? e.ref.filter(id => !A.has(id)) : e.ref;
    const text = scrubStr(e.text);
    return ref === e.ref && text === e.text ? e : { ...e, text, ...(ref ? { ref } : {}) };
  });
  return A;
}

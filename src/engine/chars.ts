// Characteristics with the layer system (CR 473-480):
//  copy layer -> layer 1 traits (set Might, tags, type) -> layer 2 abilities/keywords -> layer 3 arithmetic.
// Within a layer, effects apply in timestamp order; within arithmetic, increases before decreases (477.3.e).
import type { CardDef, CardType, Domain, GameState, ObjId, PlayerId, Modifier } from './types.ts';
import type { Ability, AbilityRef, StaticAbility, StaticMods, CostSpec } from './abilities.ts';
import { getScript, getGrant, getDelayed } from '../cards/registry.ts';
import { parseKeywords, splitKeyword, SUMMING, keywordCostFromText, parseCost } from './keywords.ts';
import { makeCtx } from './context.ts';

export interface Chars {
  name: string;
  type: CardType;
  supertypes: string[];
  tags: string[];
  domains: Domain[];
  energy: number | null;
  power: number | null;
  might: number | null;          // current Might (may be negative; use mightForCombat for sums)
  keywords: Map<string, number>; // keyword -> value (summed for SUMMING keywords, count otherwise)
  controller: PlayerId;
  cantBeChosenByEnemy: boolean;
  grants: string[];
  copyOf: string | null;
  /** abilities copied/granted by reference (StaticMods.grantRefs / copyAbilitiesOf) */
  extraRefs: { cardId: string; index?: number }[];
  /** every contribution to the current Might (UI tooltip): printed/set base first, then layer-3 changes */
  mightSources?: MightSource[];
}
export interface MightSource { source: ObjId | null; label: string; amount: number; duration: string }

const BOARD_ZONES = new Set(['base', 'battlefield', 'facedown', 'runePool']);
/** Controller of an object's abilities: battlefields -> their controller, or the turn player if uncontrolled (CR 190.6). */
export function abilityController(g: GameState, id: ObjId): PlayerId {
  const b = g.battlefields.find(x => x.objId === id);
  if (b) return b.controller ?? g.activePlayer;
  return g.objects[id]?.controller ?? g.activePlayer;
}

export function onBoard(g: GameState, id: ObjId): boolean {
  const o = g.objects[id];
  return !!o && (o.zone === 'base' || o.zone === 'battlefield');
}
export function inBoardZone(zone: string): boolean { return BOARD_ZONES.has(zone); }

const kwCache = new Map<string, string[]>();
export function intrinsicKeywords(def: CardDef): string[] {
  const s = getScript(def.id);
  if (s?.keywords) return s.keywords;
  // data/cards.json `keywords` = intrinsic keywords (from card-analysis); hand-made defs may leave it empty
  if (def.keywords && def.keywords.length) return def.keywords;
  const key = def.id + '\u0001' + def.text;
  let k = kwCache.get(key);
  if (!k) { k = parseKeywords(def); kwCache.set(key, k); }
  return k;
}

export function baseDef(g: GameState, id: ObjId): CardDef {
  const o = g.objects[id];
  const d = g.cards[o.cardId];
  if (!d) throw new Error(`missing card def ${o.cardId}`);
  return d;
}

/** Card def whose copyable traits/rules text the object currently has (copy layer). */
export function effectiveDef(g: GameState, id: ObjId): CardDef {
  const o = g.objects[id];
  let copy: Modifier | undefined;
  for (const m of o.modifiers) if (m.copyOf && (!copy || m.timestamp > copy.timestamp)) copy = m;
  if (copy && g.cards[copy.copyOf!]) return g.cards[copy.copyOf!];
  return baseDef(g, id);
}

// ---------- static abilities on the board ----------

/** abSrc (SF-2): the object the static is printed on, when it differs from src (Equipment effect text) */
interface ActiveStatic { src: ObjId; ab: StaticAbility; ts: number; host?: ObjId; delayed?: import('./types.ts').DelayedAbility; abSrc?: ObjId }

let computing = new Set<ObjId>();
let evaluating = new Set<StaticAbility>();
let staticDepth = 0;

/** Objects whose abilities are "active" (CR 365/384): board permanents, legends, battlefields. */
const srcCache = new WeakMap<GameState, { ts: number; n: number; list: ObjId[] }>();
export function abilitySources(g: GameState): ObjId[] {
  const c = srcCache.get(g);
  if (c && c.ts === g.timestamp && c.n === g.nextObj) return c.list;
  const out: ObjId[] = [];
  for (const id in g.objects) {
    const o = g.objects[id];
    if (o.zone === 'base' || o.zone === 'battlefield' || o.zone === 'legendZone') out.push(id);
  }
  srcCache.set(g, { ts: g.timestamp, n: g.nextObj, list: out });
  return out;
}

function dependenciesMet(g: GameState, src: ObjId, ab: Ability): boolean {
  if (!ab.requires || ab.requires.length === 0) return true;
  const o = g.objects[src];
  for (const r of ab.requires) {
    switch (r.kind) {
      case 'legion': {
        const played = (g.ex.playedThisTurn[o.controller] ?? []);
        if (!played.some(x => x !== src && !g.objects[x]?.isToken)) return false;
        break;
      }
      case 'level': if ((g.players[o.controller].xp ?? 0) < r.n) return false; break;
      case 'empowered': if ((o.empowered ?? 0) < (r.n ?? 1)) return false; break;
      case 'mighty': { const m = might(g, src); if (m === null || m < 5) return false; break; }
      case 'custom': if (!r.test(makeCtx(g, src, o.controller))) return false; break;
    }
  }
  return true;
}
export { dependenciesMet };

/** Does this object possibly carry static abilities (script statics or granted abilities)? */
function mayHaveStatics(g: GameState, id: ObjId): boolean {
  const o = g.objects[id];
  if (o.modifiers.length && o.modifiers.some(m => m.grants?.length || m.copyOf)) return true;
  const s = getScript(o.cardId);
  return !!s && scriptStatics(s).length > 0;
}
// MS-2: the static abilities of a script (by index), computed once per script
const staticIdx = new WeakMap<object, { index: number; ab: StaticAbility }[]>();
function scriptStatics(s: { abilities: Ability[] }): { index: number; ab: StaticAbility }[] {
  let l = staticIdx.get(s);
  if (!l) { l = []; s.abilities.forEach((ab, index) => { if (ab.kind === 'static') l!.push({ index, ab }); }); staticIdx.set(s, l); }
  return l;
}

function collectStatics(g: GameState): ActiveStatic[] {
  if (memo && memoOwner === g && !computing.size && !evaluating.size) return staticsMemo ??= collectStaticsNow(g);
  return collectStaticsNow(g);
}
let expandingRefs = false;
function collectStaticsNow(g: GameState): ActiveStatic[] {
  const out = collectBaseStatics(g);
  // B2-10: statics granted by reference (Svellsongur copying the equipped unit's text): one level, no recursion
  if (expandingRefs || !out.some(s => s.ab.refs)) return out;
  expandingRefs = true;
  try {
    const targets = new Set<ObjId>();
    for (const s of out) if (s.ab.refs) { if (s.ab.affects === 'self' || s.ab.affects === 'host') targets.add(s.src); else for (const id of abilitySources(g)) targets.add(id); }
    for (const id of targets) {
      const o = g.objects[id];
      if (!o || !(o.zone === 'base' || o.zone === 'battlefield' || o.zone === 'legendZone')) continue;
      for (const ref of grantsOf(g, id).extraRefs) {
        const s = getScript(ref.cardId);
        const list = ref.index !== undefined ? [s?.abilities[ref.index]] : (s?.abilities ?? []);
        for (const ab of list) {
          if (ab?.kind !== 'static' || (ab.section ?? 'rules') !== 'rules' || !dependenciesMet(g, id, ab)) continue;
          if (ab.idempotent && out.some(x => x.src === id && x.ab === ab)) continue;
          out.push({ src: id, ab, ts: o.timestamp });
        }
      }
    }
  } finally { expandingRefs = false; }
  return out;
}
function collectBaseStatics(g: GameState): ActiveStatic[] {
  const out: ActiveStatic[] = [];
  // B6-2: delayed static abilities ("this turn, buffs give an additional +1")
  for (const d of g.ex.delayed) {
    const ab = getDelayed(d.key);
    if (ab?.kind === 'static') out.push({ src: d.source ?? '', ab, ts: d.timestamp ?? 0, delayed: d });
  }
  for (const src of abilitySources(g)) {
    const o = g.objects[src];
    const hasGrants = o.modifiers.length > 0 && o.modifiers.some(m => m.grants?.length || m.copyOf);
    if (!hasGrants) {
      // fast path (same result as activeAbilities filtered to statics): only the script's static abilities
      const s = getScript(o.cardId);
      if (!s) continue;
      const st = scriptStatics(s);
      if (!st.length) continue;
      const attached = !!o.attachedTo;
      for (const { ab } of st) {
        const section = ab.section ?? 'rules';
        if (attached ? section === 'rules' : section === 'effect') continue;
        if (!dependenciesMet(g, src, ab)) continue;
        if (section === 'effect') out.push({ src: o.attachedTo ?? src, ab, ts: o.timestamp, host: o.attachedTo, abSrc: src });
        else out.push({ src, ab, ts: o.timestamp, host: undefined });
      }
      continue;
    }
    const refs = activeAbilities(g, src, true);
    for (const r of refs) if (r.ability.kind === 'static') out.push({ src: r.viaHost ?? src, ab: r.ability, ts: g.objects[r.obj].timestamp, host: r.viaHost, ...(r.viaHost ? { abSrc: r.obj } : {}) });
  }
  return out;
}

function staticApplies(g: GameState, s: ActiveStatic, target: ObjId): StaticMods | null {
  const ctrl = s.delayed ? s.delayed.controller : abilityController(g, s.src);
  const ctx = makeCtx(g, s.src, ctrl, s.delayed ? { data: s.delayed.data } : {});
  if (s.abSrc) ctx.abilitySource = s.abSrc;
  if (s.ab.affects === 'self' || s.ab.affects === 'host') { if (target !== s.src) return null; }
  else if (!onBoard(g, target) && g.objects[target].zone !== 'legendZone') return null;
  else if (!s.ab.affects(ctx, target)) return null;
  if (s.ab.condition && !s.ab.condition(ctx)) return null;
  return typeof s.ab.mods === 'function' ? s.ab.mods(ctx, target) : s.ab.mods;
}

// ---------- main computation ----------

// Read-only memo: enabled while enumerating legal actions (no mutations happen then).
let memo: Map<ObjId, Chars> | null = null;
let memoOwner: GameState | null = null;
let staticsMemo: ActiveStatic[] | null = null;
let grantsMemo: Map<ObjId, Pick<Chars, 'grants' | 'extraRefs'>> | null = null;
let scopeMemo: Map<string, unknown> | null = null;
export function withCharsMemo<T>(g: GameState, f: () => T): T {
  if (memo && memoOwner === g) return f();        // already inside a read-only scope of this state
  const prev = memo, prevOwner = memoOwner, prevStatics = staticsMemo, prevGrants = grantsMemo, prevScope = scopeMemo;
  memo = new Map(); memoOwner = g; staticsMemo = null; grantsMemo = new Map(); scopeMemo = new Map();
  try { return f(); } finally { memo = prev; memoOwner = prevOwner; staticsMemo = prevStatics; grantsMemo = prevGrants; scopeMemo = prevScope; }
}

/** PERF: memoise a pure read of `g` for the rest of the current read-only scope (withCharsMemo), under the same
 *  conditions as the chars memo (no characteristic computation or static evaluation in progress, whose recursion
 *  guards can change results). Outside such a scope, or for another state, f() simply runs. `key` must identify
 *  every input besides g. Callers must not mutate the returned value (copy arrays before handing them out). */
export function memoInScope<T>(g: GameState, key: string, f: () => T): T {
  if (!memo || memoOwner !== g || computing.size || evaluating.size) return f();
  if (scopeMemo!.has(key)) return scopeMemo!.get(key) as T;
  const v = f();
  if (!computing.size && !evaluating.size) scopeMemo!.set(key, v);
  return v;
}

export function chars(g: GameState, id: ObjId): Chars {
  if (memo && memoOwner === g) {
    const hit = memo.get(id);
    if (hit) return hit;
    const c = computeChars(g, id);
    if (!computing.size && !evaluating.size) memo.set(id, c);
    return c;
  }
  return computeChars(g, id);
}

function computeChars(g: GameState, id: ObjId): Chars {
  const o = g.objects[id];
  const d = effectiveDef(g, id);
  const printed = baseDef(g, id);
  const c: Chars = {
    name: d.name,
    type: d.type,
    supertypes: [...d.supertypes],
    tags: [...d.tags],
    domains: [...d.domains],
    energy: d.energy,
    power: d.power,
    might: o.isToken && o.counters.tokenMight !== undefined ? o.counters.tokenMight : (d.id !== printed.id && d.might !== null ? d.might : (printed.might ?? null)),
    keywords: new Map(),
    controller: o.controller,
    cantBeChosenByEnemy: false,
    grants: [],
    copyOf: d.id !== printed.id ? d.id : null,
    extraRefs: [],
  };
  if (c.type === 'Token' && c.might !== null) c.type = 'Unit';

  // B4-8: while a static ability is being evaluated, nested characteristic queries skip only that static
  const recursing = staticDepth > 5;
  let statics: { s: ActiveStatic; m: StaticMods }[] = [];
  if (!recursing && (o.zone === 'base' || o.zone === 'battlefield' || o.zone === 'legendZone')) {
    computing.add(id);
    staticDepth++;
    try {
      for (const s of collectStatics(g)) {
        if (evaluating.has(s.ab)) continue;
        evaluating.add(s.ab);
        let m: StaticMods | null;
        try { m = staticApplies(g, s, id); } finally { evaluating.delete(s.ab); }
        if (m) statics.push({ s, m });
      }
    } finally {
      staticDepth--;
      computing.delete(id);
    }
  }
  const mods = [...o.modifiers].sort((a, b) => a.timestamp - b.timestamp);
  statics = statics.sort((a, b) => a.s.ts - b.s.ts);

  // Layer 1: traits
  type L1 = { ts: number; setMight?: number; tags?: string[]; type?: CardType };
  const l1: L1[] = [];
  for (const m of mods) if (m.setMight !== undefined || m.addTags || m.becomeType) l1.push({ ts: m.timestamp, setMight: m.setMight, tags: m.addTags, type: m.becomeType });
  for (const { s, m } of statics) if (m.setMight !== undefined || m.tags || m.type) l1.push({ ts: s.ts, setMight: m.setMight, tags: m.tags, type: m.type });
  l1.sort((a, b) => a.ts - b.ts);
  for (const e of l1) {
    if (e.type) { c.type = e.type; if (e.type === 'Unit' && c.might === null) c.might = 0; }
    if (e.tags) for (const t of e.tags) if (!c.tags.includes(t)) c.tags.push(t);
    if (e.setMight !== undefined) c.might = e.setMight;
  }
  if (o.counters.unitGearMight !== undefined && c.type === 'Gear') { c.type = 'Unit'; c.might = o.counters.unitGearMight; }

  // Layer 2: abilities / keywords
  const attachedGear = !!o.attachedTo;
  const kwList: string[] = attachedGear ? [] : [...intrinsicKeywords(d)];
  const removed = new Set<string>();
  const addKw = (k: string) => kwList.push(k);
  for (const m of mods) {
    if (m.addKeywords) m.addKeywords.forEach(addKw);
    if (m.removeKeywords) m.removeKeywords.forEach(k => removed.add(k));
    if (m.cantBeChosenByEnemy) c.cantBeChosenByEnemy = true;
    if (m.grants) c.grants.push(...m.grants);
  }
  let floor: number | null = null;
  for (const { m } of statics) {
    if (m.keywords) m.keywords.forEach(addKw);
    if (m.removeKeywords) m.removeKeywords.forEach(k => removed.add(k));
    if (m.cantBeChosenByEnemy) c.cantBeChosenByEnemy = true;
    if (m.grants) c.grants.push(...m.grants);
    if (m.grantRefs) c.extraRefs.push(...m.grantRefs);
    if (m.copyAbilitiesOf) { const src = g.objects[m.copyAbilitiesOf]; const cid = src ? (effectiveDef(g, m.copyAbilitiesOf).id) : m.copyAbilitiesOf; c.extraRefs.push({ cardId: cid }); for (const k of src ? intrinsicKeywords(effectiveDef(g, m.copyAbilitiesOf)) : []) addKw(k); }
    if (m.mightFloor !== undefined) floor = Math.max(floor ?? -Infinity, m.mightFloor);
  }
  // effect text of attached gear is appended to the host (CR 434.1.c)
  for (const gid of attachedTo(g, id)) {
    const gs = getScript(g.objects[gid].cardId);
    if (gs?.keywords) for (const k of gs.keywords) if (k.startsWith('host:')) addKw(k.slice(5));
  }
  // keywords granted to a card while it is being played / in a non-board zone (play rules)
  if (!(o.zone === 'base' || o.zone === 'battlefield' || o.zone === 'legendZone') && !recursing) {
    staticDepth++;
    try { const pg = playGrants(g, id); kwList.push(...pg.keywords); if (Object.keys(pg.costs).length) for (const k of Object.keys(pg.costs)) if (!kwList.some(x => splitKeyword(x)[0] === k)) kwList.push(k); } finally { staticDepth--; }
  }
  for (const m of o.modifiers) for (const k of Object.keys(m.addKeywordCosts ?? {})) if (!kwList.some(x => splitKeyword(x)[0] === k)) kwList.push(k);
  for (const k of kwList) {
    const [name, v] = splitKeyword(k);
    if (removed.has(name)) continue;
    const prev = c.keywords.get(name) ?? 0;
    c.keywords.set(name, SUMMING.has(name) ? prev + v : Math.max(prev, v) || 1);
  }

  // Layer 3: arithmetic (increases first, then decreases)
  if (c.might !== null) {
    const deltas: number[] = [];
    const srcs: MightSource[] = [{ source: null, label: 'Base Might', amount: c.might, duration: 'permanent' }];
    const nameOf = (x: ObjId | null | undefined) => (x && g.objects[x] ? (g.cards[g.objects[x].cardId]?.name ?? x) : 'an effect');
    const add = (amount: number, source: ObjId | null, label: string, duration: string) => { deltas.push(amount); srcs.push({ source, label, amount, duration }); };
    for (const m of mods) if (m.might) add(m.might, m.source, nameOf(m.source), m.duration);
    // passive "-N, to a minimum of F" (Leona, Zealot; mightFloor): applied last, together, limited over their total (CR 479.4.e
    // passive limits, decreases last — RJ#1292, RJ#5249; ENGINE-9)
    const floored: { amount: number; source: ObjId | null; label: string }[] = [];
    for (const { s, m } of statics) {
      if (!m.might) continue;
      if (m.mightFloor !== undefined && m.might < 0) floored.push({ amount: m.might, source: s.host ?? s.src, label: `${nameOf(s.host ?? s.src)} (static)` });
      else add(m.might, s.host ?? s.src, `${nameOf(s.host ?? s.src)} (static)`, 'static');
    }
    if (o.counters.buff) add(o.counters.buff, null, o.counters.buff > 1 ? `Buffs (${o.counters.buff})` : 'Buff', 'permanent');
    for (const gid of attachedTo(g, id)) {
      const bonus = g.cards[g.objects[gid].cardId]?.might;
      if (bonus) add(bonus, gid, `${nameOf(gid)} (equipment)`, 'whileAttached');
    }
    if (o.combatRole === 'attacker' && c.keywords.has('Assault')) add(c.keywords.get('Assault')!, null, `Assault ${c.keywords.get('Assault')} (attacking)`, 'endOfCombat');
    if (o.combatRole === 'defender' && c.keywords.has('Shield')) add(c.keywords.get('Shield')!, null, `Shield ${c.keywords.get('Shield')} (defending)`, 'endOfCombat');
    if (o.empowered && o.counters.mightPerEmpower) add(o.empowered * o.counters.mightPerEmpower, null, 'Empowered', 'permanent');
    let m = c.might;
    for (const x of deltas) if (x > 0) m += x;
    for (const x of deltas) if (x < 0) m += x;
    if (floored.length && floor !== null) {
      const before = m;
      for (const f of floored) { m += f.amount; srcs.push({ source: f.source, label: f.label, amount: f.amount, duration: 'static' }); }
      const lim = Math.min(before, floor);          // never below the minimum, never raised by it
      if (m < lim) { srcs.push({ source: null, label: `Minimum ${floor}`, amount: lim - m, duration: 'static' }); m = lim; }
    }
    c.might = m;
    c.mightSources = srcs;
  }
  return c;
}

// MS-2: reverse index host -> attached objects. Every engine attach/detach/zone change bumps g.timestamp and changes
// attachCount, so (timestamp, attachCount, nextObj) identifies the attachment layout of one state object.
const attachIdx = new WeakMap<GameState, { ts: number; n: number; next: number; map: Map<ObjId, ObjId[]> }>();
const NO_ATTACH: ObjId[] = [];
export function attachedTo(g: GameState, host: ObjId): ObjId[] {
  if (!g.ex.attachCount) return [];
  let c = attachIdx.get(g);
  if (!c || c.ts !== g.timestamp || c.n !== g.ex.attachCount || c.next !== g.nextObj) {
    const map = new Map<ObjId, ObjId[]>();
    for (const id in g.objects) {
      const h = g.objects[id].attachedTo;
      if (h) { const l = map.get(h); if (l) l.push(id); else map.set(h, [id]); }
    }
    c = { ts: g.timestamp, n: g.ex.attachCount, next: g.nextObj, map };
    attachIdx.set(g, c);
  }
  const l = c.map.get(host);
  return l ? [...l] : NO_ATTACH.slice();
}

export function might(g: GameState, id: ObjId): number | null {
  return chars(g, id).might;
}
/** Might used for references and combat sums: negative counts as 0 (CR 143.2) */
export function mightOr0(g: GameState, id: ObjId): number {
  const m = might(g, id);
  return m === null ? 0 : Math.max(0, m);
}
export function hasKw(g: GameState, id: ObjId, kw: string): boolean {
  return chars(g, id).keywords.has(kw);
}
export function kwVal(g: GameState, id: ObjId, kw: string): number {
  return chars(g, id).keywords.get(kw) ?? 0;
}
export function isUnit(g: GameState, id: ObjId): boolean {
  const o = g.objects[id];
  if (!o) return false;
  // fast path: printed type unless something changes types
  if (o.counters.unitGearMight === undefined && !o.modifiers.some(m => m.becomeType || m.copyOf) && !g.ex.typeStatics) {
    const d = g.cards[o.cardId];
    if (d) return d.type === 'Unit' || (d.type === 'Token' && d.might !== null) || !!d.additionalTypes?.includes('Unit');
  }
  return chars(g, id).type === 'Unit' || !!effectiveDef(g, id).additionalTypes?.includes('Unit');
}
export function isGear(g: GameState, id: ObjId): boolean {
  const o = g.objects[id];
  if (!o) return false;
  const c = chars(g, id);
  // SF-1: a card with several types (Patched Porobot: Unit + additionalTypes Gear) is each of them
  return c.type === 'Gear' || (o.counters.unitGearMight !== undefined) || (baseDef(g, id).type === 'Gear') || !!effectiveDef(g, id).additionalTypes?.includes('Gear');
}
export function isEquipment(g: GameState, id: ObjId): boolean {
  return isGear(g, id) && (chars(g, id).tags.includes('Equipment') || !!keywordCost(g, id, 'Equip'));
}
export function isPermanent(g: GameState, id: ObjId): boolean {
  const t = chars(g, id).type;
  return t === 'Unit' || t === 'Gear';
}

/**
 * B3-3 / B8-16 / B7-5: keywords (and keyword costs) a card has while it is being played or sits in a non-board zone,
 * granted by play rules (incl. delayed ones) and by modifiers with addKeywordCosts.
 */
export function playGrants(g: GameState, id: ObjId): { keywords: string[]; costs: Record<string, CostSpec>; delayedIds: string[] } {
  const out = { keywords: [] as string[], costs: {} as Record<string, CostSpec>, delayedIds: [] as string[] };
  const o = g.objects[id];
  if (!o) return out;
  const owner = o.controller;
  const consider = (src: ObjId | null, ab: Ability, controller: PlayerId, data?: Record<string, unknown>, delayedId?: string) => {
    if (ab.kind !== 'playRule' || (!ab.grantKeywords && !ab.keywordCosts)) return;
    if (!ab.anyPlayer && controller !== owner) return;
    const ctx = makeCtx(g, src ?? id, controller, { data });
    if (!ab.applies(ctx, id)) return;
    let any = false;
    for (const k of ab.grantKeywords?.(ctx, id) ?? []) { out.keywords.push(k); any = true; }
    for (const [k, v] of Object.entries(ab.keywordCosts ?? {})) { if (v) { out.costs[k] = typeof v === 'function' ? v(ctx, id) : v; any = true; } }
    if (any && delayedId) out.delayedIds.push(delayedId);
  };
  for (const src of abilitySources(g)) {
    const so = g.objects[src];
    if (!getScript(so.cardId) && !so.modifiers.some(m => m.grants?.length)) continue;
    for (const r of activeAbilities(g, src)) consider(r.viaHost ?? src, r.ability, abilityController(g, r.viaHost ?? src));
  }
  for (const d of g.ex.delayed) { const ab = getDelayed(d.key); if (ab) consider(d.source, ab, d.controller, d.data, d.id); }
  for (const m of o.modifiers) for (const [k, v] of Object.entries(m.addKeywordCosts ?? {})) out.costs[k] = { energy: v.energy ?? 0, power: (v.power ?? []) as CostSpec['power'] };
  return out;
}

/** All costs of a keyword ability (Repeat may have several, B5-5). */
export function keywordCosts(g: GameState, id: ObjId, kw: 'Equip' | 'Repeat' | 'Flow' | 'Empower'): CostSpec[] {
  const d = effectiveDef(g, id);
  const s = getScript(d.id);
  const sc = s?.costs?.[kw];
  if (Array.isArray(sc)) return sc;
  const one = keywordCost(g, id, kw);
  return one ? [one] : [];
}

/** Cost of a keyword ability (Equip/Repeat/Flow/Empower) from the script or the text. */
export function keywordCost(g: GameState, id: ObjId, kw: 'Equip' | 'Repeat' | 'Flow' | 'Empower'): CostSpec | null {
  const d = effectiveDef(g, id);
  const s = getScript(d.id);
  const sc = s?.costs?.[kw];
  if (sc) return Array.isArray(sc) ? sc[0] ?? null : sc;
  const o = g.objects[id];
  if (o && !(o.zone === 'base' || o.zone === 'battlefield')) { const pg = playGrants(g, id).costs[kw]; if (pg) return pg; }
  else if (o) { for (const m of o.modifiers) { const v = m.addKeywordCosts?.[kw]; if (v) return { energy: v.energy ?? 0, power: (v.power ?? []) as CostSpec['power'] }; } }
  const kc = (d as CardDef & { keywordCosts?: Record<string, string> }).keywordCosts?.[kw];
  if (kc !== undefined) { const c = parseCost(kc); if (c) return c; }
  return keywordCostFromText(d, kw);
}

/**
 * All abilities currently active on an object, including granted abilities and effect text
 * of attached gear (reported with viaHost = host). Inactive dependent abilities are excluded
 * unless includeInactive.
 */
export function activeAbilities(g: GameState, id: ObjId, forStatics = false, includeInactive = false): AbilityRef[] {
  const o = g.objects[id];
  if (!o) return [];
  const out: AbilityRef[] = [];
  const d = effectiveDef(g, id);
  const script = getScript(d.id);
  const attached = !!o.attachedTo;
  if (script) {
    script.abilities.forEach((ab, index) => {
      const section = ab.section ?? 'rules';
      if (attached && section === 'rules') return;        // CR 434.1.e
      if (!attached && section === 'effect') return;       // effect text inactive unless attached (720)
      if (!includeInactive && !dependenciesMet(g, id, ab)) return;
      if (section === 'effect') out.push({ obj: id, index, ability: ab, viaHost: o.attachedTo });
      else out.push({ obj: id, index, ability: ab });
    });
  }
  if (!forStatics || true) {
    // granted abilities (modifiers on the object). Statics granting abilities are read via chars() lazily
    let gi = 1000;
    for (const m of o.modifiers) for (const k of m.grants ?? []) {
      const ab = getGrant(k);
      if (ab && (includeInactive || dependenciesMet(g, id, ab))) out.push({ obj: id, index: gi, ability: ab, granted: true });
      gi++;
    }
  }
  return out;
}

const mayGrant = (ab: StaticAbility) => typeof ab.mods === 'function' || !!ab.mods.grants || !!ab.mods.grantRefs || !!ab.mods.copyAbilitiesOf;

// PERF: does any static that collectStatics() could return possibly grant abilities (grants / grantRefs /
// copyAbilitiesOf), or expand references? A superset test that never evaluates a static: collectStatics() only reads
// delayed statics, the script statics of ability sources, and (for sources with grant/copy modifiers) their
// active abilities; `refs` statics add more by reference. If this is false, every static's mods lack grants, so
// grantsOf() is exactly the object's modifier grants and no extraRefs.
const grantingIdx = new WeakMap<object, boolean>();
function scriptMayGrant(s: { abilities: Ability[] }): boolean {
  let v = grantingIdx.get(s);
  if (v === undefined) { v = scriptStatics(s).some(({ ab }) => mayGrant(ab) || !!ab.refs); grantingIdx.set(s, v); }
  return v;
}
export function mayHaveGrantedAbilities(g: GameState): boolean {
  for (const d of g.ex.delayed) { const ab = getDelayed(d.key); if (ab?.kind === 'static' && (mayGrant(ab) || ab.refs)) return true; }
  for (const src of abilitySources(g)) {
    const o = g.objects[src];
    if (o.modifiers.length && o.modifiers.some(m => m.grants?.length || m.copyOf)) return true;
    const s = getScript(o.cardId);
    if (s && scriptMayGrant(s)) return true;
  }
  return false;
}
/**
 * MS-2: the ability-granting part of chars() (modifier grants, then static grants / grantRefs / copyAbilitiesOf in timestamp
 * order — the same lists and order computeChars builds), without evaluating the other statics or the layers.
 */
function grantsOf(g: GameState, id: ObjId): Pick<Chars, 'grants' | 'extraRefs'> {
  const memoOk = !!memo && memoOwner === g;
  if (memoOk) { const hit = memo!.get(id) ?? grantsMemo!.get(id); if (hit) return hit; }
  const o = g.objects[id];
  const out: Pick<Chars, 'grants' | 'extraRefs'> = { grants: [], extraRefs: [] };
  const cache = memoOk && !computing.size && !evaluating.size;
  for (const m of o.modifiers) if (m.grants) out.grants.push(...m.grants);
  if (staticDepth > 5) return out;
  if (!mayHaveGrantedAbilities(g)) { if (cache) grantsMemo!.set(id, out); return out; }   // PERF: no static can add any
  const hits: { ts: number; m: StaticMods }[] = [];
  computing.add(id);
  staticDepth++;
  try {
    for (const s of collectStatics(g)) {
      if (!mayGrant(s.ab) || evaluating.has(s.ab)) continue;
      evaluating.add(s.ab);
      let m: StaticMods | null;
      try { m = staticApplies(g, s, id); } finally { evaluating.delete(s.ab); }
      if (m) hits.push({ ts: s.ts, m });
    }
  } finally {
    staticDepth--;
    computing.delete(id);
  }
  hits.sort((a, b) => a.ts - b.ts);
  for (const { m } of hits) {
    if (m.grants) out.grants.push(...m.grants);
    if (m.grantRefs) out.extraRefs.push(...m.grantRefs);
    if (m.copyAbilitiesOf) out.extraRefs.push({ cardId: g.objects[m.copyAbilitiesOf] ? effectiveDef(g, m.copyAbilitiesOf).id : m.copyAbilitiesOf });
  }
  if (cache) grantsMemo!.set(id, out);
  return out;
}

/** Abilities including those granted by statics (needs chars()). Use for triggers/activations. */
export function allAbilities(g: GameState, id: ObjId): AbilityRef[] {
  const out = activeAbilities(g, id);
  const o = g.objects[id];
  if (!o || !(o.zone === 'base' || o.zone === 'battlefield' || o.zone === 'legendZone')) return out;
  const c = grantsOf(g, id);
  let ri = 3000;
  for (const ref of c.extraRefs) {
    const s = getScript(ref.cardId);
    (s?.abilities ?? []).forEach((ab, index) => {
      if (ref.index !== undefined && ref.index !== index) return;
      if ((ab.section ?? 'rules') !== 'rules') return;
      out.push({ obj: id, index: ri++, ability: ab, granted: true, key: `card:${ref.cardId}:${index}` });
    });
  }
  let gi = 2000;
  for (const k of c.grants) {
    if (o.modifiers.some(m => m.grants?.includes(k))) { gi++; continue; }
    const ab = getGrant(k);
    if (ab && dependenciesMet(g, id, ab)) out.push({ obj: id, index: gi, ability: ab, granted: true });
    gi++;
  }
  return out;
}

export function abilityByIndex(g: GameState, id: ObjId, index: number): AbilityRef | undefined {
  return allAbilities(g, id).find(r => r.index === index) ?? keywordAbilities(g, id).find(r => r.index === index);
}

/** Engine-defined activated abilities derived from keywords (Equip = 900, Empower = 901). */
export function keywordAbilities(g: GameState, id: ObjId): AbilityRef[] {
  const out: AbilityRef[] = [];
  const o = g.objects[id];
  if (!o) return out;
  if (o.zone === 'runePool') {
    // CR 164.2 basic rune abilities: [E]: Add [1]  /  Recycle this: Add [C]
    out.push({ obj: id, index: 950, ability: { kind: 'activated', cost: { exhaustSelf: true }, isAdd: true, timing: 'reaction', label: 'Exhaust: Add [1]', text: '[E]: Add [1]', effect: () => {} } });
    out.push({ obj: id, index: 951, ability: { kind: 'activated', cost: { extra: [{ label: 'Recycle this', canPay: () => true, pay: () => true }] }, isAdd: true, timing: 'reaction', label: 'Recycle: Add [C]', text: 'Recycle this: Add [C]', effect: () => {} } });
    return out;
  }
  const c = chars(g, id);
  if (c.keywords.has('Equip') && !o.attachedTo) {
    const cost = keywordCost(g, id, 'Equip');
    if (cost) out.push({ obj: id, index: 900, ability: { kind: 'activated', cost, label: 'Equip', effect: () => {}, text: 'Equip' } });
  }
  if (c.keywords.has('Empower')) {
    const cost = keywordCost(g, id, 'Empower');
    if (cost) out.push({ obj: id, index: 901, ability: { kind: 'activated', cost, label: 'Empower', effect: () => {}, text: 'Empower' } });
  }
  return out;
}

export function resetCharsGuards(): void { computing = new Set(); evaluating = new Set(); staticDepth = 0; }

// Events and triggered abilities (CR 382-385). emit() records an event and queues every
// triggered ability whose condition it meets; chain.ts puts queued triggers on the chain.
import type { GameEvent, GameState, ObjId, PlayerId } from './types.ts';
import type { Ability, TriggeredAbility } from './abilities.ts';
import { allAbilities, abilitySources, dependenciesMet, chars, abilityController, withCharsMemo, effectiveDef } from './chars.ts';
import { getScript, getGrant, getDelayed } from '../cards/registry.ts';
import { makeCtx } from './context.ts';
import { builtinAbility } from './builtin.ts';
import { ruleApplies, ruleSum, extraTriggerCount } from './rules.ts';
import { setLeaveBoardHook } from './state.ts';
import { askYesNo as askYesNoFn } from './ask.ts';

setLeaveBoardHook((g, id, to) => emit(g, { type: 'leaveBoard', obj: id, to, controller: g.objects[id].controller, cardId: g.objects[id].cardId }));

export interface QueuedTrigger {
  /** events emitted consecutively with the same type form one batch (simultaneous); batches are chronological */
  batch?: number;
  source: ObjId | null;
  key: string;               // ability key, see abilityFromKey
  controller: PlayerId;
  event: GameEvent;
  delayedId?: string;
  data?: Record<string, unknown>;
  ts: number;
  /** R-16: set once the controller has ordered it (it is then a pending chain item awaiting finalization) */
  seq?: number;
  /** SF-2: the object the ability is printed on (an Equipment whose effect text acts as its host's ability) */
  abilitySource?: ObjId;
  /** RJ#326: which instance of the ability on its source (two copies of one ability keep separate "chosen this turn" lists) */
  inst?: number;
  /** RJ#12813: epoch of the object a "me" cost refers to (abilitySource ?? source) when it triggered */
  costEpoch?: number;
}

/** Stable key for an ability so it can be looked up after the source changed zones. */
export function abilityKey(g: GameState, src: ObjId, index: number, ab: Ability): string {
  const o = g.objects[src];
  if (index >= 1000) {
    // granted: find grant key
    for (const m of o.modifiers) for (const k of m.grants ?? []) if (getGrant(k) === ab) return `grant:${k}`;
    for (const k of chars(g, src).grants) if (getGrant(k) === ab) return `grant:${k}`;
  }
  // a copy's own abilities are the copied card's (chars.ts activeAbilities uses effectiveDef): key them by that card, so the
  // ability is still found after the object left the board (Reflection copying Glasc Mixologist dies: Deathknell, RJ#11054)
  return `card:${effectiveDef(g, src).id}:${index}`;
}

export function abilityFromKey(g: GameState, key: string): Ability | undefined {
  if (key.startsWith('grant:')) return getGrant(key.slice(6));
  if (key.startsWith('delayed:')) return getDelayed(key.slice(8));
  if (key.startsWith('builtin:')) return builtinAbility(key.slice(8));
  if (key.startsWith('card:')) {
    const rest = key.slice(5);
    const i = rest.lastIndexOf(':');
    const cardId = rest.slice(0, i), idx = Number(rest.slice(i + 1));
    return getScript(cardId)?.abilities[idx];
  }
  return undefined;
}

function triggersOn(ab: Ability, type: string): ab is TriggeredAbility {
  if (ab.kind !== 'triggered') return false;
  const e = ab.on.event;
  return Array.isArray(e) ? e.includes(type) : e === type;
}

function usageKey(g: GameState, src: ObjId, key: string): string {
  return `${src}#${g.objects[src]?.epoch ?? 0}#${key}`;
}

export function oncePerTurnOk(g: GameState, src: ObjId | null, key: string, limit: number | undefined): boolean {
  if (!limit) return true;
  const k = src ? usageKey(g, src, key) : key;
  return (g.ex.usage[k] ?? 0) < limit;
}
/** Once-per-turn usage key of a queued trigger: an additional instance (Svellsongur's copy, extraTriggers — inst ≥ 5000) is its own
 *  ability with its own "first time each turn" (DECISIONS #11747, #326; RJ#3495). */
export function useKeyOf(t: { key: string; inst?: number }): string { return t.inst !== undefined && t.inst >= 5000 ? `${t.key}#${t.inst}` : t.key; }

export function markUsed(g: GameState, src: ObjId | null, key: string): void {
  const k = src ? usageKey(g, src, key) : key;
  g.ex.usage[k] = (g.ex.usage[k] ?? 0) + 1;
}
/** A once-per-turn use spent by a trigger that was then declined (CR 383.3.a: it never triggered). */
export function unmarkUsed(g: GameState, src: ObjId | null, key: string): void {
  const k = src ? usageKey(g, src, key) : key;
  if (g.ex.usage[k]) g.ex.usage[k]--;
}

/** Sources whose triggered abilities are checked: board, legends, battlefields + zone-specific abilities. */
function triggerSources(g: GameState): ObjId[] {
  // (a copy: abilitySources returns its cached list — pushing into it duplicated zone-specific sources on every later scan with the
  // same timestamp, so a trash trigger such as Super Mega Death Rocket!'s fired twice; ENGINE-7)
  const out = [...abilitySources(g)];
  for (const id in g.objects) {
    const o = g.objects[id];
    if (o.zone === 'hand' || o.zone === 'trash' || o.zone === 'facedown' || o.zone === 'championZone' || o.zone === 'banishment' || (o.zone === 'mainDeck' && g.ex.revealed.includes(id))) {
      const s = getScript(o.cardId);
      if (s && s.abilities.some(a => a.kind === 'triggered' && a.activeIn && (a.activeIn.includes(o.zone as never) || a.activeIn.includes('any')))) out.push(id);
    }
  }
  return out;
}

let emitDepth = 0;
let grantStatics = false;
/** Is there any static ability on the board that grants abilities (then every source must be checked)? */
function anyGrantStatics(g: GameState): boolean {
  for (const src of abilitySources(g)) {
    const s = getScript(g.objects[src].cardId);
    if (s && s.abilities.some(a => a.kind === 'static' && (typeof a.mods === 'function' || !!a.mods.grants))) return true;
  }
  return false;
}

// event batches (B6-9): kept in the state so replays reproduce them ("__batch" / "__batchType" in ex.memo)
let batchSeq = 0;
/** Start a new event batch: the next event is not simultaneous with the previous one (each Repeat execution, CR 820.1.d; RJ#6584). */
export function newBatch(g: GameState): void {
  const m = g.ex.memo ?? (g.ex.memo = {});
  m.__batchType = undefined;
}
export function emit(g: GameState, ev: GameEvent): void {
  const m = g.ex.memo ?? (g.ex.memo = {});
  batchSeq = (m.__batch as number | undefined) ?? 0;
  if (ev.type !== m.__batchType) { batchSeq++; m.__batch = batchSeq; m.__batchType = ev.type; }
  if (ev.batch === undefined) ev.batch = batchSeq;      // B6-9: events emitted together share a batch id
  if (ev.type === 'becameMighty' && typeof ev.obj === 'string' && g.objects[ev.obj]) {
    // R-11: keep trackMighty's record in step so the change isn't reported twice
    const rec = (m.__mighty as Record<string, number> | undefined) ?? (m.__mighty = {}) as Record<string, number>;
    rec[`${ev.obj}#${g.objects[ev.obj].epoch ?? 0}`] = 1;
  }
  // RJ#6045 (CR 420.4.a): ordinal of the player's completed card plays this turn (spells complete on resolution, permanents when
  // they enter) — "when you play your second card" triggers read it (Darius, Trifarian); countered cards never complete
  if (ev.type === 'play' && !ev.token && typeof ev.player === 'number' && ev.completedIndex === undefined) {
    const k = `playsCompleted:${ev.player}`;
    ev.completedIndex = g.ex.usage[k] = (g.ex.usage[k] ?? 0) + 1;
    // RJ#6045c (principle 23): per-kind ordinal for "the first time you play a gear each turn" (Jayce), incl. Unit-Gear cards
    const cd = typeof ev.obj === 'string' ? g.cards[g.objects[ev.obj]?.cardId] : undefined;
    if (ev.cardType === 'Gear' || cd?.type === 'Gear' || cd?.additionalTypes?.includes('Gear')) {
      const kg = `playsCompletedGear:${ev.player}`;
      ev.completedGearIndex = g.ex.usage[kg] = (g.ex.usage[kg] ?? 0) + 1;
    }
  }
  g.ex.lastEvents.push(ev);
  if (g.winner !== null && g.phase === 'gameOver') return;
  emitDepth++;
  try {
    collectTriggers(g, ev);
  } finally {
    emitDepth--;
  }
}

interface Immediate { qt: QueuedTrigger; ab: TriggeredAbility; ctx: import('./context.ts').Ctx }

function scanTriggers(g: GameState, ev: GameEvent, queue: QueuedTrigger[], immediate: Immediate[]): void {
  for (const src of triggerSources(g)) {
    const o = g.objects[src];
    if (!o) continue;
    const zoneOk = (ab: Ability) => {
      if (o.zone === 'base' || o.zone === 'battlefield' || o.zone === 'legendZone') return !ab.activeIn || ab.activeIn.includes('board') || ab.activeIn.includes('legendZone') || ab.activeIn.includes('any');
      return !!ab.activeIn && (ab.activeIn.includes(o.zone as never) || ab.activeIn.includes('any'));
    };
    let refs;
    if (o.zone === 'base' || o.zone === 'battlefield' || o.zone === 'legendZone') {
      if (!getScript(o.cardId) && !o.modifiers.some(m => m.grants?.length || m.copyOf) && !grantStatics) continue;
      refs = allAbilities(g, src);
    }
    else {
      const s = getScript(o.cardId);
      refs = (s?.abilities ?? []).map((ability, index) => ({ obj: src, index, ability, viaHost: undefined as ObjId | undefined }));
      refs = refs.filter(r => dependenciesMet(g, src, r.ability));
    }
    for (const r of refs) {
      const ab = r.ability;
      if (!triggersOn(ab, ev.type) || !zoneOk(ab)) continue;
      const key = (r as { key?: string }).key ?? abilityKey(g, src, r.index, ab);
      // effect text of attached gear acts as the host's ability
      const self = r.viaHost ?? src;
      // CR 383.2.c.2 (Viktor, Leader example): a source leaving its zone in the same event only sees its own leaving
      if (ev.type === 'die' && Array.isArray(ev.dying) && (ev.dying as ObjId[]).includes(self) && ev.obj !== self) continue;
      const ctrl = g.objects[self] ? abilityController(g, self) : o.controller;
      const ctx = makeCtx(g, self, ctrl, { event: ev });
      ctx.abilitySource = src;
      if (ab.on.match && !ab.on.match(ev, ctx)) continue;
      if (ab.condition && !ab.condition(ctx)) continue;            // intervening "if": part of the trigger condition (CR 383.2.a.1)
      const baseOk = oncePerTurnOk(g, self, key, ab.oncePerTurn);
      const qt: QueuedTrigger = { source: self, key, controller: ctrl, event: ev, ts: ++g.timestamp, batch: (ev.batch as number | undefined) ?? batchSeq, inst: r.index };
      if (r.obj !== self) qt.abilitySource = r.obj;
      const co = g.objects[r.obj !== self ? r.obj : self]; if (co) qt.costEpoch = co.epoch ?? 0;
      if (ruleApplies(g, 'suppressTrigger', qt)) continue;
      if (ab.oncePerBatch && queue.some(x => x.key === key && x.source === self && x.batch === ((ev.batch as number | undefined) ?? batchSeq))) continue;
      if (ab.isAdd || ab.immediate) { if (baseOk) immediate.push({ qt, ab, ctx }); continue; }
      if (baseOk) queue.push(qt);
      const extra = extraTriggerCount(g, qt);
      // each additional trigger is its own instance (Svellsongur's copy keeps its own "chosen this turn" list, RJ#326, and its own
      // once-per-turn use, RJ#3495)
      for (let k = 0; k < extra; k++) {
        const x: QueuedTrigger = { ...qt, ts: ++g.timestamp, inst: 5000 + 100 * k + (qt.inst ?? 0) };
        if (oncePerTurnOk(g, self, useKeyOf(x), ab.oncePerTurn)) queue.push(x);
      }
    }
  }
}

function collectTriggers(g: GameState, ev: GameEvent): void {
  const queue = g.triggerQueue as QueuedTrigger[];
  const immediate: Immediate[] = [];
  grantStatics = anyGrantStatics(g);
  // MS-2: matching triggers only reads the state (characteristics are memoised for the scan)
  withCharsMemo(g, () => scanTriggers(g, ev, queue, immediate));
  // built-in keyword triggers (Vision, Hunt, Disarm, Weaponmaster, Quick-Draw, ...)
  for (const t of builtinTriggers(g, ev)) {
    if (ruleApplies(g, 'suppressTrigger', t)) continue;
    queue.push(t);
    const extra = extraTriggerCount(g, t);
    for (let k = 0; k < extra; k++) queue.push({ ...t, ts: ++g.timestamp });
  }
  for (const t of queue) if (t.batch === undefined) t.batch = (ev.batch as number | undefined) ?? batchSeq;
  // B6-12: Add / immediate triggers resolve right away, even mid-effect (CR 430.2)
  for (const { qt, ab, ctx } of immediate) {
    if (ab.oncePerTurn) markUsed(g, qt.source, qt.key);
    const payer = ab.payer ? ab.payer(ctx) : qt.controller;
    if (ab.optional && !askYesNoFn(g, payer, typeof ab.optional === 'string' ? ab.optional : (ab.text ?? 'Use this ability?'), qt.source ?? undefined)) continue;
    if (ab.cost && !(payer === qt.controller ? ctx : ctx.as(payer)).pay(ab.cost)) continue;
    ab.effect(ctx);
  }
  // delayed triggered abilities
  for (const d of [...g.ex.delayed]) {
    const ab = getDelayed(d.key);
    if (!ab || !triggersOn(ab, ev.type)) continue;
    const ctx = makeCtx(g, d.source ?? '', d.controller, { event: ev, data: d.data });
    if (ab.on.match && !ab.on.match(ev, ctx)) continue;
    queue.push({ source: d.source, key: `delayed:${d.key}`, controller: d.controller, event: ev, delayedId: d.id, data: d.data, ts: ++g.timestamp });
    if (d.uses !== undefined) {
      d.uses--;
      if (d.uses <= 0) g.ex.delayed = g.ex.delayed.filter(x => x.id !== d.id);
    }
  }
}

// implemented in builtin.ts; re-exported here to keep the import graph simple
import { builtinTriggers } from './builtin.ts';
export { builtinTriggers };

/** CR 383.4.g: queue the named objects' triggered abilities for an event that didn't really happen. */
export function activateTriggers(g: GameState, objs: ObjId[], ev: GameEvent): number {
  const queue = g.triggerQueue as QueuedTrigger[];
  let n = 0;
  for (const src of objs) {
    if (!g.objects[src]) continue;
    for (const r of allAbilities(g, src)) {
      const ab = r.ability;
      if (!triggersOn(ab, ev.type)) continue;
      const self = r.viaHost ?? src;
      const ctx = makeCtx(g, self, abilityController(g, self), { event: ev });
      if (ab.on.match && !ab.on.match(ev, ctx)) continue;
      if (ab.condition && !ab.condition(ctx)) continue;
      queue.push({ source: self, key: (r as { key?: string }).key ?? abilityKey(g, src, r.index, ab), controller: abilityController(g, self), event: { ...ev, activated: true }, ts: ++g.timestamp });
      n++;
    }
  }
  return n;
}

/** Triggers met (pending) or permanents played by a resolution still waiting to enter after them (RJ#8175): the state is Closed. */
export function hasQueuedTriggers(g: GameState): boolean {
  return (g.triggerQueue as QueuedTrigger[]).length > 0 || !!(g.ex.memo?.__enterQueue as unknown[] | undefined)?.length;
}
/** Triggers met but not yet ordered by their controllers (R-16). */
export function hasUnorderedTriggers(g: GameState): boolean {
  return (g.triggerQueue as QueuedTrigger[]).some(t => t.seq === undefined);
}

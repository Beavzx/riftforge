// Batch B2 helpers (equipment / gear / activated abilities). Owned by scripting agent B2.
// Everything here is built on the public DSL / ctx API. Items that would be better as engine
// features are listed in docs/dsl-requests.md; these are the local stand-ins.
import { when, delayedAbility, cost, pay, type Ctx, type ObjId, type PlayerId, type Ability, type Effect, type GameEvent } from '../dsl.ts';
import type { ActivatedAbility, CostSpec, TriggeredAbility } from '../../engine/abilities.ts';
import { ruleSum, extraTriggerCount } from '../../engine/rules.ts';

// ---------------------------------------------------------------------------------------------
// "This enters exhausted." (no engine option exists: ScriptOpts.entersReady can only make a
// permanent enter ready). Stand-in: an Add-speed trigger on entering, so it resolves at once,
// before anyone gets priority (CR 429.2 style immediate resolution).
// ---------------------------------------------------------------------------------------------
export function entersExhausted(): TriggeredAbility {
  return { ...when('enter', (ev, ctx) => ev.obj === ctx.self, ctx => { if (ctx.onBoard(ctx.self)) ctx.exhaust(ctx.self); }), isAdd: true, text: 'This enters exhausted.' };
}

/** Add-speed (immediate, no chain) triggered ability, for "as ..." effects and "until" clean-ups. */
export function immediate(t: TriggeredAbility): TriggeredAbility { return { ...t, isAdd: true }; }

// ---------------------------------------------------------------------------------------------
// Per-object memory that survives turns (ctx.remember is per turn): stored as an inert delayed
// ability bound to the object's epoch.
// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------
// Activated "Add" ability with a variable amount (Hextech Anomaly, Ancient Henge). Not usable by
// the auto-payer (its output isn't fixed); the player activates it explicitly.
// ---------------------------------------------------------------------------------------------
export function addAbility(c: CostSpec, effect: Effect, text: string): ActivatedAbility {
  return { kind: 'activated', cost: c, effect, isAdd: true, timing: 'reaction', text, label: text };
}

/** Largest n in [0, max] such that ctx can pay costOf(n). */
export function maxPayable(ctx: Ctx, max: number, costOf: (n: number) => CostSpec): number {
  let best = 0;
  for (let n = 1; n <= max; n++) { if (ctx.canPay(costOf(n))) best = n; else break; }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Costs
// ---------------------------------------------------------------------------------------------
/** "Kill a friendly unit or gear" (another one) */
export function killFriendlyPermanent(label = 'Kill a friendly unit or gear', o: { includeSelf?: boolean } = {}) {
  return pay.killFriendly((c, id) => c.isUnit(id) || c.isGear(id), label, o);
}

/** "[A] or exhaust a friendly unit" (Blade of the Exile Equip cost): the payer chooses which. */
export function anyPowerOrExhaustFriendly() {
  const readyUnits = (ctx: Ctx) => ctx.friendlyUnits(u => ctx.ctrl(u) === ctx.controller && !ctx.isExhausted(u));
  return pay.custom('[A] or exhaust a friendly unit',
    ctx => ctx.canPay(cost('[A]')) || readyUnits(ctx).length > 0,
    ctx => {
      const opts: { id: string; label: string }[] = [];
      if (ctx.canPay(cost('[A]'))) opts.push({ id: 'A', label: 'Pay [A]' });
      if (readyUnits(ctx).length) opts.push({ id: 'exhaust', label: 'Exhaust a friendly unit' });
      if (!opts.length) return false;
      const pick = ctx.chooseMode(opts, 'Pay [A] or exhaust a friendly unit');
      if (pick === 'A') return ctx.pay(cost('[A]'));
      const u = ctx.chooseCards(readyUnits(ctx), 1, 1, 'Exhaust a friendly unit')[0];
      if (!u) return false;
      ctx.exhaust(u);
      return true;
    });
}

// ---------------------------------------------------------------------------------------------
// Board scans that avoid computing characteristics of every object (no static recursion).
// ---------------------------------------------------------------------------------------------
export function friendlyGearCount(ctx: Ctx): number {
  let n = 0;
  const bfObjs = new Set(ctx.g.battlefields.map(b => b.objId));
  for (const id in ctx.g.objects) {
    const o = ctx.g.objects[id];
    if ((o.zone !== 'base' && o.zone !== 'battlefield') || bfObjs.has(id)) continue;
    const d = ctx.g.cards[o.cardId];
    // Gear Units (Patched Porobot: type Unit + additionalTypes ['Gear']) are gear too
    if (!(d?.type === 'Gear' || d?.additionalTypes?.includes('Gear')) || o.counters.unitGearMight !== undefined) continue;
    if (!ctx.isOpponent(o.controller)) n++;
  }
  return n;
}

export function isEquipmentDef(ctx: Ctx, id: ObjId): boolean {
  const d = ctx.g.cards[ctx.obj(id)?.cardId ?? ''];
  return !!d && d.type === 'Gear' && (d.tags.includes('Equipment') || d.keywords.includes('Equip'));
}

/** Base Might bonus printed on an Equipment. */
export function baseMightBonus(ctx: Ctx, id: ObjId): number { return ctx.g.cards[ctx.obj(id)?.cardId ?? '']?.might ?? 0; }

// ---------------------------------------------------------------------------------------------
// Turn facts the engine doesn't record (see docs/dsl-requests.md).
// ---------------------------------------------------------------------------------------------

/** Did a unit or gear controlled by p die this turn? (engine counts unit deaths only) */
export function friendlyPermanentDiedThisTurn(ctx: Ctx, p: PlayerId = ctx.controller): boolean {
  if (ctx.count(`unitsDied:${p}`) > 0 || ctx.count(`gearDied:${p}`) > 0 || ctx.count(`permanentsDied:${p}`) > 0) return true;
  // fallback for gear: kill() logs "<names> died" with the dying objects as refs
  for (let i = ctx.g.log.length - 1; i >= 0; i--) {
    const e = ctx.g.log[i];
    if (e.turn !== ctx.g.turn) break;
    if (!/ died$/.test(e.text) || !e.ref) continue;
    for (const id of e.ref) {
      const o = ctx.g.objects[id];
      if (o && o.owner === p && ctx.g.cards[o.cardId]?.type === 'Gear') return true;
    }
  }
  return false;
}

/**
 * Ordinal of a 'draw' event among the cards player p drew this turn (1 = first card).
 * Uses an engine counter if present; otherwise keeps its own list in g.ex.turnFacts, seeded from
 * the log ("<name> draws N" entries) the first time it is consulted in a turn.
 */
export function drawOrdinal(ctx: Ctx, p: PlayerId, ev: GameEvent): number {
  const key = `B2:draws:${p}`;
  let list = ctx.g.ex.turnFacts[key] as string[] | undefined;
  if (!list) {
    let seed = 0;
    for (const e of ctx.g.log) if (e.turn === ctx.g.turn && e.player === p) { const m = / draws (\d+)$/.exec(e.text); if (m) seed += Number(m[1]); }
    list = new Array(seed).fill('?');
  }
  const o = ctx.obj(ev.obj as ObjId);
  const tag = `${ev.obj}#${o?.epoch ?? 0}`;
  if (!list.includes(tag)) list = [...list, tag];
  ctx.g.ex.turnFacts[key] = list;
  return list.indexOf(tag) + 1;
}

/**
 * Battlefield controller before the current conquest. Recorded (as a side effect of an inert
 * listener's match) when the battlefield becomes contested or a showdown/combat starts there.
 */
export function bfControllerListener(): TriggeredAbility {
  return when(['contested', 'showdownStart', 'combatStart'], (ev, ctx) => {
    if (typeof ev.bf === 'number') ctx.g.ex.turnFacts[`B2:bfPrev:${ev.bf}`] = ctx.g.battlefields[ev.bf]?.controller ?? null;
    return false;
  }, () => {}, { text: '(tracks battlefield control)' });
}
export function bfControllerBefore(ctx: Ctx, ev: GameEvent): PlayerId | null | undefined {
  if ('prevController' in ev) return ev.prevController as PlayerId | null;
  const v = ctx.g.ex.turnFacts[`B2:bfPrev:${ev.bf}`];
  return v === undefined ? undefined : (v as PlayerId | null);
}

/** Objects that a card's own printed abilities are keyed by (CR 434: "copy that unit's text"). */
export function ownAbilityKeyPrefix(ctx: Ctx, id: ObjId): string { return `card:${ctx.obj(id) ? ctx.cardIdOf(id) : ''}:`; }   // a copy: the copied card (events.ts abilityKey)

export type { Ability };

// ---------------------------------------------------------------------------------------------
// Skyfall of Areion: "My hold effects are also conquer effects, and vice versa." (SCRIPT-FIX)
// When the equipped unit conquers (holds), its own and its attached Equipment's hold (conquer) triggers are queued for
// the same scoring, as if it had held (conquered) — CR 383.4.g "activate" style. Abilities that already trigger on the
// real event ("When I conquer or hold") are not queued a second time.
// ---------------------------------------------------------------------------------------------
import { abilityFromKey, type QueuedTrigger } from '../../engine/events.ts';
export function alsoTriggerAs(ctx: Ctx, host: ObjId, ev: GameEvent, asType: 'conquer' | 'hold'): void {
  const queue = ctx.g.triggerQueue as QueuedTrigger[];
  const before = queue.length;
  // fromType: what actually happened (a hold effect activated by a conquest is a conquer effect "for conquering here", RJ#9537)
  ctx.activateTriggers([host, ...ctx.attachments(host)], { ...ev, type: asType, activated: true, skyfall: true, fromType: ev.type });
  const added = queue.splice(before);
  for (const q of added) {
    const ab = abilityFromKey(ctx.g, q.key);
    const evs = ab?.kind === 'triggered' ? [ab.on.event].flat() : [];
    if (evs.includes(ev.type)) continue;
    queue.push(q);
    // "trigger an additional time" rules (Red Brambleback) apply to these triggers too (RJ#9537)
    const extra = extraTriggerCount(ctx.g, q);
    for (let k = 0; k < extra; k++) queue.push({ ...q, ts: ++ctx.g.timestamp, inst: 5000 + 100 * k + (q.inst ?? 0) });
  }
}

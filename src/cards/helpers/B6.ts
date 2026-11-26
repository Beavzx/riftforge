// Helpers for batch B6 (pump / ready / buff). Owned by scripting agent B6.
// Everything here uses only the public DSL / ctx API. Entries marked "LOCAL" stand in for engine
// support requested in docs/dsl-requests.md.
import type { Ctx, ObjId, GameEvent, Ability } from '../dsl.ts';
import { asPlay, selfCostDyn, when, E, delayedAbility, rule, grantable, statik } from '../dsl.ts';

type Loc = 'base' | number;

// ------------------------------------------------------------------------------------------------
// buffs
// ------------------------------------------------------------------------------------------------

/** LOCAL: cards whose own text lets them have any number of buffs (Lee Sin, Ascetic: ogn-078-298). */
/** Number of buff counters on a unit. */
export const buffsOn = (ctx: Ctx, id: ObjId): number => ctx.obj(id)?.counters.buff ?? 0;


/** Units you control that have a buff (only those can be spent, CR 427). */
export const myBuffed = (ctx: Ctx): ObjId[] => ctx.units(u => ctx.ctrl(u) === ctx.controller && ctx.isBuffed(u));
/** Units you control (optionally filtered). */
export const myUnits = (ctx: Ctx, f?: (id: ObjId) => boolean): ObjId[] => ctx.units(u => ctx.ctrl(u) === ctx.controller && (!f || f(u)));
/** Total buffs on units you control. */
export const myBuffCount = (ctx: Ctx): number => myBuffed(ctx).reduce((s, u) => s + buffsOn(ctx, u), 0);

/**
 * "Spend any number of buffs": the player picks which units (and, for units with several buffs, how many).
 * Returns the number of buffs spent.
 */
export function spendAnyNumberOfBuffs(ctx: Ctx, prompt = 'Spend buffs from which units?', exactly?: number): number {
  const units = myBuffed(ctx);
  if (!units.length) return 0;
  const total = units.reduce((s, u) => s + buffsOn(ctx, u), 0);
  const want = exactly === undefined ? undefined : Math.min(exactly, total);
  if (want === 0) return 0;
  // units with one buff each: a single multi-select answers everything
  const multi = units.some(u => buffsOn(ctx, u) > 1);
  let spent = 0;
  if (!multi) {
    const n = want ?? undefined;
    const picked = ctx.chooseCards(units, n ?? 0, n ?? units.length, prompt);
    for (const u of picked) if (ctx.spendBuff(u)) spent++;
    return spent;
  }
  const picked = ctx.chooseCards(units, want === undefined ? 0 : 1, units.length, prompt);
  for (const u of picked) {
    const left = want === undefined ? Infinity : want - spent;
    if (left <= 0) break;
    const max = Math.min(buffsOn(ctx, u), left);
    const k = max > 1 ? ctx.chooseNumber(1, max, `Spend how many buffs from ${ctx.name(u)}?`) : 1;
    for (let i = 0; i < k; i++) if (ctx.spendBuff(u)) spent++;
  }
  return spent;
}

/**
 * "As you play this, you may spend a buff as an additional cost. If you do, ignore this spell's cost."
 * (Wallop, Call to Glory). The choice is made as the card is played and the buff is spent right away
 * (LOCAL: ctx.addPlayCost with non-resource parts can't be stored in the state, see dsl-requests; a failed
 * payment rolls the whole play back, so spending early is safe). Without a chain item (legality checks)
 * the card counts as free when a buff is available, so it can be played with the buff alone.
 */
// ------------------------------------------------------------------------------------------------
// runes / movement / misc
// ------------------------------------------------------------------------------------------------

/** "Ready up to N (friendly) runes": the player picks among their exhausted runes. */
export function readyRunesUpTo(ctx: Ctx, n: number): ObjId[] {
  const cands = ctx.runes().filter(r => ctx.isExhausted(r));
  if (!cands.length || n <= 0) return [];
  const ids = ctx.chooseCards(cands, 0, n, `Ready up to ${n} rune${n > 1 ? 's' : ''}`);
  ctx.ready(ids);
  return ids;
}

/** Battlefield index of a battlefield card object id. */
export const bfIndexOf = (ctx: Ctx, bfObj: ObjId | undefined): number | undefined => {
  if (!bfObj) return undefined;
  const i = ctx.g.battlefields.findIndex(b => b.objId === bfObj);
  return i >= 0 ? i : undefined;
};

const SUMMING = new Set(['Assault', 'Shield', 'Deflect', 'Hunt', 'Disarm']);
/** An object's current keywords as grantable keyword strings ("Deflect", "Assault 2", "Tank"). */
export function keywordStrings(ctx: Ctx, id: ObjId): string[] {
  const out: string[] = [];
  for (const [k, v] of ctx.chars(id).keywords) out.push(SUMMING.has(k) && v !== 1 ? `${k} ${v}` : k);
  return out;
}

/** The play data of the card whose "When you play me" trigger is resolving (or of the spell itself). */
export function playData(ctx: Ctx): Record<string, unknown> {
  const pd = (ctx.event?.playData as Record<string, unknown> | undefined);
  return pd ?? ctx.data;
}
/** "if you paid the additional cost" inside a play trigger. */
export const paidAdditional = (ctx: Ctx): boolean => !!playData(ctx).paidAdditional || !!ctx.data.paidAdditional;

/**
 * LOCAL: objects already chosen for earlier target groups of the spell/ability being played.
 * Uses ctx.targets when the engine fills it progressively, else this action's `targeted` events.
 */
export function chosenSoFar(ctx: Ctx): ObjId[] {
  const out: ObjId[] = [...ctx.targets.flat()];
  for (const e of ctx.g.ex.lastEvents) {
    if (e.type === 'targeted' && e.source === ctx.self && e.player === ctx.controller && typeof e.obj === 'string' && !out.includes(e.obj)) out.push(e.obj);
  }
  return out;
}
/** Battlefield index chosen in an earlier target group (see chosenSoFar). */
export function chosenBattlefield(ctx: Ctx): number | undefined {
  for (const id of chosenSoFar(ctx)) { const i = bfIndexOf(ctx, id); if (i !== undefined) return i; }
  return undefined;
}
/** First unit chosen in an earlier target group (see chosenSoFar). */
export function chosenUnit(ctx: Ctx): ObjId | undefined {
  return chosenSoFar(ctx).find(id => ctx.exists(id) && ctx.isUnit(id));
}

/**
 * LOCAL: "When one or more ... " — true if `ev` is the first event of its simultaneous batch that counts.
 * Events of one action that happen at the same time are emitted consecutively; walk back over the
 * consecutive run of `sameKind` events and report false if an earlier one already `counts`.
 */
const sameBatch = (a: GameEvent, b: GameEvent) => a.batch === undefined || b.batch === undefined || a.batch === b.batch;
export function firstOfBatch(ctx: Ctx, ev: GameEvent, sameKind: (e: GameEvent) => boolean, counts: (e: GameEvent) => boolean): boolean {
  const le = ctx.g.ex.lastEvents;
  let i = le.lastIndexOf(ev);
  if (i < 0) return true;
  // (an engine batch boundary — newBatch: each Repeat execution, each trigger's cost — also ends the batch; ENGINE-7, RJ#6974)
  for (i = i - 1; i >= 0 && sameKind(le[i]) && sameBatch(le[i], ev); i--) if (counts(le[i])) return false;
  return true;
}
/** Number of consecutive simultaneous `sameKind` events up to and including `ev` that `count`. */
export function batchCount(ctx: Ctx, ev: GameEvent, sameKind: (e: GameEvent) => boolean, counts: (e: GameEvent) => boolean): number {
  const le = ctx.g.ex.lastEvents;
  let i = le.lastIndexOf(ev);
  if (i < 0) return counts(ev) ? 1 : 0;
  let n = counts(ev) ? 1 : 0;
  for (i = i - 1; i >= 0 && sameKind(le[i]) && sameBatch(le[i], ev); i--) if (counts(le[i])) n++;
  return n;
}

/**
 * LOCAL: a silent per-turn fact tracker. It never triggers; its match records a per-turn flag in
 * ctx.g.ex.counts (cleared at the start of each turn). Active in every zone that the engine checks.
 */
export function tracker(event: string | string[], record: (ev: GameEvent, ctx: Ctx) => string | null): Ability {
  return when(event, (ev, ctx) => { const k = record(ev, ctx); if (k) ctx.g.ex.counts[k] = 1; return false; }, E.noop, { activeIn: ['any'], text: '(tracks this turn)' });
}

// ------------------------------------------------------------------------------------------------
// delayed abilities / grants
// ------------------------------------------------------------------------------------------------

/** "It can't move this turn": ctx.delay(CANT_MOVE, { obj, epoch }, 'endOfTurn') */
export const CANT_MOVE = delayedAbility('B6:cantMove', rule('cantMove', (ctx, unit: ObjId) => unit === ctx.data.obj && (ctx.obj(unit)?.epoch ?? 0) === ctx.data.epoch));
export function cantMoveThisTurn(ctx: Ctx, id: ObjId): void { ctx.delay(CANT_MOVE, { obj: id, epoch: ctx.obj(id)?.epoch ?? 0 }, 'endOfTurn'); }

/**
 * LOCAL (Stand United): "Buffs give an additional +1 [S] to friendly units this turn."
 * There are no delayed static abilities, so the static is granted to the controller's legend for the turn.
 */
export const EXTRA_BUFF_MIGHT = grantable('B6:extraBuffMight', statik(
  (ctx, id) => ctx.isUnit(id) && ctx.isFriendly(id) && ctx.isBuffed(id),
  (ctx, id) => ({ might: buffsOn(ctx, id) }),
  { text: 'Buffs give an additional +1 [S] to friendly units this turn.' },
));

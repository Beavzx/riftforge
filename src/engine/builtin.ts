// Engine-level keyword abilities (CR 800+): Vision, Hunt, Disarm, Weaponmaster, Quick-Draw,
// plus damage prevention (CR 437) as a delayed replacement.
import type { GameEvent, GameState, ObjId, PlayerId } from './types.ts';
import type { Ability, TriggeredAbility, ReplacementAbility } from './abilities.ts';
import type { QueuedTrigger } from './events.ts';
import type { Ctx } from './context.ts';
import { hasKw, kwVal, isUnit, isEquipment, keywordCost, onBoard } from './chars.ts';
import { unitsAtLoc } from './actions.ts';
import { locOf, isBattlefieldCard } from './state.ts';
import { ruleApplies } from './rules.ts';
import { registerDelayed } from '../cards/registry.ts';
import { equipCostFor } from './play.ts';

const vision: TriggeredAbility = {
  kind: 'triggered', text: 'Vision — predict', on: { event: 'play' },
  effect: ctx => ctx.predict(1),
};
const hunt: TriggeredAbility = {
  kind: 'triggered', text: 'Hunt — gain XP', on: { event: ['conquer', 'hold'] },
  effect: ctx => ctx.gainXp(Number(ctx.data.n ?? ctx.kw(ctx.self, 'Hunt')) || 1),
};
const disarm: TriggeredAbility = {
  kind: 'triggered', text: 'Disarm — an enemy unit here gets -X Might this turn', on: { event: 'attack' },
  targets: [{ kind: 'unit', prompt: 'Disarm: choose an enemy unit here', hint: 'harm', filter: (ctx, id) => ctx.isEnemy(id) && ctx.isHere(id) }],
  effect: ctx => { const t = ctx.target(0); if (t) ctx.giveMight(t, -(Number(ctx.data.n) || ctx.kw(ctx.self, 'Disarm') || 1), 'endOfTurn'); },
};
// R-10 (CR 821.1.c): the Equipment is chosen as the trigger goes on the chain (optional); its Equip cost is computed as if Equip
// were activated choosing this unit (incl. Equip cost modifiers) and is one [A] less only if it contains [A].
const weaponmaster: TriggeredAbility = {
  kind: 'triggered', text: 'Weaponmaster — you may attach an Equipment you control', on: { event: 'play' },
  targets: [{ kind: 'gear', min: 0, max: 1, pick: true, hint: 'help', prompt: 'Weaponmaster: choose an Equipment to attach (or none)',
    filter: (ctx, id) => ctx.ctrl(id) === ctx.controller && ctx.isEquipment(id) && g_attachable(ctx.g, id, ctx.self) }],
  effect: ctx => {
    const gear = ctx.target(0);
    if (!gear || !ctx.onBoard(ctx.self) || !g_attachable(ctx.g, gear, ctx.self)) return;
    const c = equipCostFor(ctx.g, ctx.controller, gear, ctx.self, { minusA: true });
    if (!c) return;                                   // CR 821.1.c.4-5: no Equip ability, nothing to pay
    ctx.data.equipTarget = ctx.self;
    if (!ctx.canPayResolved(c, gear)) return;
    if (ctx.payResolved(c, gear)) ctx.attach(gear, ctx.self);
  },
};
const quickDraw: TriggeredAbility = {
  kind: 'triggered', text: 'Quick-Draw — attach to a unit you control', on: { event: 'play' },
  effect: ctx => {
    const units = ctx.friendlyUnits(u => ctx.ctrl(u) === ctx.controller);
    if (!units.length || !ctx.onBoard(ctx.self)) return;
    const u = ctx.chooseCards(units, 1, 1, 'Quick-Draw: choose a unit to attach to')[0];
    if (u) ctx.attach(ctx.self, u);
  },
};
const prevent: ReplacementAbility = {
  kind: 'replacement', text: 'Prevent damage', event: 'damage',
  match: (ev, ctx) => ev.obj === ctx.data.obj && (ctx.g.objects[ev.obj as string]?.epoch ?? 0) === ctx.data.epoch,
  apply: (ev, ctx) => {
    const rem = ctx.data.remaining as number | 'all';
    const amt = Number(ev.amount);
    if (rem === 'all') return { ...ev, amount: 0 };
    const prevented = Math.min(rem, amt);
    ctx.data.remaining = rem - prevented;
    if ((ctx.data.remaining as number) <= 0) ctx.data.__consume = true;
    return { ...ev, amount: amt - prevented };
  },
};

function g_attachable(g: GameState, gear: ObjId, unit: ObjId): boolean {
  return onBoard(g, gear) && g.objects[gear].attachedTo !== unit;
}

// CR 816: Temporary — "At the start of your Beginning Phase, kill this." (before scoring; a real chain item)
// "this" is the object that triggered (CR 124.1, RJ#12419): if it left the board and came back (Temporal Breach in response) it is a
// new object, so the kill does nothing — the trigger data records the source's epoch when it triggered
const sameObject = (ctx: Ctx) => ctx.data.epoch === undefined || (ctx.g.objects[ctx.self]?.epoch ?? 0) === ctx.data.epoch;
const temporary: TriggeredAbility = {
  kind: 'triggered', text: 'Temporary — kill this at the start of your Beginning Phase', on: { event: 'beginningPhase' },
  effect: ctx => { if (ctx.onBoard(ctx.self) && sameObject(ctx) && !ruleApplies(ctx.g, 'noTemporary', ctx.self)) ctx.kill(ctx.self); },
};

const deployHold: TriggeredAbility = {
  kind: 'triggered', text: 'Deploy — an opponent held here: kill this', on: { event: 'hold' },
  effect: ctx => { if (ctx.onBoard(ctx.self) && sameObject(ctx)) ctx.kill(ctx.self); },
};

// B8-5: a legend added "while I'm on the board" returns when its source leaves the board
registerDelayed('core:returnLegend', {
  kind: 'triggered', immediate: true, text: 'The added legend leaves the Legend Zone',
  on: { event: 'leaveBoard', match: (ev, ctx) => ev.obj === ctx.data.src },
  effect: ctx => { const l = ctx.data.legend as ObjId; const o = ctx.g.objects[l]; if (o && o.zone === 'legendZone') { o.zone = 'setAside'; ctx.g.timestamp++; } },
});

const BUILTINS: Record<string, Ability> = { Temporary: temporary, Deploy: deployHold, Vision: vision, Hunt: hunt, Disarm: disarm, Weaponmaster: weaponmaster, 'Quick-Draw': quickDraw, prevent };

export function builtinAbility(name: string): Ability | undefined { return BUILTINS[name]; }

function q(g: GameState, src: ObjId, name: string, ev: GameEvent, controller: PlayerId, data?: Record<string, unknown>): QueuedTrigger {
  return { source: src, key: `builtin:${name}`, controller, event: ev, ts: ++g.timestamp, data };
}

/** Keyword conquer effects of a unit (Hunt: "When I conquer or hold, gain X XP", CR 823) — for "activate the conquer effects"
 *  (Reckoner's Arena, RJ#10797). */
export function keywordConquerTriggers(g: GameState, u: ObjId, ev: GameEvent, controller: PlayerId): QueuedTrigger[] {
  const n = kwVal(g, u, 'Hunt');
  return n > 0 ? [q(g, u, 'Hunt', ev, controller, { n })] : [];
}

export function builtinTriggers(g: GameState, ev: GameEvent): QueuedTrigger[] {
  const out: QueuedTrigger[] = [];
  if (ev.type === 'play' && typeof ev.obj === 'string' && g.objects[ev.obj]) {
    const id = ev.obj, o = g.objects[id];
    if (!onBoard(g, id) && o.zone !== 'chain') return out;
    const visions = kwVal(g, id, 'Vision');
    for (let i = 0; i < visions; i++) out.push(q(g, id, 'Vision', ev, o.controller));
    if (hasKw(g, id, 'Weaponmaster') && isUnit(g, id)) out.push(q(g, id, 'Weaponmaster', ev, o.controller));
    if (hasKw(g, id, 'Quick-Draw') && !isUnit(g, id)) out.push(q(g, id, 'Quick-Draw', ev, o.controller));
  }
  if ((ev.type === 'conquer' || ev.type === 'hold') && typeof ev.bf === 'number') {
    const p = ev.player as PlayerId;
    for (const u of unitsAtLoc(g, ev.bf)) {
      if (g.objects[u].controller !== p) continue;
      const n = kwVal(g, u, 'Hunt');
      if (n > 0) out.push(q(g, u, 'Hunt', ev, p, { n }));
    }
  }
  if (ev.type === 'hold' && typeof ev.bf === 'number') {
    // CR 830 Deploy: "When an opponent holds here, kill this."
    for (const id in g.objects) {
      const o = g.objects[id];
      if (o.zone !== 'battlefield' || o.battlefieldIndex !== ev.bf || o.controller === ev.player) continue;
      if (!hasKw(g, id, 'Deploy') || isUnit(g, id)) continue;
      if (g.mode === '2v2' ? o.controller % 2 !== (ev.player as number) % 2 : true) out.push(q(g, id, 'Deploy', ev, o.controller, { epoch: o.epoch ?? 0 }));
    }
  }
  if (ev.type === 'beginningPhase') {
    const p = ev.player as PlayerId;
    for (const id in g.objects) {
      const o = g.objects[id];
      if (o.controller !== p || !(o.zone === 'base' || o.zone === 'battlefield') || isBattlefieldCard(g, id)) continue;
      if (!hasKw(g, id, 'Temporary') || ruleApplies(g, 'noTemporary', id)) continue;
      out.push(q(g, id, 'Temporary', ev, p, { epoch: o.epoch ?? 0 }));
    }
  }
  if (ev.type === 'attack' && typeof ev.obj === 'string' && g.objects[ev.obj]) {
    const n = kwVal(g, ev.obj, 'Disarm');
    if (n > 0) out.push(q(g, ev.obj, 'Disarm', ev, g.objects[ev.obj].controller, { n }));
  }
  void locOf; void isEquipment;
  return out;
}

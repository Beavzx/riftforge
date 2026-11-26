// Targeting (CR 355.6-355.14, 756-758) and candidate enumeration for choices.
import type { GameState, ObjId, PlayerId } from './types.ts';
import type { TargetSpec } from './abilities.ts';
import type { Ctx } from './context.ts';
import { isUnit, isGear, chars, onBoard, kwVal, effectiveDef } from './chars.ts';
import { isBattlefieldCard, locOf } from './state.ts';
import { isOpponent } from './util.ts';
import { emit } from './events.ts';
import { ruleApplies } from './rules.ts';
import { chooseOne as chooseOneFn, chooseOptions as chooseOptionsFn } from './ask.ts';

function defaultZones(kind: string): string[] {
  return kind === 'battlefield' ? ['battlefields'] : kind === 'rune' ? ['runes'] : kind === 'legend' ? ['legends'] : ['board'];
}

function zoneObjects(g: GameState, ctx: Ctx, zone: string): string[] {
  const out: string[] = [];
  switch (zone) {
    case 'board':
      for (const id in g.objects) { const o = g.objects[id]; if ((o.zone === 'base' || o.zone === 'battlefield') && !isBattlefieldCard(g, id)) out.push(id); }
      break;
    case 'battlefields': for (const b of g.battlefields) out.push(b.objId); break;
    case 'runes': for (const p of g.players) out.push(...p.runesInPlay); break;
    case 'legends': for (const id in g.objects) if (g.objects[id].zone === 'legendZone') out.push(id); break;
    case 'facedown': for (const id in g.objects) if (g.objects[id].zone === 'facedown') out.push(id); break;
    // RJ#8247 (house, by analogy with CR 355.9.c): new choices made while an item resolves (Mystic Reversal remaking Wind Wall's
    // target) can't select the resolving item
    case 'chain': for (const c of g.chain) if (!c.pending && c.id !== ctx.item?.id && c.id !== g.ex.memo?.__resolvingItem) out.push(c.id); break;
    case 'hand': for (const p of g.players) out.push(...p.hand); break;
    case 'trash': for (const p of g.players) out.push(...p.trash); break;
    case 'banishment': for (const p of g.players) out.push(...p.banishment); break;
    case 'mainDeck': for (const p of g.players) out.push(...p.mainDeck); break;
  }
  return out;
}

/** R-2 destination choices: "loc:base" (the mover's base) or a battlefield card id. */
export const BASE_DEST = 'loc:base';
export function destLoc(g: GameState, id: string | undefined): 'base' | number | null {
  if (!id) return null;
  if (id === BASE_DEST) return 'base';
  const i = g.battlefields.findIndex(b => b.objId === id);
  return i >= 0 ? i : null;
}

/**
 * Ask for one choice group. Destination groups with exactly one pick are asked as a 'chooseDestination' decision
 * (options 'base' / battlefield index, as for plays) and mapped back to destination ids.
 */
export function chooseGroup(g: GameState, p: PlayerId, spec: TargetSpec, prompt: string, cands: string[], labelOf: (id: string) => string, min: number, max: number,
  opts: { source?: ObjId; hint?: TargetSpec['hint']; data?: Record<string, unknown> } = {}): string[] {
  if (spec.kind === 'destination' && min === 1 && max === 1) {
    const toOpt = (id: string) => (id === BASE_DEST ? 'base' : String(destLoc(g, id)));
    const r = chooseOneFn(g, p, 'chooseDestination', prompt, cands.map(id => ({ id: toOpt(id), label: labelOf(id), objIds: g.objects[id] ? [id] : [] })), { source: opts.source });
    const hit = cands.find(id => toOpt(id) === r);
    return hit ? [hit] : [];
  }
  return chooseOptionsFn(g, p, 'chooseTargets', prompt, cands.map(id => ({ id, label: labelOf(id), objIds: g.objects[id] ? [id] : [] })), min, max, opts);
}

function kindOk(g: GameState, spec: TargetSpec, id: string): boolean {
  if (spec.kind === 'chainItem') return g.chain.some(c => c.id === id);
  if (spec.kind === 'destination') return id === BASE_DEST || isBattlefieldCard(g, id);
  const o = g.objects[id];
  if (!o) return false;
  switch (spec.kind) {
    case 'unit': return isUnit(g, id);
    // RJ#11842 (CR 178.3): a printed Gear Unit (Patched Porobot) is a gear; gear that *became* a unit is not
    case 'gear': return isGear(g, id) && (!isUnit(g, id) || !!effectiveDef(g, id).additionalTypes?.includes('Gear'));
    case 'permanent': return isUnit(g, id) || isGear(g, id);
    case 'battlefield': return isBattlefieldCard(g, id);
    case 'rune': return o.zone === 'runePool';
    case 'legend': return o.zone === 'legendZone';
    case 'card': case 'any': return true;
  }
  return true;
}

export function untargetableBy(g: GameState, id: string, chooser: PlayerId): boolean {
  const o = g.objects[id];
  if (!o) return false;
  if (!isOpponent(g, chooser, o.controller)) return false;
  return chars(g, id).cantBeChosenByEnemy;
}

export function legalTarget(g: GameState, ctx: Ctx, spec: TargetSpec, id: string): boolean {
  if (!kindOk(g, spec, id)) return false;
  // R-2: a destination is a choice (not a target): no zones, untargetability or Hidden "here" restriction
  if (spec.kind === 'destination') return !spec.filter || spec.filter(ctx, id);
  if (spec.kind !== 'chainItem') {
    const o = g.objects[id];
    const zones = spec.zones ?? defaultZones(spec.kind);
    const z = o.zone === 'base' || o.zone === 'battlefield' ? (isBattlefieldCard(g, id) ? 'battlefields' : 'board') : o.zone === 'runePool' ? 'runes' : o.zone === 'legendZone' ? 'legends' : o.zone;
    if (!zones.includes(z as never)) return false;
    if (!spec.pick && (z === 'board') && untargetableBy(g, id, ctx.controller)) return false;
  }
  if (spec.filter && !spec.filter(ctx, id)) return false;
  // CR 811.1.d: a card played from hiding chooses only "here" — also re-checked on resolution (RJ#78 / 6518)
  const here = hiddenLoc(g, ctx, spec);
  if (here !== undefined && spec.kind !== 'chainItem' && g.objects[id] && (g.objects[id].zone === 'base' || g.objects[id].zone === 'battlefield')) {
    if (here === null || !(locOf(g, id) === here || g.battlefields[here]?.objId === id)) return false;
  }
  return true;
}

/**
 * CR 811.1.d.2-.4: the battlefield a choice made from facedown is restricted to, per target group (undefined = no restriction).
 * - a spell played from facedown (`data.hiddenHere`): the battlefield it was hidden at;
 * - a play effect of a permanent played from facedown (`data.hiddenSrc`/`hiddenAt`, 811.1.d.3/.3.a): the battlefield it was played
 *   to (a gear recalled to base keeps it) — null once the source has left the board (no legal choice at finalization; mistarget
 *   on resolution, RJ#2696);
 * - a group whose own text makes "here" impossible ("at a different location", `spec.anyLocation`) is not restricted (811.1.d.4).
 */
export function hiddenLoc(g: GameState, ctx: Ctx, spec?: TargetSpec): number | null | undefined {
  if (spec?.anyLocation) return undefined;
  const src = ctx.data?.hiddenSrc as ObjId | undefined;
  if (src !== undefined) {
    const o = g.objects[src], at = ctx.data.hiddenAt as number | null | undefined;
    return o && onBoard(g, src) && (o.epoch ?? 0) === (ctx.data.hiddenSrcEpoch ?? 0) && typeof at === 'number' ? at : null;
  }
  return ctx.data?.hiddenHere as number | undefined;
}

export function candidatesFor(g: GameState, ctx: Ctx, spec: TargetSpec): string[] {
  if (spec.kind === 'destination') return [BASE_DEST, ...g.battlefields.map(b => b.objId)].filter(id => legalTarget(g, ctx, spec, id));
  const zones = spec.kind === 'chainItem' ? ['chain'] : (spec.zones ?? defaultZones(spec.kind));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const z of zones) for (const id of zoneObjects(g, ctx, z)) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (legalTarget(g, ctx, spec, id)) out.push(id);
  }
  // Hidden: choices restricted to "here" unless the group's text makes that impossible (CR 811.1.d.2-.4)
  const here = hiddenLoc(g, ctx, spec);
  const zones2 = spec.zones ?? defaultZones(spec.kind);
  if (here !== undefined && spec.kind !== 'chainItem' && (zones2.includes('board') || zones2.includes('battlefields'))) {
    // CR 811: choices restricted to "here" (board objects at that battlefield, or the battlefield itself)
    return sameLocationFeasible(g, spec, out.filter(id => g.objects[id] && (!(g.objects[id].zone === 'base' || g.objects[id].zone === 'battlefield') || (here !== null && (locOf(g, id) === here || g.battlefields[here]?.objId === id)))));
  }
  return sameLocationFeasible(g, spec, out);
}

/**
 * MS-5 (META-AUDIT): a `sameLocation` group that needs 2+ objects can only use objects whose location holds enough
 * candidates (Switcheroo: "two units at the same battlefield"). Without this, the play was legal with no valid pair and
 * the decision had no answer.
 */
function sameLocationFeasible(g: GameState, spec: TargetSpec, ids: string[]): string[] {
  const need = spec.min ?? 1;
  if (!spec.sameLocation || need <= 1 || ids.length < need) return ids;
  const key = (id: string) => { const l = locOf(g, id); return l === 'base' ? `b${g.objects[id]?.controller}` : String(l); };
  const n = new Map<string, number>();
  for (const id of ids) n.set(key(id), (n.get(key(id)) ?? 0) + 1);
  return ids.filter(id => (n.get(key(id)) ?? 0) >= need);
}

/**
 * Deflect surcharge for choosing these objects (CR 809): X power per enemy object with Deflect X. The `ignoreDeflect` rule
 * sees the chooser, the object and every object chosen by the same spell/ability (SF-6: Heisho waives Deflect for the
 * whole payment when anything chosen is at Heisho, RJ#11769/#11783).
 */
export function deflectCost(g: GameState, chooser: PlayerId, ids: string[]): number {
  let n = 0;
  for (const id of ids) {
    const o = g.objects[id];
    if (!o || !onBoard(g, id)) continue;
    if (!isOpponent(g, chooser, o.controller)) continue;
    if (ruleApplies(g, 'ignoreDeflect', chooser, id, ids)) continue;
    n += kwVal(g, id, 'Deflect');
  }
  return n;
}

export function emitTargeted(g: GameState, id: string, by: PlayerId, source: ObjId): void {
  if (!g.objects[id]) return;
  g.ex.counts[`chose:${by}`] = (g.ex.counts[`chose:${by}`] ?? 0) + 1;
  if (isOpponent(g, by, g.objects[id].controller)) {
    g.ex.counts[`choseEnemy:${by}`] = (g.ex.counts[`choseEnemy:${by}`] ?? 0) + 1;
    if (isUnit(g, id)) g.ex.counts[`choseEnemyUnit:${by}`] = (g.ex.counts[`choseEnemyUnit:${by}`] ?? 0) + 1;   // ctx.history('choseEnemyUnit')
  }
  if (g.objects[id]) emit(g, { type: 'targeted', obj: id, player: by, source });
}

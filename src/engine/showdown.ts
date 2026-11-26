// Showdowns (CR 341-348), combat (459-466) and scoring (467-472).
import type { Action, Decision, GameEvent, GameState, ObjId, PlayerId } from './types.ts';
import { unitsAtLoc, dealDamage, heal, recall, moveUnits, allUnits, draw, gainPoints, checkWinNow } from './actions.ts';
import { mightOr0, might, hasKw, chars } from './chars.ts';
import { emit } from './events.ts';
import { ask, registerValidator, chooseOne as chooseOneFn } from './ask.ts';
import { log, cardName, nextPlayer, activePlayers, opponents } from './util.ts';
import { facedownAt, moveToZone } from './state.ts';
import { killLethal } from './cleanup.ts';
import { getDelayed } from '../cards/registry.ts';
import { ruleApplies, victoryScore } from './rules.ts';
import { applyReplacements, takesNoDamage, hasReplacement, damageAfterReplacements, mandatoryReplacements, damageOrderMatters } from './replace.ts';

export function bfName(g: GameState, bf: number): string { return cardName(g, g.battlefields[bf].objId); }

/** Players with units at a battlefield. */
export function playersAt(g: GameState, bf: number): PlayerId[] {
  const s = new Set<PlayerId>();
  for (const u of unitsAtLoc(g, bf)) s.add(g.objects[u].controller);
  return [...s].sort();
}

/** Called when the chain becomes empty (closed -> open). */
export function emptyChain(g: GameState): void {
  const opener = g.ex.chainOpener;
  g.ex.chainOpener = null;
  g.priority = null;
  if (g.showdown && g.showdown.stage === 'open' && opener && !opener.byTrigger) {
    // CR 346.1: focus passes unless the chain was opened by a triggered/resource-adding ability
    g.showdown.focus = nextPlayer(g, opener.player);
    g.showdown.passes = [];
  }
  g.ex.dirty = true;
}

// ---------------- starting ----------------

/** Start one staged showdown/combat (moved here from game.ts so the cleanup can start one, CR 323 steps 9-10). */
export function startStaged(g: GameState): void {
  // CR 323.9 / 461.1: the turn player chooses which staged showdown/combat begins
  // CR 323 steps 9-10: non-combat showdowns are started before combats
  const showdowns = g.ex.staged.filter(s => s.kind === 'showdown');
  const pool = showdowns.length ? showdowns : g.ex.staged;
  let pick = pool[0];
  if (pool.length > 1) {
    const id = chooseOneFn(g, g.activePlayer, 'chooseShowdown', 'Choose which showdown/combat happens first',
      pool.map(s => ({ id: String(s.bf), label: `${s.kind} at ${cardName(g, g.battlefields[s.bf].objId)}`, objIds: [g.battlefields[s.bf].objId] })));
    pick = pool.find(s => String(s.bf) === id)!;
  }
  g.ex.staged = g.ex.staged.filter(s => s !== pick);
  startShowdown(g, pick.bf, pick.kind === 'combat');
  g.ex.dirty = true;
}

export function startShowdown(g: GameState, bf: number, combat: boolean): void {
  const b = g.battlefields[bf];
  const focus = b.contestedBy ?? g.activePlayer;
  g.showdown = { battlefieldIndex: bf, focus, passes: [], isCombat: false, stage: 'open' };
  log(g, focus, `Showdown at ${bfName(g, bf)}`);
  emit(g, { type: 'showdownStart', bf, player: focus });
  if (combat) startCombat(g, bf, true);
}

/** CR 464: open a combat (or turn the current showdown into one). */
export function startCombat(g: GameState, bf: number, fresh: boolean): void {
  const sd = g.showdown!;
  const b = g.battlefields[bf];
  const present = playersAt(g, bf);
  let attacker = b.contestedBy ?? null;
  if (attacker === null || !present.includes(attacker)) attacker = present.find(p => p !== b.controller) ?? present[0];
  const defender = present.find(p => p !== attacker)!;
  sd.isCombat = true;
  sd.attacker = attacker;
  sd.defender = defender;
  if (fresh) sd.focus = attacker;                // 464.2.c.1.a (else focus is kept, .b)
  g.ex.combat = { bf, attackers: [], defenders: [], recalled: false };
  log(g, attacker, `Combat at ${bfName(g, bf)}: ${g.players[attacker].name} attacks, ${g.players[defender].name} defends`);
  emit(g, { type: 'combatStart', bf, attacker, defender });
  assignRoles(g);
}

/** Assign attacker/defender designations to units at the combat battlefield (CR 464.2.c.3, cleanup step 2). */
export function assignRoles(g: GameState): void {
  const sd = g.showdown;
  const c = g.ex.combat;
  if (!sd || !sd.isCombat || !c) return;
  const atk: ObjId[] = [], def: ObjId[] = [];
  for (const u of unitsAtLoc(g, c.bf)) {
    const o = g.objects[u];
    if (o.controller === sd.attacker && o.combatRole !== 'attacker') { o.combatRole = 'attacker'; atk.push(u); }
    else if (o.controller === sd.defender && o.combatRole !== 'defender') { o.combatRole = 'defender'; def.push(u); }
  }
  // units that left the battlefield lose their designation
  for (const id in g.objects) {
    const o = g.objects[id];
    if (o.combatRole && !(o.zone === 'battlefield' && o.battlefieldIndex === c.bf)) o.combatRole = undefined;
  }
  const firstPlayerEvent = c.attackers.length === 0 && c.defenders.length === 0;
  // CR 466.2.d.1: the attack/defend events are simultaneous (one batch); the attacker's triggers go on the chain first and the
  // defender's last (resolve first) — `playerOrder` tells orderTriggers; same-controller triggers (unit + battlefield) are
  // ordered together (CR 383.3.d)
  const m = g.ex.memo ?? (g.ex.memo = {});
  const batch = ((m.__batch as number | undefined) ?? 0) + 1;
  m.__batch = batch; m.__batchType = '__combatRoles';
  const playerOrder = [sd.attacker, sd.defender];
  const evs: GameEvent[] = [];
  if (firstPlayerEvent) evs.push({ type: 'playerAttack', player: sd.attacker, bf: c.bf });
  // a unit that left and re-entered is a new object (new epoch): it gets the designation (and its triggers) again (RJ#149)
  const ep = ((c as { roleEpochs?: Record<ObjId, number> }).roleEpochs ??= {});
  // (keyed by role: a unit taken over mid-combat changes sides and gets the other designation, RJ#6727)
  const fresh = (role: string, u: ObjId) => ep[`${role}:${u}`] !== (g.objects[u].epoch ?? 0);
  const mark = (role: string, u: ObjId) => { ep[`${role}:${u}`] = g.objects[u].epoch ?? 0; };
  const newAtk: ObjId[] = [];
  for (const u of atk) if (fresh('a', u)) { if (!c.attackers.includes(u)) c.attackers.push(u); mark('a', u); newAtk.push(u); evs.push({ type: 'attack', obj: u, bf: c.bf, player: sd.attacker }); }
  // "When one or more friendly units attack here" (Demacian Standard): every time units gain the Attacker designation, also units
  // that join the combat later (Ambush) — unlike the player-level "when you attack" (once per combat) (CR 383.4.e; RJ#12994)
  if (newAtk.length) evs.push({ type: 'unitsAttack', units: newAtk, bf: c.bf, player: sd.attacker });
  if (firstPlayerEvent) evs.push({ type: 'playerDefend', player: sd.defender, bf: c.bf });
  for (const u of def) if (fresh('d', u)) { if (!c.defenders.includes(u)) c.defenders.push(u); mark('d', u); evs.push({ type: 'defend', obj: u, bf: c.bf, player: sd.defender }); }
  for (const e of evs) emit(g, { ...e, batch, playerOrder });
}

// ---------------- showdown flow ----------------

export function showdownPass(g: GameState, p: PlayerId): void {
  const sd = g.showdown!;
  if (!sd.passes.includes(p)) sd.passes.push(p);
  sd.focus = nextPlayer(g, p);
}

export function showdownAllPassed(g: GameState): boolean {
  const sd = g.showdown;
  if (!sd) return false;
  return activePlayers(g).every(p => sd.passes.includes(p));
}

export function closeShowdown(g: GameState): void {
  const sd = g.showdown!;
  sd.stage = 'closing';
  if (sd.isCombat) g.ex.tasks.unshift({ t: 'combatDamage' }, { t: 'combatCleanup' }, { t: 'combatResult' }, { t: 'combatControl' }, { t: 'combatEnd' });
  else g.ex.tasks.unshift({ t: 'showdownEnd' });
}

// ---------------- combat damage ----------------

/**
 * A combat damage recipient. `lethal` null = exempt (it can't be dealt damage, CR 467.2.c.10: skipped in the order, takes only
 * excess). `unreachable` = it can be dealt damage but no amount is lethal (a prevent-all shield, Counter Strike's "prevent the
 * next"): not exempt — it stays in its tier and absorbs the rest once reached (DECISIONS A-3, principle 24). Its `lethal` is then
 * the finite sentinel UNREACHABLE (Decision data is JSON: no Infinity).
 */
export interface AssignTarget { obj: ObjId; lethal: number | null; groups: number[]; unreachable?: boolean }
export const UNREACHABLE = 1e9;

const combatDamageEvent = (g: GameState, u: ObjId, amount: number, assigner?: PlayerId): GameEvent =>
  ({ type: 'damage', obj: u, amount, source: null, player: assigner ?? g.activePlayer, combat: true });
const replOrders = (g: GameState) => (g.ex.combat as { replOrder?: Record<ObjId, string[]> } | null)?.replOrder;

/**
 * CR 373 + 467.2.c.5: when several mandatory replacement effects would apply to the combat damage a unit is dealt and their
 * order changes the outcome for some amount the assigner could give it (lethal amount, damage dealt, which shield is used up),
 * the unit's controller chooses the order before damage is assigned; it then sets the lethal amount (assignTargets) and is used
 * when the damage is dealt (replace.ts applyReplacements). If the order can't matter, nothing is asked.
 */
function chooseDamageOrders(g: GameState, victims: ObjId[], total: number, assigner: PlayerId): void {
  if (total <= 0 || !g.ex.combat) return;
  const amounts = Array.from({ length: Math.min(total, 64) }, (_, i) => i + 1);
  for (const u of victims) {
    const mk = (n: number) => combatDamageEvent(g, u, n, assigner);
    const cands = mandatoryReplacements(g, mk(1));
    if (cands.length < 2 || !damageOrderMatters(g, mk, amounts, cands.map(c => c.id))) continue;
    const order: string[] = [];
    let rest = cands;
    while (rest.length > 1 && damageOrderMatters(g, mk, amounts, rest.map(c => c.id), order)) {
      const id = chooseOneFn(g, g.objects[u].controller, 'chooseOrder',
        `${cardName(g, u)} would be dealt combat damage: choose which replacement effect applies ${order.length ? 'next' : 'first'}`,
        rest.map(c => ({ id: c.id, label: c.label, objIds: c.src ? [c.src, u] : [u] })), { source: u });
      order.push(id);
      rest = rest.filter(c => c.id !== id);
    }
    order.push(...rest.map(c => c.id));
    const c = g.ex.combat as { replOrder?: Record<ObjId, string[]> };
    c.replOrder = { ...(c.replOrder ?? {}), [u]: order };
    log(g, g.objects[u].controller, `${cardName(g, u)}: replacement effects apply in the chosen order`, [u]);
  }
}

export function assignTargets(g: GameState, victims: ObjId[], assigner?: PlayerId): AssignTarget[] {
  const bf = g.ex.combat?.bf;
  const noTank = assigner !== undefined && ruleApplies(g, 'ignoreTank', assigner, bf);
  const lethal1 = (u: ObjId) => assigner !== undefined && ruleApplies(g, 'anyDamageLethal', assigner, u);
  return victims.map(u => {
    const tank = hasKw(g, u, 'Tank') && !noTank, back = hasKw(g, u, 'Backline');
    const groups = tank && back ? [0, 2] : tank ? [0] : back ? [2] : [1];
    const need = lethal1(u) ? 1 : Math.max(1, mightOr0(g, u) - g.objects[u].damage);
    const ev = (amount: number) => combatDamageEvent(g, u, amount, assigner);
    const pref = replOrders(g)?.[u];
    // a unit that can't be dealt damage (Kayn after moving twice) is exempt from the ordering, Tank included (467.2.c.10; RJ#6949)
    if (takesNoDamage(g, ev(1))) return { obj: u, lethal: null, groups };
    // CR 467.2.c.5 (RJ#10022): lethal is computed through the replacement effects that apply to the damage — prevention raises it
    // (3 Might + prevent 2 → 5), Lotus Trap's doubling lowers it (4 → 2); none lethal at any amount → unreachable, not exempt
    if (!hasReplacement(g, ev(need))) return { obj: u, lethal: need, groups };
    for (let n = 1; n <= need + 64; n++) if (damageAfterReplacements(g, ev(n), pref) >= need) return { obj: u, lethal: n, groups };
    return { obj: u, lethal: UNREACHABLE, groups, unreachable: true };
  });
}

function validFor(ts: AssignTarget[], groups: number[], total: number, a: Record<ObjId, number>): boolean {
  const all = ts.map((t, i) => ({ ...t, g: groups[i], v: a[t.obj] ?? 0 }));
  const live = all.filter(t => t.lethal !== null);
  const nonFull = live.filter(t => t.v < (t.lethal as number));
  if (nonFull.length === 0) return true;
  // CR 467.2.c.10 (DECISIONS A-3): an exempt unit receives damage only as excess, once every other unit has lethal
  if (all.some(t => t.lethal === null && t.v > 0)) return false;
  const gmin = Math.min(...nonFull.map(t => t.g));
  for (const t of live) {
    if (t.g > gmin && t.v > 0) return false;
    if (t.v > (t.lethal as number)) return false;        // no overkill unless everything is lethal
  }
  const partial = live.filter(t => t.g === gmin && t.v > 0 && t.v < (t.lethal as number));
  if (partial.length > 1) return false;
  void total;
  return true;
}

export function validateAssignment(ts: AssignTarget[], total: number, a: Record<ObjId, number>): string | null {
  const ids = new Set(ts.map(t => t.obj));
  let sum = 0;
  for (const [k, v] of Object.entries(a)) {
    if (!ids.has(k)) return `${k} is not a legal recipient`;
    if (!Number.isInteger(v) || v < 0) return 'amounts must be non-negative integers';
    sum += v;
  }
  if (ts.length > 0 && sum !== total) return `must assign exactly ${total} damage (assigned ${sum})`;
  const conflicted = ts.map((t, i) => (t.groups.length > 1 ? i : -1)).filter(i => i >= 0);
  const combos = 1 << conflicted.length;
  for (let m = 0; m < combos; m++) {
    const groups = ts.map(t => t.groups[0]);
    conflicted.forEach((i, k) => { groups[i] = ts[i].groups[(m >> k) & 1]; });
    if (validFor(ts, groups, total, a)) return null;
  }
  return 'assignment breaks the lethal-damage ordering (Tank first, Backline last, lethal before moving on)';
}

/** A valid greedy assignment: kill as many units as possible in priority order. */
export function suggestAssignment(ts: AssignTarget[], total: number): Record<ObjId, number> {
  const a: Record<ObjId, number> = {};
  if (ts.length === 0 || total <= 0) return a;
  const order = [...ts].sort((x, y) => (x.groups[0] - y.groups[0]) || ((x.lethal ?? 1e9) - (y.lethal ?? 1e9)));
  let left = total;
  for (const t of order) {
    if (t.lethal === null) continue;
    const n = Math.min(left, t.lethal);
    if (n > 0) a[t.obj] = n;
    left -= n;
    if (left <= 0) break;
  }
  if (left > 0) { const first = order.find(t => t.lethal !== null) ?? order[0]; a[first.obj] = (a[first.obj] ?? 0) + left; }
  return a;
}

registerValidator('assignDamage', (g, d, act) => {
  if (act.type !== 'assignDamage') return 'expected an assignDamage action';
  const ts = d.data!.targets as AssignTarget[];
  return validateAssignment(ts, d.data!.total as number, act.assignment);
});

function forced(ts: AssignTarget[], total: number): Record<ObjId, number> | null {
  if (ts.length === 1) return { [ts[0].obj]: total };
  const live = ts.filter(t => t.lethal !== null);
  if (live.length === 0) return suggestAssignment(ts, total);
  const minG = Math.min(...live.map(t => Math.min(...t.groups)));
  const first = live.filter(t => t.groups.includes(minG));
  if (first.length === 1 && first[0].groups.length === 1 && total <= (first[0].lethal as number)) return { [first[0].obj]: total };
  return null;
}

// CR 465.2.a/b: sum of Might; stunned units contribute nothing (423)
const combatTotal = (g: GameState, units: ObjId[]) =>
  units.reduce((s, u) => s + (g.objects[u].stunned || ruleApplies(g, 'noCombatDamage', u) ? 0 : mightOr0(g, u)), 0);

function assignFor(g: GameState, p: PlayerId, attackers: ObjId[], victims: ObjId[]): Record<ObjId, number> {
  const total = combatTotal(g, attackers);
  if (total <= 0 || victims.length === 0) return {};
  const ts = assignTargets(g, victims, p);
  const record = (a: Record<ObjId, number>) => {
    let excess = 0;
    for (const t of ts) if (t.lethal !== null) excess += Math.max(0, (a[t.obj] ?? 0) - t.lethal);
    g.ex.turnFacts[`excess:${p}`] = excess;
    if (g.ex.combat) (g.ex.combat as { excess?: Record<string, number> }).excess = { ...((g.ex.combat as { excess?: Record<string, number> }).excess ?? {}), [p]: excess };
    if (g.ex.combat) (g.ex.combat as { assigned?: Record<string, unknown> }).assigned = { ...((g.ex.combat as { assigned?: Record<string, unknown> }).assigned ?? {}), [p]: a };
    return a;
  };
  const f = forced(ts, total);
  if (f) return record(f);
  const act = ask(g, {
    kind: 'assignDamage', player: p, prompt: `Assign ${total} combat damage`, min: 0, max: 0,
    data: { total, targets: ts, validator: 'assignDamage', suggested: suggestAssignment(ts, total) },
  });
  return record(act.type === 'assignDamage' ? act.assignment : suggestAssignment(ts, total));
}

export function combatDamageTask(g: GameState): void {
  const sd = g.showdown!;
  const c = g.ex.combat!;
  const atk = unitsAtLoc(g, c.bf).filter(u => g.objects[u].combatRole === 'attacker');
  const def = unitsAtLoc(g, c.bf).filter(u => g.objects[u].combatRole === 'defender');
  if (atk.length === 0 || def.length === 0) return;   // CR 465.1
  chooseDamageOrders(g, def, combatTotal(g, atk), sd.attacker!);
  chooseDamageOrders(g, atk, combatTotal(g, def), sd.defender!);
  const aAssign = assignFor(g, sd.attacker!, atk, def);
  const dAssign = assignFor(g, sd.defender!, def, atk);
  // dealt simultaneously once all is assigned (465.2.c.1.a)
  dealDamage(g, { player: sd.attacker!, combat: true }, Object.entries(aAssign).map(([id, amount]) => ({ id, amount })));
  dealDamage(g, { player: sd.defender!, combat: true }, Object.entries(dAssign).map(([id, amount]) => ({ id, amount })));
  delete (c as { replOrder?: unknown }).replOrder;
  // CR 467.3: skip FEPR and go straight to the resolution step's combat special cleanup
  const i = g.ex.tasks.findIndex(t => t.t === 'combatCleanup');
  if (i >= 0) g.ex.tasks.splice(i, 1);
  combatCleanupTask(g);
}

/** CR 466.1: combat cleanup = normal cleanup + heal all units (3c) + recall attackers if defenders remain (3d). */
export function combatCleanupTask(g: GameState): void {
  if (!g.ex.combat) return;
  // CR 468.1.a (special combat cleanup): 3a kill lethally damaged units once, 3c heal all units, 3d recall attackers. A unit
  // that becomes lethal only because another unit died in 3a (Darius, Executioner / Garen, Commander +1 lost) is healed
  // in 3c, not killed (RJ#2736, RJ#7983); the regular cleanup runs afterwards.
  if (checkWinNow(g)) return;
  killLethal(g);
  const c = g.ex.combat!;
  heal(g, allUnits(g));
  const atk = unitsAtLoc(g, c.bf).filter(u => g.objects[u].combatRole === 'attacker');
  const def = unitsAtLoc(g, c.bf).filter(u => g.objects[u].combatRole === 'defender');
  if (atk.length && def.length) {
    // both sides still have units: a tie (OGN-FAQ); "recall ALL units instead" (Symbol of the Solari, rule tieRecallAll; RJ#3123)
    const all = ruleApplies(g, 'tieRecallAll', g.showdown!.attacker, c.bf);
    recall(g, all ? [...atk, ...def] : atk); c.recalled = true;
    log(g, g.showdown!.attacker!, all ? 'Tie: all units return to base' : 'Attackers return to base');
  }
}

export function combatResultTask(g: GameState): void {
  const sd = g.showdown!;
  const c = g.ex.combat!;
  const present = playersAt(g, c.bf);
  let winner: PlayerId | null = null, loser: PlayerId | null = null;
  if (!c.recalled && present.length === 1 && (present[0] === sd.attacker || present[0] === sd.defender)) {
    winner = present[0];
    loser = winner === sd.attacker ? sd.defender! : sd.attacker!;
  } else if (c.recalled) { /* no result */ }
  else if (present.length === 0) { /* no result */ }
  emit(g, { type: 'combatResult', bf: c.bf, winner, loser, attacker: sd.attacker, defender: sd.defender, recalled: c.recalled });
}

export function combatControlTask(g: GameState): void {
  const c = g.ex.combat!;
  establishControlAfter(g, c.bf);
}

function establishControlAfter(g: GameState, bf: number): void {
  const b = g.battlefields[bf];
  const present = playersAt(g, bf);
  b.contested = false;
  b.contestedBy = null;
  if (present.length === 1) {
    const p = present[0];
    if (b.controller !== p) {
      g.ex.turnFacts[`prevController:${bf}`] = b.controller;
      b.controller = p;
      log(g, p, `${g.players[p].name} takes control of ${bfName(g, bf)}`);
      emit(g, { type: 'controlGained', bf, player: p });
      score(g, p, bf, 'conquer');
    }
  } else if (present.length === 0) {
    if (b.controller !== null) emit(g, { type: 'controlLost', bf, player: b.controller });
    b.controller = null;
  }
  const fd = facedownAt(g, bf);
  if (fd && g.objects[fd].controller !== b.controller) { moveToZone(g, fd, 'trash'); log(g, null, `A hidden card at ${bfName(g, bf)} is discarded`); }
  g.ex.dirty = true;
}

export function combatEndTask(g: GameState): void {
  const c = g.ex.combat!;
  for (const id in g.objects) g.objects[id].combatRole = undefined;
  emit(g, { type: 'combatEnd', bf: c.bf });
  expire(g, 'endOfCombat');
  g.showdown = null;
  g.ex.combat = null;
  g.ex.dirty = true;
}

export function showdownEndTask(g: GameState): void {
  const sd = g.showdown!;
  const bf = sd.battlefieldIndex;
  emit(g, { type: 'showdownEnd', bf });
  establishControlAfter(g, bf);
  g.showdown = null;
  g.ex.dirty = true;
}

/** Expire "this turn"/"this combat" modifiers and delayed abilities. */
export function expire(g: GameState, what: 'endOfTurn' | 'endOfCombat'): void {
  for (const id in g.objects) {
    const o = g.objects[id];
    if (o.modifiers.length) o.modifiers = o.modifiers.filter(m => m.duration !== what && !(what === 'endOfTurn' && m.duration === 'endOfCombat'));
  }
  g.ex.delayed = g.ex.delayed.filter(d => {
    if (d.expires === what) return false;
    if (what === 'endOfTurn' && d.expires === 'endOfCombat') return false;
    if (what === 'endOfTurn' && d.expires === 'nextTurnEnd' && d.turn < g.turn) return false;
    return true;
  });
  void getDelayed;
}

// ---------------- scoring ----------------

/** CR 469-471: conquer/hold. Returns true if the battlefield was scored. */
export function score(g: GameState, p: PlayerId, bf: number, how: 'conquer' | 'hold'): boolean {
  const b = g.battlefields[bf];
  if (b.scoredThisTurnBy.includes(p)) return false;            // CR 470
  if (g.mode === '2v2') {
    // CR 491.8.b: once per team per turn; 491.8.b.1: battlefields the turn player's teammate controlled in this turn's Scoring
    // Step are disqualified for that team this turn (only the turn player's team — RJ#572)
    if (b.scoredThisTurnBy.some(q => q % 2 === p % 2)) return false;
    if (((g.ex.turnFacts[`teamDisq:${bf}`] as number[] | undefined) ?? []).includes(p % 2)) { log(g, p, `${bfName(g, bf)} was controlled by ${g.players[p].name}'s teammate in the Scoring Step: can't be scored by their team this turn`); return false; }
  }
  if (ruleApplies(g, 'cantScore', p, bf)) { log(g, p, `${g.players[p].name} can't score ${bfName(g, bf)}`); return false; }
  const rep = applyReplacements(g, { type: 'score', player: p, bf, how });
  if (!rep) return false;
  b.scoredThisTurnBy.push(p);
  const pl = g.players[p];
  if (how === 'conquer') { const k = `conquered:${p}`; g.ex.turnFacts[k] = [...((g.ex.turnFacts[k] as number[] | undefined) ?? []), bf]; g.ex.counts[k] = (g.ex.counts[k] ?? 0) + 1; }
  if (rep.type !== 'score') {
    // replaced (e.g. "draw 1 instead"): score triggers still fire (CR 383.4.c.3)
    emit(g, { type: how, player: p, bf, units: unitsAtLoc(g, bf).filter(u => g.objects[u].controller === p), replaced: true });
    if (rep.type === 'draw') draw(g, p, Number(rep.n ?? 1));
    return true;
  }
  emit(g, { type: how, player: p, bf, units: unitsAtLoc(g, bf).filter(u => g.objects[u].controller === p), prevController: how === 'conquer' ? (g.ex.turnFacts[`prevController:${bf}`] ?? null) : p, excess: how === 'conquer' ? Number(g.ex.turnFacts[`excess:${p}`] ?? 0) : 0 });
  emit(g, { type: 'score', player: p, bf, how });
  // CR 471.1.b: the final point via conquer needs every battlefield scored this turn
  if (how === 'conquer' && pl.points + 1 >= victoryScore(g)) {
    // 2v2 (CR 491.8.b, 491.8.g.1): the team scores each battlefield once, so a battlefield scored by the team counts; on their
    // own or a teammate's turn, battlefields an ally occupied in that turn's Scoring Step are excepted (turn.ts holdStep)
    const team = g.mode === '2v2' ? g.players.map(x => x.id).filter(q => q % 2 === p % 2) : [p];
    const excepted = new Set(team.filter(q => q !== p).flatMap(q => (g.ex.turnFacts[`allyOcc2v2:${q}`] as number[] | undefined) ?? []));
    const all = g.battlefields.every((x, i) => x.scoredThisTurnBy.some(q => team.includes(q)) || excepted.has(i));
    if (!all) {
      log(g, p, `${pl.name} conquers ${bfName(g, bf)} but hasn't scored every battlefield this turn: draws a card instead of the final point`);
      draw(g, p, 1);
      return true;
    }
  }
  log(g, p, `${pl.name} ${how === 'conquer' ? 'conquers' : 'holds'} ${bfName(g, bf)}`);
  const got = gainPoints(g, p, 1, how, bf);
  if (how === 'hold' && got) g.ex.counts[`holdPoints:${p}`] = (g.ex.counts[`holdPoints:${p}`] ?? 0) + got;
  return true;
}

export { might, chars, moveUnits, opponents };
export type { Action, Decision };

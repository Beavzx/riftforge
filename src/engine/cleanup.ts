// Cleanups (CR 318-324). Repeated until nothing changes.
import type { GameState, ObjId, PlayerId } from './types.ts';
import { allUnits, kill, unitsAtLoc, recall, checkWinNow, trackMighty, detach } from './actions.ts';
import { might, isUnit, isGear, hasKw, withCharsMemo } from './chars.ts';
import { facedownAt, moveToZone, isBattlefieldCard, permanentsAt } from './state.ts';
import { assignRoles, playersAt, startCombat, startStaged } from './showdown.ts';
import { emit, hasQueuedTriggers } from './events.ts';
import { log, isOpponent, cardName } from './util.ts';
import { ruleSum } from './rules.ts';
import { chooseOptions } from './ask.ts';
import { anyDamageLethal } from './rules.ts';

/** One pass of the cleanup steps (no showdown start). Returns true if anything changed. */
/**
 * CR 323.11-323.12 (DECISIONS #3694, #1317, #11019): may a staged showdown/combat begin now? Neutral Open (no showdown, empty chain,
 * no pending items), no decision pending; in the Ending Phase (before Expiration, whose turn tasks wait, RJ#1317), in the
 * Awaken/Beginning/Channel/Draw phases (before the remaining start-of-turn tasks: CR 308-310 "At any given time" the turn is in one of
 * the four states, with no phase condition — DECISIONS #11019 / #9254, ENGINE-9; verified RJ#9254's "the Beginning Phase is not a
 * Neutral Open State" → MISMATCH-RJ) or in the Action phase once no turn tasks are left — the same phases as game.ts advance.
 */
export const STAGE_PHASES = new Set(['end', 'awaken', 'beginning', 'channel', 'draw']);
export function stagedMayBegin(g: GameState): boolean {
  if (g.ex.staged.length === 0 || g.showdown || g.chain.length > 0 || hasQueuedTriggers(g) || g.winner !== null || g.pending) return false;
  if (g.phase === 'action') return g.ex.tasks.length === 0;
  return STAGE_PHASES.has(g.phase);
}

/** `noStart`: don't begin staged showdowns here (the Expiration step's own cleanup, CR 317.2; the main loop begins them after). */
export function cleanupSteps(g: GameState, o: { noStart?: boolean } = {}): boolean {
  let changed = false;
  for (let guard = 0; guard < 25; guard++) {
    let c = false;
    // 1. victory
    if (checkWinNow(g)) return true;
    trackMighty(g);                                  // R-11
    // F-6 (CR 143.5 / 435.1.h): units can never be attached — a gear that became a unit is detached
    if (g.ex.attachCount) for (const id in g.objects) { const o = g.objects[id]; if (o.attachedTo && isUnit(g, id)) { detach(g, id); c = true; } }
    // 2. attacker / defender designations
    if (g.showdown?.isCombat && g.ex.combat) assignRoles(g);
    // 3+4. lethally damaged units die (Deathknell queued before they move, in kill())
    if (killLethal(g)) c = true;
    const open = g.chain.length === 0 && !hasQueuedTriggers(g);   // R-16: pending items keep the state closed
    // 5. lose control of battlefields without units (open state, no showdown/combat there)
    if (open) g.battlefields.forEach((b, i) => {
      if (b.controller === null) return;
      if (g.showdown && g.showdown.battlefieldIndex === i) return;
      if (!unitsAtLoc(g, i).some(u => g.objects[u].controller === b.controller)) {
        emit(g, { type: 'controlLost', bf: i, player: b.controller });
        log(g, b.controller, `${g.players[b.controller].name} loses control of a battlefield`);
        b.controller = null; c = true;
      }
    });
    // 6. recalls: unattached non-unit gear at battlefields (not Deploy), hidden cards at battlefields you don't control
    g.battlefields.forEach((b, i) => {
      for (const id of permanentsAt(g, i)) {
        const o = g.objects[id];
        if (isUnit(g, id) || !isGear(g, id) || o.attachedTo) continue;
        if (hasKw(g, id, 'Deploy')) continue;   // CR 830: not recalled (killed by its hold trigger instead)
        recall(g, [id]); c = true;
      }
      const fd = facedownAt(g, i);
      if (fd && g.objects[fd].controller !== b.controller) { moveToZone(g, fd, 'trash'); log(g, null, 'A hidden card is discarded (battlefield not controlled)'); c = true; }
      // CR 107.3.b.2 (RJ#13071, ENGINE-9): a Facedown Zone holding more cards than its maximum occupancy (1 + extraHide: Bushwhack
      // Trap left the board) — its controller trashes the difference (not a kill)
      // Only when the maximum DROPPED (CR 107.3.b.2 "when … maximum occupancy drops below"): the last maximum is kept per
      // battlefield (`fdMax`), so states set up with more cards than the maximum aren't changed.
      const bm = b as { fdMax?: number };
      const max = b.controller === null ? 1 : 1 + ruleSum(g, 'extraHide', b.controller, i);
      const prevMax = bm.fdMax;
      if (max > 1 || prevMax !== undefined) bm.fdMax = max;
      if (bm.fdMax === 1 && max === 1 && prevMax === 1) delete bm.fdMax;
      if (fd && g.objects[fd].controller === b.controller && b.controller !== null && prevMax !== undefined && max < prevMax) {
        const fds = Object.keys(g.objects).filter(id => g.objects[id].zone === 'facedown' && g.objects[id].battlefieldIndex === i);
        if (fds.length > max) {
          const n = fds.length - max;
          const pick = chooseOptions(g, b.controller, 'chooseCards', `Too many hidden cards at ${cardName(g, b.objId)}: trash ${n}`, fds.map(id => ({ id, label: cardName(g, id), objIds: [id] })), n, n);
          for (const id of pick) moveToZone(g, id, 'trash');
          log(g, b.controller, `${g.players[b.controller].name} trashes ${n} hidden card${n > 1 ? 's' : ''} (facedown zone over its maximum)`);
          c = true;
        }
      }
    });
    // "while [source] is on the board" effects end when the source leaves the board or becomes a new object
    for (const id in g.objects) {
      const o = g.objects[id];
      if (!o.modifiers.length) continue;
      const keep = o.modifiers.filter(m => {
        if (m.duration !== 'whileSource' || !m.source) return true;
        const s = g.objects[m.source];
        return !!s && (s.zone === 'base' || s.zone === 'battlefield' || s.zone === 'legendZone') && (m.data?.srcEpoch === undefined || (s.epoch ?? 0) === m.data.srcEpoch);
      });
      if (keep.length !== o.modifiers.length) { o.modifiers = keep; c = true; }
    }
    const nd = g.ex.delayed.filter(d => {
      if (d.expires !== 'whileSource' || !d.source) return true;
      const s = g.objects[d.source];
      return !!s && (s.zone === 'base' || s.zone === 'battlefield' || s.zone === 'legendZone') && (d.sourceEpoch === undefined || (s.epoch ?? 0) === d.sourceEpoch);
    });
    if (nd.length !== g.ex.delayed.length) { g.ex.delayed = nd; c = true; }
    // runes are never at battlefields; base arrays are kept per controller by construction
    // 7/8. staging and contested removal
    g.battlefields.forEach((b, i) => {
      const present = playersAt(g, i);
      const ongoingHere = g.showdown && g.showdown.battlefieldIndex === i;
      if (b.contested && !ongoingHere) {
        const cb = b.contestedBy;
        if (cb === null || cb === undefined || !present.includes(cb)) {
          if (present.length < 2) {
            b.contested = false; b.contestedBy = null; c = true;
            // 8a: units left at an uncontested battlefield their controller doesn't control re-apply Contested
            if (present.length === 1 && b.controller !== present[0]) { b.contested = true; b.contestedBy = present[0]; }
          }
        }
      }
      if (ongoingHere) {
        // CR 460.1: an open showdown here becomes a combat showdown when opposing units are present
        if (!g.showdown!.isCombat && present.length >= 2 && g.chain.length === 0 && !hasQueuedTriggers(g) && g.showdown!.stage === 'open') { startCombat(g, i, false); c = true; }
        return;
      }
      const already = g.ex.staged.find(s => s.bf === i);
      let kind: 'showdown' | 'combat' | null = null;
      if (present.length >= 2) kind = 'combat';
      else if (b.contested && present.length === 1 && present[0] === b.contestedBy && b.controller !== b.contestedBy) kind = 'showdown';
      if (kind) {
        if (!already) { g.ex.staged.push({ bf: i, kind }); c = true; }
        else if (already.kind !== kind) { already.kind = kind; c = true; }
      } else if (already) { g.ex.staged = g.ex.staged.filter(s => s.bf !== i); c = true; }
    });
    // stray objects: units/gear in a base array of another player are fixed by reseat() at control change
    // CR 323.11-323.12 + CR 322 (DECISIONS #3694): in a Neutral Open state a staged showdown/combat begins in THIS cleanup; the
    // repeated cleanup (this loop's next pass) then runs with it ongoing (Sett, Kingpin dying only in the repeat still sees a combat
    // begin: Volibear's "When I attack" triggers). Also in the Ending Phase (ENGINE-8, RJ#1317),
    // also when this pass changed nothing (it was staged while the state was Closed): a repeat pass then follows.
    if (!o.noStart && stagedMayBegin(g)) { startStaged(g); c = true; }
    if (!c) break;
    changed = true;
    if (g.winner !== null) break;
  }
  return changed;
}

/** Cleanup step 3/4: kill every lethally damaged unit, simultaneously (one pass). Returns true if any died. */
export function killLethal(g: GameState): boolean {
  const lethal: ObjId[] = [];
  withCharsMemo(g, () => {
    for (const u of allUnits(g)) {
      const o = g.objects[u];
      if (o.damage <= 0) continue;
      const m = might(g, u) ?? 0;
      if (o.damage >= Math.max(0, m) || anyDamageLethal(g, u)) lethal.push(u);
    }
  });
  // CR 429.5.c/c.1 (RJ#3646): a cleanup kill is attributed to the source whose damage was dealt since the previous cleanup (the
  // spell that resolved immediately prior); damage marked earlier (a Falling Comet the unit survived) makes no spell responsible
  const fresh = (u: ObjId) => { const s = g.ex.damageSrc[u]; return s && !s.stale ? s : s ? { player: s.player, combat: s.combat } : undefined; };
  const markStale = () => { for (const k in g.ex.damageSrc) g.ex.damageSrc[k].stale = true; };
  if (!lethal.length) { markStale(); return false; }
  // attribution: the source that dealt the damage (CR 428.4)
  const byPlayer = new Map<string, ObjId[]>();
  for (const u of lethal) {
    const s = g.ex.damageSrc[u];
    const k = s ? `${s.player}|${s.obj ?? ''}|${s.combat ? 1 : 0}` : '||0';
    byPlayer.set(k, [...(byPlayer.get(k) ?? []), u]);
  }
  const all: ObjId[] = [];
  for (const [k, ids] of byPlayer) { void k; all.push(...ids); }
  // kill simultaneously; attribute per first source
  const s0 = fresh(lethal[0]);
  kill(g, all, s0 ? { player: s0.player, obj: (s0 as { obj?: ObjId }).obj, combat: s0.combat } : undefined);
  markStale();
  return true;
}

export function cleanup(g: GameState): void {
  cleanupSteps(g);
}

export { isBattlefieldCard };
export type { PlayerId };

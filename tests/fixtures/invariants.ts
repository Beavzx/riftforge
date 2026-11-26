// State invariants checked by the fuzzer after every action.
import type { GameState, ObjId, PlayerId, PlayerView } from '../../src/engine/types.ts';
import { getLegalActions, getView } from '../../src/engine/game.ts';
import { hiddenIdsFor, zoneInstance } from '../../src/engine/hidden-ids.ts';
import { might, isUnit } from '../../src/engine/chars.ts';

export function checkInvariants(g: GameState): string[] {
  const errs: string[] = [];
  const seen = new Map<ObjId, string>();
  for (const p of g.players) {
    const arrays: [string, ObjId[], string][] = [
      ['hand', p.hand, 'hand'], ['mainDeck', p.mainDeck, 'mainDeck'], ['runeDeck', p.runeDeck, 'runeDeck'], ['trash', p.trash, 'trash'],
      ['banishment', p.banishment, 'banishment'], ['base', p.base, 'base'], ['runesInPlay', p.runesInPlay, 'runePool'], ['championZone', p.championZone, 'championZone'],
    ];
    for (const [name, arr, zone] of arrays) for (const id of arr) {
      const o = g.objects[id];
      if (!o) { errs.push(`${name} of p${p.id} has missing object ${id}`); continue; }
      if (o.zone !== zone) errs.push(`${id} in ${name} array but zone=${o.zone}`);
      if (seen.has(id)) errs.push(`${id} in two arrays (${seen.get(id)}, ${name})`);
      seen.set(id, name);
      if (['hand', 'mainDeck', 'runeDeck', 'trash', 'banishment', 'championZone'].includes(zone) && o.owner !== p.id) errs.push(`${id} in p${p.id} ${name} but owned by p${o.owner}`);
      if ((zone === 'base' || zone === 'runePool') && o.controller !== p.id) errs.push(`${id} in p${p.id} ${name} but controlled by p${o.controller}`);
    }
    if (p.points < 0) errs.push(`p${p.id} negative points`);
    if (p.pool.energy < 0) errs.push(`p${p.id} negative energy`);
  }
  for (const o of Object.values(g.objects)) {
    if (['hand', 'mainDeck', 'runeDeck', 'trash', 'banishment', 'base', 'runePool', 'championZone'].includes(o.zone) && !seen.has(o.id)) errs.push(`${o.id} zone ${o.zone} but not in any array`);
    if (o.zone === 'battlefield' && (o.battlefieldIndex === undefined || !g.battlefields[o.battlefieldIndex])) errs.push(`${o.id} at invalid battlefield ${o.battlefieldIndex}`);
    if (o.damage < 0) errs.push(`${o.id} negative damage`);
    if (o.attachedTo) {
      const h = g.objects[o.attachedTo];
      if (!h) errs.push(`${o.id} attached to missing ${o.attachedTo}`);
      else if (h.zone !== o.zone || h.battlefieldIndex !== o.battlefieldIndex) errs.push(`${o.id} attached but not at host location`);
    }
    // a token being played stays set aside while a decision about its own play is pending (Accelerate granted by Rek'Sai,
    // Breacher — actions.ts createTokenRaw, ENGINE-4 fuzz 2022100893; ENGINE-5 fuzz 0a6ca849a3)
    const beingPlayed = o.zone === 'setAside' && g.pending?.source === o.id;
    if (o.isToken && !beingPlayed && !['base', 'battlefield', 'chain', 'facedown'].includes(o.zone)) errs.push(`token ${o.id} in ${o.zone}`);
  }
  if (g.winner === null) {
    if (!g.pending) errs.push('no pending decision and no winner');
    else if (getLegalActions(g, g.pending.player).length === 0) errs.push(`no legal actions for pending ${g.pending.kind}`);
  }
  if (g.winner === null && g.pending && !g.pending.inStep && g.chain.length === 0) {
    for (const id in g.objects) {
      const o = g.objects[id];
      if ((o.zone === 'base' || o.zone === 'battlefield') && isUnit(g, id) && o.damage > 0 && o.damage >= Math.max(0, might(g, id) ?? 0)) errs.push(`unit ${id} with lethal damage survived a cleanup`);
    }
    if (!g.showdown && g.pending.kind === 'mainAction') g.battlefields.forEach((b, i) => {
      if (b.controller === null) return;
      const has = Object.values(g.objects).some(o => o.zone === 'battlefield' && o.battlefieldIndex === i && o.controller === b.controller && isUnit(g, o.id));
      if (!has) errs.push(`battlefield ${i} controlled by p${b.controller} without units in open state`);
    });
  }
  return errs;
}

// ---------------------------------------------------------------- HIDDEN-IDS (BX-5): opaque ids for hidden objects

const ZONE_ARRAYS = ['hand', 'mainDeck', 'runeDeck', 'trash', 'banishment', 'base', 'runesInPlay', 'championZone'] as const;

/** Every token that looks like an engine object id ("o42") in a value's JSON. */
export function idTokens(v: unknown): Set<string> {
  return new Set(JSON.stringify(v).match(/(?<![A-Za-z0-9_])o\d+(?![A-Za-z0-9_])/g) ?? []);
}

/** Hidden aliases in a view, by hidden zone instance. */
export function viewHiddenZones(v: PlayerView): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [id, o] of Object.entries(v.state.objects)) {
    if (o.cardId !== 'hidden') continue;
    const k = zoneInstance(o);
    let s = out.get(k); if (!s) out.set(k, s = new Set()); s.add(id);
  }
  return out;
}

/**
 * getView id redaction for one viewer (HIDDEN-IDS):
 *  - no internal id of an object hidden from the viewer appears anywhere in the view (objects, zone arrays, log refs,
 *    chain, decision, legal actions, engine bookkeeping), and neither do the seed, the view key or the alias record;
 *  - every hidden object is in the view exactly once, under an alias that isn't an engine id nor an id the viewer has
 *    seen for a public object (`seenPublic`), with nothing but location data;
 *  - zone arrays have the real lengths and list hidden members in alias order;
 *  - legal actions only name objects the view shows face up;
 *  - `prevView` (the view of the state before the step): a hidden zone instance that gained a member is re-aliased as a
 *    whole, so set difference can't tell which alias is the card that went in.
 */
export function checkViewIds(g: GameState, viewer: PlayerId, v: PlayerView = getView(g, viewer), seenPublic?: Set<ObjId>, prevView?: PlayerView): string[] {
  const errs: string[] = [];
  const masked = g.ex.cancelFor !== undefined && g.ex.cancelFor !== viewer && !!g.pending?.inStep && !!g.ex.unit;
  const ref = masked ? g.ex.unit!.base : g;            // UI-CANCEL: others are shown the board from before the play
  const hidden = hiddenIdsFor(ref, viewer);
  const toks = idTokens(v);
  for (const id of hidden) if (toks.has(id)) {
    const js = JSON.stringify(v); const at = js.search(new RegExp(`(?<![A-Za-z0-9_])${id}(?![A-Za-z0-9_])`));
    errs.push(`view p${viewer}: internal id of hidden ${ref.objects[id].zone} object ${id} appears: ${js.slice(Math.max(0, at - 70), at + 20)}`);
  }
  const ex = v.state.ex as Partial<GameState['ex']> | undefined;
  if (ex?.viewKey !== undefined || ex?.hid !== undefined) errs.push(`view p${viewer}: view key / alias record shipped`);
  if (v.state.seed !== 0) errs.push(`view p${viewer}: seed shipped`);
  const aliases = Object.entries(v.state.objects).filter(([, o]) => o.cardId === 'hidden');
  if (aliases.length !== hidden.size) errs.push(`view p${viewer}: ${aliases.length} hidden objects in the view, ${hidden.size} in the state`);
  for (const [al, o] of aliases) {
    if (/^o\d+$/.test(al) || o.id !== al) errs.push(`view p${viewer}: hidden object listed as ${al} (id ${o.id})`);
    if (seenPublic?.has(al)) errs.push(`view p${viewer}: alias ${al} equals an id seen for a public object`);
    if (o.modifiers.length || Object.keys(o.counters).length || o.epoch !== undefined || o.timestamp !== 0 || o.attachedTo || o.derived) errs.push(`view p${viewer}: hidden object ${al} carries state ${JSON.stringify(o).slice(0, 120)}`);
  }
  ref.players.forEach((p, i) => {
    const vp = v.state.players[i];
    for (const z of ZONE_ARRAYS) {
      if (vp[z].length !== p[z].length) errs.push(`view p${viewer}: p${i} ${z} has ${vp[z].length} entries, state ${p[z].length}`);
      const hid = vp[z].filter(id => v.state.objects[id]?.cardId === 'hidden');
      for (const id of vp[z]) if (!v.state.objects[id]) errs.push(`view p${viewer}: p${i} ${z} lists ${id}, not in the view's objects`);
      if (hid.some((id, k) => k > 0 && hid[k - 1] > id)) errs.push(`view p${viewer}: p${i} ${z} hidden members not in alias order`);
    }
  });
  // legal actions only name objects shown face up (an action must never need an id the player can't see)
  for (const t of idTokens(v.legal)) if (!v.state.objects[t] || v.state.objects[t].cardId === 'hidden') errs.push(`view p${viewer}: legal action names ${t}, not visible to the player`);
  if (prevView) {
    const before = new Set(Object.keys(prevView.state.objects));
    for (const [k, ids] of viewHiddenZones(v)) {
      const fresh = [...ids].filter(id => !before.has(id));
      if (fresh.length && fresh.length !== ids.size) errs.push(`view p${viewer}: ${k} gained ${fresh.length} hidden member(s) but kept ${ids.size - fresh.length} old alias(es)`);
    }
  }
  return errs;
}

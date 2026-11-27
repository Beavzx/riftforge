// Game actions (CR 407-444). Every state change that cards can cause goes through here so that
// replacement effects apply and events are emitted for triggers.
import type { CardId, Domain, GameEvent, GameState, Modifier, ObjId, PlayerId } from './types.ts';
import { emit, abilityFromKey, type QueuedTrigger } from './events.ts';
import { applyReplacements, hasReplacement } from './replace.ts';
import { moveToZone, setLocation, locOf, reseat, type Loc, isBattlefieldCard } from './state.ts';
import { chars, isUnit, might, attachedTo, onBoard, withCharsMemo, memoInScope } from './chars.ts';
import { log, cardName, opponents, nextPlayer, teamOf, isOpponent, turnOrderFrom } from './util.ts';
import { shuffle } from './rng.ts';
import { ruleApplies, victoryScore, anyDamageLethal } from './rules.ts';
import { chooseOptions, chooseOrder, chooseOne } from './ask.ts';

// ---------------- helpers ----------------

export function lki(g: GameState, id: ObjId): Record<string, unknown> {
  const o = g.objects[id];
  if (!o) return { obj: id };
  const c = chars(g, id);
  const loc = locOf(g, id);
  let alone = false;
  if (loc !== null && c.type === 'Unit') {
    alone = !unitsAtLoc(g, loc, o.controller).some(u => u !== id && g.objects[u].controller === o.controller);
  }
  return {
    obj: id, cardId: o.cardId, controller: o.controller, owner: o.owner, loc, might: c.might,
    tags: c.tags, type: c.type, isToken: !!o.isToken, alone, name: c.name, combatRole: o.combatRole,
    buffed: !!o.counters.buff, epoch: o.epoch ?? 0,
  };
}

/** Units at a location. For 'base' you must say whose base. */
export function unitsAtLoc(g: GameState, loc: Loc, basePlayer?: PlayerId): ObjId[] {
  // PERF: a full scan of g.objects; memoised within a read-only scope (legal enumeration, rule checks)
  return memoInScope(g, `units|${loc}|${basePlayer}`, () => unitsAtLocNow(g, loc, basePlayer)).slice();
}
function unitsAtLocNow(g: GameState, loc: Loc, basePlayer?: PlayerId): ObjId[] {
  const out: ObjId[] = [];
  for (const id in g.objects) {
    const o = g.objects[id];
    if (loc === 'base') { if (o.zone === 'base' && (basePlayer === undefined || o.controller === basePlayer) && isUnit(g, id)) out.push(id); }
    else if (o.zone === 'battlefield' && o.battlefieldIndex === loc && !isBattlefieldCard(g, id) && isUnit(g, id)) out.push(id);
  }
  return out;
}

export function allUnits(g: GameState): ObjId[] {
  return memoInScope(g, 'allUnits', () => allUnitsNow(g)).slice();
}
function allUnitsNow(g: GameState): ObjId[] {
  const out: ObjId[] = [];
  for (const id in g.objects) {
    const o = g.objects[id];
    if ((o.zone === 'base' || o.zone === 'battlefield') && !isBattlefieldCard(g, id) && isUnit(g, id)) out.push(id);
  }
  return out;
}

/**
 * R-11 (CR 709 / 711): "becomes Mighty" whenever a unit's Might goes from below 5 to 5+, for any reason (statics starting to
 * apply, negative modifiers expiring, moving into a "here" bonus). Called by every cleanup pass; units seen for the first time
 * (entering the board) are only recorded. becameMighty events emitted elsewhere are recorded by emit().
 */
export function trackMighty(g: GameState): void {
  const m = g.ex.memo ?? (g.ex.memo = {});
  const prev = (m.__mighty as Record<string, number> | undefined) ?? {};
  const next: Record<string, number> = {};
  const fire: ObjId[] = [];
  withCharsMemo(g, () => {
    for (const u of allUnits(g)) {
      const k = `${u}#${g.objects[u].epoch ?? 0}`;
      const now = (might(g, u) ?? 0) >= 5 ? 1 : 0;
      if (prev[k] === 0 && now === 1) fire.push(u);
      next[k] = now;
    }
  });
  m.__mighty = next;
  for (const u of fire) emit(g, { type: 'becameMighty', obj: u });
}

export function addModifier(g: GameState, id: ObjId, m: Omit<Modifier, 'timestamp' | 'layer'> & { layer?: number }): void {
  const o = g.objects[id];
  if (!o) return;
  const before = isUnit(g, id) ? might(g, id) : null;
  const srcEpoch = m.source && g.objects[m.source] ? (g.objects[m.source].epoch ?? 0) : undefined;
  o.modifiers.push({ layer: m.layer ?? (m.might !== undefined ? 3 : m.addKeywords || m.removeKeywords || m.grants ? 2 : 1), timestamp: ++g.timestamp, ...m, data: { ...(m.data ?? {}), ...(srcEpoch !== undefined ? { srcEpoch } : {}) } });
  if (before !== null && m.might !== undefined && m.might < 0) {
    const after = might(g, id);
    emit(g, { type: 'mightReduced', obj: id, by: before - (after ?? 0), player: m.data?.by ?? null });
  }
  if (before !== null) {
    const after = might(g, id);
    if (after !== null && before < 5 && after >= 5) emit(g, { type: 'becameMighty', obj: id });   // (recorded by trackMighty)
    if (after !== null && after !== before) emit(g, { type: 'mightChanged', obj: id, from: before, to: after });
  }
  g.ex.dirty = true;
}

// ---------------- draw / burn out ----------------

export function burnOut(g: GameState, p: PlayerId, seq = 0): boolean {
  const pl = g.players[p];
  const trash = [...pl.trash];
  for (const id of trash) moveToZone(g, id, 'mainDeck', { position: 'bottom' });
  shuffle(g, pl.mainDeck);
  const opps = opponents(g, p);
  let opp = opps[0];
  if (opps.length > 1) opp = Number(chooseOne(g, p, 'chooseOpponent', 'Burn out: choose an opponent to gain 1 point', opps.map(o => ({ id: String(o), label: g.players[o].name })))) as PlayerId;
  log(g, p, `${pl.name} burns out; ${g.players[opp].name} gains 1 point`);
  emit(g, { type: 'burnOut', player: p });
  // CR 432.3.b: points after the first burn out in a sequence can't be prevented
  if (opp !== undefined && (seq > 0 || !ruleApplies(g, 'cantGainPoints', opp))) {
    for (const q of teamOf(g, opp)) g.players[q].points += 1;   // CR 491.8.d.2 (2v2): the team gains it
    emit(g, { type: 'pointsGained', player: opp, n: 1, how: 'burnOut' });
    // CR 432.3.c.1: 2nd+ burn out points that give the lead at victory score win immediately
    if (seq > 0) checkWinNow(g); else g.ex.dirty = true;
    return true;
  }
  return false;
}

/** Burn out, repeating while the deck stays empty (CR 432.3); stops if no point could be gained (lead decision 7). */
function burnOutSequence(g: GameState, p: PlayerId): void {
  for (let seq = 0; seq < 100; seq++) {
    const gained = burnOut(g, p, seq);
    if (g.winner !== null || g.players[p].mainDeck.length > 0 || !gained) return;
  }
}

export function checkWinNow(g: GameState): boolean {
  if (g.winner !== null) return true;
  const act = g.players.filter(p => !p.conceded);
  const vs = victoryScore(g);
  for (const p of act) {
    // 2v2 (CR 491.6, 491.8.d.1): teammates share points and win together, so only opponents are compared
    if (p.points >= vs && act.every(q => !isOpponent(g, p.id, q.id) || p.points > q.points)) {
      declareWinner(g, p.id, 'reached the victory score');
      return true;
    }
  }
  return false;
}

export function declareWinner(g: GameState, p: PlayerId, why: string): void {
  if (g.winner !== null) return;
  g.winner = p;
  g.phase = 'gameOver';
  g.pending = null;
  g.chain = [];
  g.priority = null;
  log(g, p, `${g.players[p].name} wins (${why})`);
  emit(g, { type: 'gameOver', winner: p });
}

export class GameOver { }

export function draw(g: GameState, p: PlayerId, n = 1): ObjId[] {
  const out: ObjId[] = [];
  const pl = g.players[p];
  for (let i = 0; i < n; i++) {
    if (g.winner !== null) break;
    const ev = applyReplacements(g, { type: 'draw', player: p });
    if (!ev) continue;
    if (pl.mainDeck.length === 0) {
      burnOutSequence(g, p);
      if (g.winner !== null) break;
      if (pl.mainDeck.length === 0) break; // still empty: nothing more can be drawn
    }
    const id = pl.mainDeck[0];
    moveToZone(g, id, 'hand');
    out.push(id);
    g.ex.counts[`draws:${p}`] = (g.ex.counts[`draws:${p}`] ?? 0) + 1;
    emit(g, { type: 'draw', player: p, obj: id, ordinal: g.ex.counts[`draws:${p}`] });
  }
  if (out.length) log(g, p, `${pl.name} draws ${out.length}`);
  return out;
}

/** Move top cards of a main deck to trash (CR 440). */
export function burn(g: GameState, p: PlayerId, n: number): ObjId[] {
  const pl = g.players[p];
  const out: ObjId[] = [];
  for (let i = 0; i < n; i++) {
    if (g.winner !== null) break;
    if (pl.mainDeck.length === 0) { burnOutSequence(g, p); if (g.winner !== null || pl.mainDeck.length === 0) break; }
    const id = pl.mainDeck[0];
    moveToZone(g, id, 'trash');
    out.push(id);
  }
  if (out.length) { log(g, p, `${pl.name} burns ${out.length}`, out); emit(g, { type: 'burn', player: p, objs: out }); }
  return out;
}

/** Put a card into its owner's trash, applying "would go to trash" replacements (e.g. banish instead). */
export function toTrash(g: GameState, id: ObjId): boolean {
  return toTrashEx(g, id) === 'trash';
}
/** As toTrash; 'replaced' when a replacement effect sent it elsewhere (Endless Riches: banished) or nowhere, 'gone' when it ceased to exist (a token). */
export function toTrashEx(g: GameState, id: ObjId): 'trash' | 'replaced' | 'gone' {
  const o = g.objects[id];
  if (!o) return 'gone';
  const ev = applyReplacements(g, { type: 'toTrash', obj: id, from: o.zone });
  if (!ev) return 'replaced';
  if (ev.type === 'banish') { moveToZone(g, id, 'banishment'); emit(g, { type: 'banish', obj: id }); return 'replaced'; }
  return moveToZone(g, id, 'trash') ? 'trash' : 'gone';
}

// ---------------- hand / deck manipulation ----------------

export function discard(g: GameState, p: PlayerId, ids: ObjId[]): ObjId[] {
  const out: ObjId[] = [];
  for (const id of ids) {
    const o = g.objects[id];
    if (!o || o.zone !== 'hand') continue;
    toTrash(g, id);
    out.push(id);
    g.ex.counts[`discard:${p}`] = (g.ex.counts[`discard:${p}`] ?? 0) + 1;
  }
  for (const id of out) emit(g, { type: 'discard', player: p, obj: id });
  if (out.length) log(g, p, `${g.players[p].name} discards ${out.map(i => cardName(g, i)).join(', ')}`, out);
  return out;
}

/** Player chooses n cards from their hand to discard (as many as possible). */
export function chooseDiscard(g: GameState, p: PlayerId, n: number, source?: ObjId): ObjId[] {
  const hand = g.players[p].hand;
  if (n <= 0 || hand.length === 0) return [];
  const k = Math.min(n, hand.length);
  const ids = chooseOptions(g, p, 'chooseCards', `Discard ${k}`, hand.map(id => ({ id, label: cardName(g, id), objIds: [id] })), k, k, { source });
  return discard(g, p, ids);
}

/** Recycle: put cards on the bottom of their owner's deck (runes -> rune deck). CR 416 */
export function recycle(g: GameState, ids: ObjId[]): ObjId[] {
  const out: ObjId[] = [];
  const main: ObjId[] = [];
  for (const id of ids) {
    const o = g.objects[id];
    if (!o) continue;
    detachAll(g, id);
    const d = g.cards[o.cardId];
    const toRune = d?.type === 'Rune';
    const ok = moveToZone(g, id, toRune ? 'runeDeck' : 'mainDeck', { position: 'bottom' });
    if (ok) { out.push(id); if (!toRune) main.push(id); }
  }
  // CR 416.4: multiple cards recycled to the main deck at once are randomized (per owner's deck — one instruction can
  // recycle several players' cards, e.g. "each player reveals the top card … recycle them")
  const owners = [...new Set(main.map(id => g.objects[id].owner))];
  for (const owner of owners) {
    const n = main.filter(id => g.objects[id].owner === owner).length;
    if (n < 2) continue;
    const deck = g.players[owner].mainDeck;
    const tail = deck.splice(deck.length - n, n);
    shuffle(g, tail);
    deck.push(...tail);
  }
  if (out.length) emit(g, { type: 'recycle', objs: out });
  return out;
}

export function banish(g: GameState, ids: ObjId[], by?: ObjId): ObjId[] {
  const out: ObjId[] = [];
  for (const id of ids) {
    const o = g.objects[id];
    if (!o) continue;
    detachAll(g, id);
    const was = lki(g, id);
    if (moveToZone(g, id, 'banishment')) { out.push(id); if (by && g.objects[by]) g.ex.links[id] = { by, epoch: g.objects[by].epoch ?? 0 }; }
    emit(g, { type: 'banish', obj: id, lki: was, by });
  }
  if (out.length) log(g, null, `Banished ${out.map(i => cardName(g, i)).join(', ')}`, out);
  return out;
}

export function returnToHand(g: GameState, ids: ObjId[], meta: { source?: ObjId; chosen?: boolean; player?: PlayerId } = {}): ObjId[] {
  const out: ObjId[] = [];
  const names: string[] = [];
  for (const id of ids) {
    const o = g.objects[id];
    if (!o) continue;
    const ev = applyReplacements(g, { type: 'returnToHand', obj: id, source: meta.source ?? null, chosen: !!meta.chosen, player: meta.player ?? null });
    if (!ev) continue;
    if (ev.type === 'giveMight') { addModifier(g, id, { source: meta.source ?? null, duration: 'endOfTurn', might: Number(ev.amount) }); continue; }
    if (ev.type !== 'returnToHand') continue;
    detachAll(g, id);
    const was = lki(g, id);
    const ok = moveToZone(g, id, 'hand');
    emit(g, { type: 'returnToHand', obj: id, lki: was });
    // a token "returned to hand" ceases to exist (CR 186), but the return happened (RJ#11708: "if you do" effects count it)
    if (ok || (was as { isToken?: boolean }).isToken) { out.push(id); names.push(String((was as { name?: string }).name ?? id)); }
  }
  if (out.length) log(g, null, `Returned ${names.join(', ')} to hand`, out.filter(i => g.objects[i]));
  g.ex.dirty = true;
  return out;
}

// ---------------- damage / kill ----------------

/** unitDealt: an effect names units as the dealers (fights, CR 418.6.b.3) — not spell/ability damage for Bonus Damage / prevention.
 *  noBonus: Bonus Damage was already applied to the amount (split damage, CR 715.3) — bonus replacements are skipped */
export interface DamageSource { player: PlayerId; obj?: ObjId; combat?: boolean; spell?: boolean; noBonus?: boolean; unitDealt?: boolean }

/** Deal damage to units simultaneously (CR 417). Returns actual damage dealt per unit. */
export function dealDamage(g: GameState, src: DamageSource, list: { id: ObjId; amount: number }[]): Record<ObjId, number> {
  const dealt: Record<ObjId, number> = {};
  const evs: GameEvent[] = [];
  for (const { id, amount } of list) {
    const o = g.objects[id];
    if (!o || !onBoard(g, id) || !isUnit(g, id) || amount <= 0) continue;
    const ev = applyReplacements(g, { type: 'damage', obj: id, amount, source: src.obj ?? null, player: src.player, combat: !!src.combat, ...(src.noBonus ? { noBonus: true } : {}), ...(src.unitDealt ? { unitDealt: true } : {}) });
    if (!ev || ev.type !== 'damage') continue;
    const amt = Math.floor(Number(ev.amount));
    if (!(amt > 0)) continue;
    o.damage += amt;
    dealt[id] = (dealt[id] ?? 0) + amt;
    const by = { ...(g.ex.damageSrc[id]?.by ?? {}) };
    by[src.player] = (by[src.player] ?? 0) + amt;
    g.ex.damageSrc[id] = { player: src.player, obj: src.obj, combat: src.combat, by };
    evs.push({ type: 'damage', obj: id, amount: amt, source: src.obj ?? null, player: src.player, combat: !!src.combat, sourceLki: src.obj && g.objects[src.obj] ? { type: g.cards[g.objects[src.obj].cardId]?.type, controller: g.objects[src.obj].controller, cardId: g.objects[src.obj].cardId, isToken: !!g.objects[src.obj].isToken } : null });
  }
  for (const e of evs) emit(g, e);
  if (evs.length) {
    log(g, src.player, `${src.obj ? cardName(g, src.obj) : 'Effect'} deals ${evs.map(e => `${e.amount} to ${cardName(g, e.obj as string)}`).join(', ')}`, evs.map(e => e.obj as string));
    g.ex.dirty = true;
  }
  return dealt;
}

/** Lethal damage marked (incl. "any amount of your damage is enough to kill") — "if this kills it". */
export function isLethallyDamaged(g: GameState, id: ObjId): boolean {
  const o = g.objects[id];
  if (!o || !onBoard(g, id) || o.damage <= 0) return false;
  if (o.damage >= Math.max(0, might(g, id) ?? 0)) return true;
  return anyDamageLethal(g, id);
}

export function heal(g: GameState, ids: ObjId[]): void {
  for (const id of ids) { const o = g.objects[id]; if (o && o.damage > 0) { o.damage = 0; delete g.ex.damageSrc[id]; emit(g, { type: 'heal', obj: id }); } }
}

/** Detach gear attached to an object (they stay at its location; recalled in cleanup if at a battlefield). */
export function detachAll(g: GameState, host: ObjId): void {
  for (const gid of attachedTo(g, host)) detach(g, gid);
  const o = g.objects[host];
  if (o?.attachedTo) detach(g, host);
}

export function detach(g: GameState, gear: ObjId): void {
  const o = g.objects[gear];
  if (!o || !o.attachedTo) return;
  const host = o.attachedTo;
  o.attachedTo = undefined;
  g.ex.attachCount = Math.max(0, (g.ex.attachCount ?? 1) - 1);
  o.timestamp = ++g.timestamp;
  emit(g, { type: 'detach', obj: gear, host });
  g.ex.dirty = true;
}

export function attach(g: GameState, gear: ObjId, unit: ObjId): boolean {
  const go = g.objects[gear], uo = g.objects[unit];
  if (!go || !uo || !onBoard(g, gear) || !onBoard(g, unit)) return false;
  if (go.attachedTo === unit) return false;          // CR 434.1.g
  if (isUnit(g, gear)) return false;                  // units can't attach (Radiance 718.6)
  if (go.attachedTo) detach(g, gear);
  go.attachedTo = unit;
  g.ex.attachCount = (g.ex.attachCount ?? 0) + 1;
  go.timestamp = ++g.timestamp;
  // CR 434.4: the attached card takes the top-most card's location (not a move)
  setLocation(g, gear, locOf(g, unit)!);
  emit(g, { type: 'attach', obj: gear, host: unit, player: go.controller });
  log(g, go.controller, `${cardName(g, gear)} is attached to ${cardName(g, unit)}`, [gear, unit]);
  g.ex.dirty = true;
  return true;
}

/**
 * Kill permanents (CR 428). Deathknell / "when I die" triggers are queued while the objects are
 * still on the board, then they move to their owners' trashes. Replacement effects may replace
 * the death (e.g. "recall instead").
 */
export function kill(g: GameState, ids: ObjId[], by0?: { player?: PlayerId; obj?: ObjId; combat?: boolean }, performers?: Record<ObjId, PlayerId>): ObjId[] {
  // `performers`: the player who performs each object's kill when an instruction makes other players kill ("Each player kills one of
  // their units" — Cull the Weak): they are responsible for it (CR 429.5, OGN-FAQ; DECISIONS #3618 B, principle 3)
  const byOf = (id: ObjId) => (performers?.[id] !== undefined && by0 ? { ...by0, player: performers[id] } : by0);
  const dying: ObjId[] = [];
  const pending = ids.filter(id => { const o = g.objects[id]; return !!o && (o.zone === 'base' || o.zone === 'battlefield' || o.zone === 'facedown') && !isBattlefieldCard(g, id); });
  // CR 373.1 (DECISIONS #11503, ENGINE-9): replacement effects of different players on simultaneous deaths execute in turn order —
  // the turn player's units' deaths (and their "may pay" choices, Altar of Blood) are handled first. Stable; the events below keep
  // the given order.
  if (pending.length > 1) {
    const ord = turnOrderFrom(g);
    const rank = (id: ObjId) => { const r = ord.indexOf(g.objects[id].controller); return r < 0 ? ord.length : r; };
    const idx = new Map(pending.map((id, i) => [id, i]));
    pending.sort((x, y) => rank(x) - rank(y) || idx.get(x)! - idx.get(y)!);
  }
  while (pending.length) {
    // CR 373 (Zhonya's Hourglass example; RJ#1374, RJ#8072): when replacement effects could apply to several of one
    // player's simultaneous deaths, that player chooses which death is handled first
    let k = 0;
    if (pending.length > 1) {
      const withRepl = pending.filter(id => hasReplacement(g, { type: 'die', obj: id, by: byOf(id) ?? null }));
      const ctrl = withRepl.length > 1 ? g.objects[withRepl[0]].controller : null;
      const mine = ctrl === null ? [] : withRepl.filter(id => g.objects[id].controller === ctrl);
      if (mine.length > 1) {
        const pick = chooseOne(g, ctrl!, 'chooseOrder', 'Several of your units would die at the same time: choose the one whose death is handled first (replacement effects apply to it first)',
          mine.map(id => ({ id, label: cardName(g, id), objIds: [id] })));
        k = Math.max(0, pending.indexOf(pick));
      }
    }
    const id = pending.splice(k, 1)[0];
    if (!g.objects[id]) continue;
    const ev = applyReplacements(g, { type: 'die', obj: id, by: byOf(id) ?? null });
    if (!ev) continue;
    if (ev.type === 'recall') { recall(g, [id]); g.objects[id] && (g.objects[id].damage = ev.heal ? 0 : g.objects[id].damage); continue; }
    if (ev.type !== 'die') continue;
    dying.push(id);
  }
  dying.sort((x, y) => ids.indexOf(x) - ids.indexOf(y));     // simultaneous: keep the given order for the events
  const lkis = dying.map(id => lki(g, id));
  // `dying`: CR 383.2.c.2 — an object leaving at the same time can't trigger on the others' deaths (events.ts)
  for (let i = 0; i < dying.length; i++) emit(g, { type: 'die', obj: dying[i], lki: lkis[i], by: byOf(dying[i]) ?? null, dying: [...dying] });
  for (let i = 0; i < dying.length; i++) {
    const id = dying[i];
    detachAll(g, id);
    const o = g.objects[id];
    const unit = lkis[i].type === 'Unit';
    if (unit) g.ex.counts[`unitsDied:${o.controller}`] = (g.ex.counts[`unitsDied:${o.controller}`] ?? 0) + 1;
    if (!unit) g.ex.counts[`gearDied:${o.controller}`] = (g.ex.counts[`gearDied:${o.controller}`] ?? 0) + 1;
    g.ex.counts[`permanentsDied:${o.controller}`] = (g.ex.counts[`permanentsDied:${o.controller}`] ?? 0) + 1;
    if (unit && g.phase === 'beginning') g.ex.counts[`unitsDiedBeginning:${o.controller}`] = (g.ex.counts[`unitsDiedBeginning:${o.controller}`] ?? 0) + 1;
    // CR 808.1.d.1 (RJ#13329): "If the Permanent with the effect is not sent to the Trash" (a replacement sends it elsewhere —
    // Endless Riches banishes it) its Deathknell is removed. Other "when … dies" triggers stay (the unit still died).
    if (toTrashEx(g, id) === 'replaced') {
      const q = g.triggerQueue as QueuedTrigger[];
      for (let j = q.length - 1; j >= 0; j--) {
        const t = q[j];
        if (t.event.type === 'die' && t.event.obj === id && (t.abilitySource ?? t.source) === id && (abilityFromKey(g, t.key) as { deathknell?: boolean } | undefined)?.deathknell) {
          q.splice(j, 1);
          log(g, o.controller, `${String(lkis[i].name)} wasn't sent to the trash: its Deathknell is removed`, [id]);
        }
      }
    }
    delete g.ex.damageSrc[id];
    emit(g, { type: 'killed', obj: id, lki: lkis[i], by: byOf(id) ?? null });
  }
  if (dying.length) {
    log(g, by0?.player ?? null, `${dying.map((_, i) => String(lkis[i].name)).join(', ')} died`, dying);
    g.ex.dirty = true;
  }
  return dying;
}

// ---------------- statuses ----------------

export function ready(g: GameState, ids: ObjId[], by?: PlayerId | null, awaken = false): void {
  for (const id of ids) {
    const o = g.objects[id];
    if (!o || !o.exhausted) continue;
    // "spells and abilities can't ready ..." rules see by = null for the Awaken readies (rule arg 3 = 'awaken')
    if (ruleApplies(g, 'cantReady', id, awaken ? null : (by ?? null), awaken ? 'awaken' : 'effect')) continue;
    if (awaken && ruleApplies(g, 'noAwakenReady', id)) continue;
    o.exhausted = false;
    emit(g, { type: 'ready', obj: id, player: by ?? null });
  }
}
export function exhaust(g: GameState, ids: ObjId[], by?: PlayerId): void {
  for (const id of ids) { const o = g.objects[id]; if (o && !o.exhausted) { o.exhausted = true; emit(g, { type: 'exhaust', obj: id, player: by ?? null }); } }
}
export function stun(g: GameState, ids: ObjId[], by?: PlayerId, meta: { source?: ObjId; chosen?: boolean } = {}): void {
  for (const id of ids) {
    const o = g.objects[id];
    if (!o || !onBoard(g, id) || o.stunned) continue;    // CR 423.1.c
    const ev = applyReplacements(g, { type: 'stun', obj: id, player: by ?? null, source: meta.source ?? null, chosen: !!meta.chosen });
    if (ev && ev.type === 'giveMight') { addModifier(g, id, { source: meta.source ?? null, duration: 'endOfTurn', might: Number(ev.amount) }); continue; }
    if (!ev || ev.type !== 'stun') continue;
    o.stunned = true;
    emit(g, { type: 'stun', obj: id, player: by ?? null });
    log(g, null, `${cardName(g, id)} is stunned`, [id]);
  }
}
export function buff(g: GameState, id: ObjId, allowMultiple = false, by?: PlayerId): boolean {
  const o = g.objects[id];
  if (!o || !onBoard(g, id) || !isUnit(g, id)) return false;
  if (o.counters.buff && !allowMultiple && !ruleApplies(g, 'multipleBuffs', id)) return false;   // CR 426.2
  const before = might(g, id);
  o.counters.buff = (o.counters.buff ?? 0) + 1;
  emit(g, { type: 'buff', obj: id, player: by ?? null });
  const after = might(g, id);
  if (before !== null && after !== null && after !== before) {
    if (before < 5 && after >= 5) emit(g, { type: 'becameMighty', obj: id });
    emit(g, { type: 'mightChanged', obj: id, from: before, to: after });
  }
  g.ex.dirty = true;
  return true;
}
export function spendBuff(g: GameState, id: ObjId): boolean {
  const o = g.objects[id];
  if (!o || !o.counters.buff) return false;
  o.counters.buff -= 1;
  if (o.counters.buff <= 0) delete o.counters.buff;
  emit(g, { type: 'spendBuff', obj: id });
  return true;
}

export function empower(g: GameState, id: ObjId, max = 1, by?: PlayerId): boolean {
  const o = g.objects[id];
  if (!o) return false;
  if ((o.empowered ?? 0) >= max) return false;
  o.empowered = (o.empowered ?? 0) + 1;
  emit(g, { type: 'empower', obj: id, player: by ?? o.controller });
  log(g, o.controller, `${cardName(g, id)} becomes Empowered`, [id]);
  return true;
}
export function disempower(g: GameState, id: ObjId): boolean {
  const o = g.objects[id];
  if (!o || !o.empowered) return false;
  o.empowered -= 1;                  // CR 443: disempower removes one Empowered status
  emit(g, { type: 'disempower', obj: id });
  return true;
}

// ---------------- runes / resources ----------------

export function channel(g: GameState, p: PlayerId, n: number, exhausted = false): ObjId[] {
  const pl = g.players[p];
  const out: ObjId[] = [];
  const ev = applyReplacements(g, { type: 'channelRunes', player: p, n, exhausted, extraExhausted: 0 });
  if (!ev) return out;
  const total = Number(ev.n), extra = Number(ev.extraExhausted ?? 0);
  for (let i = 0; i < total + extra && pl.runeDeck.length > 0; i++) {
    const id = pl.runeDeck[0];
    moveToZone(g, id, 'runePool', { controller: p });
    g.objects[id].exhausted = i >= total ? true : !!ev.exhausted;
    out.push(id);
    emit(g, { type: 'channel', player: p, obj: id });
  }
  return out;
}

export function addResources(g: GameState, p: PlayerId, energy0: number, power0: (Domain | 'any')[], only?: string, source?: ObjId): void {
  // B8-12: Add events are replaceable ("your Gold [Add] an additional [1]")
  const ev = applyReplacements(g, { type: 'add', player: p, energy: energy0, power: power0, only: only ?? null, source: source ?? null });
  if (!ev) return;
  const energy = Number(ev.energy ?? 0), power = (ev.power as (Domain | 'any')[]) ?? [];
  const pool = g.players[p].pool;
  if (only) {
    if (energy) g.players[p].poolRestricted.push({ kind: 'energy', amount: energy, only, source });
    for (const d of power) g.players[p].poolRestricted.push({ kind: 'power', domain: d, amount: 1, only, source });
  } else {
    pool.energy += energy;
    for (const d of power) {
      const k = (d === 'any' ? 'Colorless' : d) as Domain;
      pool.power[k] = (pool.power[k] ?? 0) + 1;
    }
  }
  emit(g, { type: 'add', player: p, energy, power, source: source ?? null });
}

export function emptyPool(g: GameState, p: PlayerId): void {
  g.players[p].pool = { energy: 0, power: {} };
  g.players[p].poolRestricted = [];
}

// ---------------- points / xp ----------------

export function gainPoints(g: GameState, p: PlayerId, n: number, how: string, bf?: number): number {
  if (n <= 0) return 0;
  if (ruleApplies(g, 'cantGainPoints', p)) { log(g, p, `${g.players[p].name} can't gain points`); return 0; }
  const ev = applyReplacements(g, { type: 'gainPoints', player: p, n, how, bf: bf ?? null });
  if (!ev || ev.type !== 'gainPoints') return 0;
  const amt = Number(ev.n);
  if (amt <= 0) return 0;
  for (const q of teamOf(g, p)) g.players[q].points += amt;   // CR 491.8.d.2 (2v2): the team gains them
  emit(g, { type: 'pointsGained', player: p, n: amt, how, bf: bf ?? null });
  log(g, p, `${g.players[p].name} gains ${amt} point${amt > 1 ? 's' : ''} (${how}) -> ${g.players[p].points}`);
  g.ex.dirty = true;
  return amt;
}

export function losePoints(g: GameState, p: PlayerId, n: number): number {
  const pl = g.players[p];
  if (pl.points <= 0) return 0;               // CR 194.4.a/b
  const amt = Math.min(n, pl.points);
  for (const q of teamOf(g, p)) g.players[q].points = Math.max(0, g.players[q].points - amt);   // CR 491.8.d.2
  emit(g, { type: 'pointsLost', player: p, n: amt });
  return amt;
}

export function gainXp(g: GameState, p: PlayerId, n: number): void {
  if (n <= 0) return;
  g.players[p].xp += n;
  g.ex.counts[`xpGained:${p}`] = (g.ex.counts[`xpGained:${p}`] ?? 0) + n;
  emit(g, { type: 'xpGained', player: p, n });
  log(g, p, `${g.players[p].name} gains ${n} XP (${g.players[p].xp})`);
}
export function spendXp(g: GameState, p: PlayerId, n: number): boolean {
  if (g.players[p].xp < n) return false;
  g.players[p].xp -= n;
  emit(g, { type: 'xpSpent', player: p, n });
  return true;
}

// ---------------- movement ----------------

/** Contest a battlefield when a unit of a non-controller arrives (CR 190.2 / 450). */
export function maybeContest(g: GameState, bf: number, p: PlayerId): void {
  const b = g.battlefields[bf];
  if (!b) return;
  if (b.controller === p) return;
  if (b.contested) return;
  b.contested = true;
  b.contestedBy = p;
  emit(g, { type: 'contested', bf, player: p });
}

/** Move units (limited action, CR 446). Attached gear moves along (not a move). */
export function moveUnits(g: GameState, ids: ObjId[], to: Loc, how: 'standard' | 'effect' = 'effect', player?: PlayerId): ObjId[] {
  const moved: { id: ObjId; from: Loc }[] = [];
  for (const id of ids) {
    const o = g.objects[id];
    if (!o || !onBoard(g, id)) continue;
    const from = locOf(g, id)!;
    if (from === to) continue;
    if (ruleApplies(g, 'cantMove', id, from, to, player ?? o.controller)) continue;
    if (typeof to === 'number' && !canEnterBattlefield(g, to, o.controller)) { recall(g, [id]); continue; }
    const ev = applyReplacements(g, { type: 'move', obj: id, from, to, how });
    if (!ev) continue;
    setLocation(g, id, to);
    for (const gid of attachedTo(g, id)) setLocation(g, gid, to);
    o.movedThisTurn = true;
    o.movesThisTurn = (o.movesThisTurn ?? 0) + 1;
    moved.push({ id, from });
  }
  for (const m of moved) {
    const o = g.objects[m.id];
    if (typeof to === 'number') maybeContest(g, to, o.controller);
  }
  for (const m of moved) emit(g, { type: 'move', obj: m.id, from: m.from, to, how, player: player ?? g.objects[m.id].controller });
  if (moved.length) {
    log(g, player ?? null, `${moved.map(m => cardName(g, m.id)).join(', ')} move${moved.length > 1 ? '' : 's'} to ${to === 'base' ? 'base' : cardName(g, g.battlefields[to].objId)}`, moved.map(m => m.id));
    g.ex.dirty = true;
  }
  return moved.map(m => m.id);
}

/** CR 449.2: a battlefield with units of two other players can't be entered. */
export function canEnterBattlefield(g: GameState, bf: number, p: PlayerId): boolean {
  const others = new Set<PlayerId>();
  for (const u of unitsAtLoc(g, bf)) { const c = g.objects[u].controller; if (c !== p) others.add(c); }
  if (others.size >= 2) return false;
  if (g.mode === '2v2') { for (const c of others) if (c % 2 === p % 2) return false; }
  return true;
}

/** Recall (CR 454): to base, not a move. */
export function recall(g: GameState, ids: ObjId[]): void {
  for (const id of ids) {
    const o = g.objects[id];
    if (!o || !onBoard(g, id)) continue;
    if (locOf(g, id) === 'base' && g.players[o.controller].base.includes(id)) continue;
    setLocation(g, id, 'base');
    for (const gid of attachedTo(g, id)) { const gg = g.objects[gid]; setLocation(g, gid, 'base'); if (gg.controller !== o.controller) reseat(g, gid); }
    emit(g, { type: 'recall', obj: id });
  }
  g.ex.dirty = true;
}

// ---------------- tokens ----------------

export function findTokenDef(g: GameState, nameOrId: string): CardId | null {
  if (g.cards[nameOrId]) return nameOrId;
  const lower = nameOrId.toLowerCase();
  for (const id in g.cards) {
    const d = g.cards[id];
    if (d.name.toLowerCase() === lower && (d.supertypes.includes('Token') || d.type === 'Token')) return id;
  }
  for (const id in g.cards) if (g.cards[id].name.toLowerCase() === lower) return id;
  return null;
}

export interface TokenOpts { exhausted?: boolean; might?: number; play?: boolean; controller?: PlayerId }

/** Create (or "play") a token at a location (CR 179, 439). */
export function createToken(g: GameState, p: PlayerId, nameOrId: string, loc: Loc, opts: TokenOpts = {}): ObjId | null {
  return createTokens(g, p, nameOrId, loc, opts)[0] ?? null;
}

/** As createToken, returning every token the (possibly replacement-modified, Zilean "an additional copy") event made (RJ#9917). */
export function createTokens(g: GameState, p: PlayerId, nameOrId: string, loc: Loc, opts: TokenOpts = {}): ObjId[] {
  const first = findTokenDef(g, nameOrId);
  if (!first) { log(g, p, `(missing token definition ${nameOrId})`); return []; }
  const rev = applyReplacements(g, { type: 'createToken', player: p, cardId: first, loc, might: opts.might ?? null, copies: 1, exhausted: opts.exhausted ?? null });
  if (!rev) return [];
  const out: ObjId[] = [];
  for (let k = 0; k < Number(rev.copies ?? 1); k++) {
    const id = createTokenRaw(g, p, String(rev.cardId), (rev.loc as Loc) ?? loc, { ...opts, might: rev.might === null || rev.might === undefined ? opts.might : Number(rev.might), exhausted: rev.exhausted === null ? opts.exhausted : !!rev.exhausted });
    if (id) out.push(id);
  }
  return out;
}

function createTokenRaw(g: GameState, p: PlayerId, nameOrId: string, loc: Loc, opts: TokenOpts = {}): ObjId | null {
  const cardId = findTokenDef(g, nameOrId);
  if (!cardId) { log(g, p, `(missing token definition ${nameOrId})`); return null; }
  const d = g.cards[cardId];
  // CR 462.2.a style: if a unit token can't go there, it goes to base instead
  let where: Loc = loc;
  const unitLike = d.type === 'Unit' || d.might !== null;
  if (typeof where === 'number' && unitLike && !canEnterBattlefield(g, where, p)) where = 'base';
  const zone = where === 'base' ? 'base' : 'battlefield';
  const o = (newObjectFn as (g: GameState, c: CardId, p: PlayerId, z: 'base' | 'battlefield', e: object) => import('./types.ts').GameObject)(g, cardId, p, zone, { isToken: true });
  // RJ#10713 / #6500: a played unit token is a played unit — "Units can't be played here" (Rockfall Path) stops it (nothing happens)
  if (unitLike && opts.play !== false && typeof where === 'number' && ruleApplies(g, 'cantPlayToken', o.id, p, where)) {
    delete g.objects[o.id]; g.timestamp++;          // (timestamp: drop read-only scan caches that saw it)
    log(g, p, `${d.name} token can't be played at ${cardName(g, g.battlefields[where].objId)}`);
    return null;
  }
  if (opts.might !== undefined) o.counters.tokenMight = opts.might;
  // RJ#9271 / RJ#6734: a unit token that is *played* (not created) with [Accelerate] — printed, or granted while being played
  // (Rek'Sai, Breacher: "units played from anywhere other than a hand") — may pay [1][C] to enter ready (CR 805)
  let accelerated = false;
  if (unitLike && opts.play !== false && opts.exhausted === undefined) {
    const z0 = o.zone;
    // "being played": play rules see it outside the board. It stays set aside while the Accelerate decision is asked, so a
    // suspended state never shows a token in base/at a battlefield that isn't there yet (FUZZ 2022100893, Zed + Rek'Sai)
    (o as { zone: string }).zone = 'setAside';
    const hasAcc = (d.keywords ?? []).includes('Accelerate') || playGrantsFn(g, o.id).keywords.some(k => k === 'Accelerate');
    if (hasAcc) {
      const acc = { energy: 1, power: ['any'] } as import('./payment.ts').ResolvedCost;
      const plan = autoPayFn(g, p, acc, 'unit');
      if (plan && chooseYes(g, p, `Pay [1][C] for Accelerate (${d.name} token enters ready)?`, o.id)) { executePaymentFn(g, p, acc, 'unit', choosePaymentFn(g, p, acc, 'unit', plan, o.id, { prompt: `Accelerate (${d.name} token): pay [1][C]` })); accelerated = true; }
    }
    (o as { zone: string }).zone = z0;
  }
  if (zone === 'battlefield') o.battlefieldIndex = where as number;
  else g.players[p].base.push(o.id);
  o.exhausted = opts.exhausted ?? (unitLike ? !accelerated : false);
  o.enteredThisTurn = true;
  if (typeof where === 'number' && unitLike) maybeContest(g, where, p);
  emit(g, { type: 'enter', obj: o.id, player: p, token: true, loc: where });
  // B3-2/B1-10: "units enter ready" play rules also apply to unit tokens (unless the instruction says exhausted)
  if (unitLike && o.exhausted && opts.exhausted === undefined && tokenEntersReady(g, p, o.id, where)) o.exhausted = false;
  if (opts.play !== false) {
    const ev: GameEvent = { type: 'play', obj: o.id, player: p, token: true, cardType: d.type, loc: where };
    // CR 354.4 / principle 5 (RJ#5092, ENGINE-9): a token played while a spell or ability resolves is played after that resolution
    // finishes — its play triggers are met then (after a spell's own play completed: Lady of Luminosity's draw is met first, the
    // Recruits' Visions later, above it). The token itself is placed now, so the rest of the effect can still refer to it.
    const defer = g.ex.memo.__resolving ? (g.ex.memo.__deferredTokenPlays as GameEvent[] | undefined) : undefined;
    if (defer) {
      // keep the batching it would have had now (a provisional batch id: each token of "play four" its own batch, a reflexive
      // "Then do this" joins the last one — SF2-2); play.ts endResolving re-batches it when the play event happens
      const m = g.ex.memo;
      let b = (m.__batch as number | undefined) ?? 0;
      if (m.__batchType !== 'play') { b++; m.__batch = b; m.__batchType = 'play'; }
      defer.push({ ...ev, __prov: b });
    } else emit(g, ev);
  }
  log(g, p, `${g.players[p].name} creates a ${d.name} token${where === 'base' ? '' : ' at ' + cardName(g, g.battlefields[where].objId)}`, [o.id]);
  g.ex.dirty = true;
  return o.id;
}
import { newObject as newObjectFn } from './state.ts';
import { getScript as getScriptFn } from '../cards/registry.ts';
import { makeCtx as makeCtxFn } from './context.ts';
import { askYesNo as chooseYes } from './ask.ts';
import { tokenEntersReady } from './play.ts';
import { playGrants as playGrantsFn } from './chars.ts';
import { autoPay as autoPayFn, executePayment as executePaymentFn, choosePayment as choosePaymentFn } from './payment.ts';

// ---------------- look / predict / reveal ----------------

export function lookTop(g: GameState, p: PlayerId, n: number): ObjId[] {
  return g.players[p].mainDeck.slice(0, Math.max(0, n));
}

export interface LookOpts { reveal?: boolean; until?: (id: ObjId) => boolean; source?: ObjId }

/**
 * THE look/reveal path for deck cards (CR 425, 432.1.c). Every effect that looks at or reveals cards from the
 * top of a Main Deck goes through here:
 *  1. a replaceable `lookDeck` / `revealDeck` event {player: actor, owner, n} (e.g. Void Hatchling acts first);
 *  2. the cards are looked at (revealed: added to g.ex.revealed);
 *  3. a `lookedAt` / `revealedFromDeck` event {player, owner, objs} is emitted;
 *  4. "As you look at or reveal me" abilities of those cards (triggered abilities on event 'lookedAt' with
 *     activeIn ['mainDeck']) run immediately, in deck order.
 * Returns the looked-at cards that are still in that deck.
 */
export function lookDeck(g: GameState, actor: PlayerId, owner: PlayerId, n: number | 'all', o: LookOpts = {}): ObjId[] {
  const ev = applyReplacements(g, { type: o.reveal ? 'revealDeck' : 'lookDeck', player: actor, owner, n: n === 'all' ? -1 : n, source: o.source ?? null });
  if (!ev) return [];
  const deck = g.players[owner].mainDeck;
  let ids: ObjId[];
  if (o.until) { const k = deck.findIndex(id => o.until!(id)); ids = k < 0 ? [...deck] : deck.slice(0, k + 1); }
  else { const k = Number(ev.n); ids = deck.slice(0, k < 0 ? deck.length : Math.max(0, k)); }
  if (!ids.length) return [];
  if (o.reveal) reveal(g, ids);
  emit(g, { type: o.reveal ? 'revealedFromDeck' : 'lookedAt', player: actor, owner, objs: ids, source: o.source ?? null });
  for (const id of ids) {
    const ob = g.objects[id];
    if (!ob || ob.zone !== 'mainDeck') continue;
    for (const ab of getScriptFn(ob.cardId)?.abilities ?? []) {
      if (ab.kind !== 'triggered') continue;
      const evs = Array.isArray(ab.on.event) ? ab.on.event : [ab.on.event];
      if (!evs.includes('lookedAt') || !(ab.activeIn ?? []).some(z => z === 'mainDeck' || z === 'any')) continue;
      const ctx = makeCtxFn(g, id, ob.owner, { event: { type: 'lookedAt', player: actor, owner, objs: ids, reveal: !!o.reveal } });
      if (ab.on.match && !ab.on.match(ctx.event!, ctx)) continue;
      if (ab.optional && !chooseYes(g, ob.owner, typeof ab.optional === 'string' ? ab.optional : (ab.text ?? 'Use this ability?'), id)) continue;
      ab.effect(ctx);
      if (g.objects[id]?.zone !== 'mainDeck') break;
    }
  }
  return ids.filter(id => g.objects[id]?.zone === 'mainDeck' && g.objects[id].owner === owner);
}

/** Draw a specific card (from a deck or a looked-at set) as a Draw game action (CR 414). */
export function drawCard(g: GameState, p: PlayerId, id: ObjId): boolean {
  const o = g.objects[id];
  if (!o) return false;
  const ev = applyReplacements(g, { type: 'draw', player: p, obj: id, specific: true });
  if (!ev) return false;
  moveToZone(g, id, 'hand');
  g.ex.counts[`draws:${p}`] = (g.ex.counts[`draws:${p}`] ?? 0) + 1;
  emit(g, { type: 'draw', player: p, obj: id, ordinal: g.ex.counts[`draws:${p}`] });
  log(g, p, `${g.players[p].name} draws ${cardName(g, id)}`, [id]);
  return true;
}

export function reveal(g: GameState, ids: ObjId[]): void {
  for (const id of ids) if (!g.ex.revealed.includes(id)) g.ex.revealed.push(id);
  if (ids.length) { log(g, null, `Revealed ${ids.map(i => cardName(g, i)).join(', ')}`, ids); emit(g, { type: 'reveal', objs: ids }); }
}

/** CR 436 Predict X. */
export function predict(g: GameState, p: PlayerId, n = 1, source?: ObjId): void {
  const top = lookDeck(g, p, p, n, { source });
  if (top.length === 0) return;
  const rec = chooseOptions(g, p, 'chooseCards', `Predict: choose cards to recycle`, top.map(id => ({ id, label: cardName(g, id), objIds: [id] })), 0, top.length, { source, data: { private: true } });
  if (rec.length) recycle(g, rec);
  const rest = top.filter(id => !rec.includes(id));
  if (rest.length > 1) {
    const order = chooseOrder(g, p, 'Predict: choose the card to put on top first', rest.map(id => ({ id, label: cardName(g, id), objIds: [id] })), source);
    const deck = g.players[p].mainDeck;
    for (const id of rest) deck.splice(deck.indexOf(id), 1);
    deck.unshift(...order);
  }
  emit(g, { type: 'predict', player: p, n });
}

// ---------------- control ----------------

export function changeControl(g: GameState, id: ObjId, p: PlayerId): void {
  const o = g.objects[id];
  if (!o || o.controller === p) return;
  const from = o.controller;
  o.controller = p;
  o.timestamp = ++g.timestamp;
  reseat(g, id);
  const loc = locOf(g, id);
  emit(g, { type: 'controlChanged', obj: id, from, to: p });
  log(g, p, `${g.players[p].name} gains control of ${cardName(g, id)}`, [id]);
  if (typeof loc === 'number' && isUnit(g, id)) maybeContest(g, loc, p);
  g.ex.dirty = true;
}

export { nextPlayer };

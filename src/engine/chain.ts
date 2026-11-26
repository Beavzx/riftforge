// The chain (CR 325-340): placing triggered abilities, priority, resolution.
import type { ChainItem, GameEvent, GameState, ObjId, PlayerId } from './types.ts';
import type { Ability, TargetSpec, TriggeredAbility, SpellAbility } from './abilities.ts';
import { type QueuedTrigger, abilityFromKey, oncePerTurnOk, markUsed, unmarkUsed, useKeyOf } from './events.ts';
import { makeCtx } from './context.ts';
import { chooseOrderKind, askYesNo, Rollback } from './ask.ts';
import { candidatesFor, chooseGroup } from './targets.ts';
import { ctxForItem, newItemId, runAbilityEffect, beginResolving, endResolving, enterWaitingPlays } from './play.ts';
import { moveToZone } from './state.ts';
import { getScript } from '../cards/registry.ts';
import { chars } from './chars.ts';
import { log, cardName, turnOrderFrom, activePlayers, nextPlayer } from './util.ts';
import { resolveCost, autoPay, executePayment, choosePayment, canPayNonResource, payNonResource } from './payment.ts';
import { bonusDamageFor } from './replace.ts';
import { banish, recycle, toTrash } from './actions.ts';
import { emit, newBatch } from './events.ts';
import { emptyChain } from './showdown.ts';
import { chooseOptions, chooseNumber } from './ask.ts';
import { deflectCost, emitTargeted } from './targets.ts';

function trigLabel(g: GameState, t: QueuedTrigger, ab: Ability | undefined): string {
  const src = t.source && g.objects[t.source] ? cardName(g, t.source) : (t.source ? String((t.event.lki as { name?: string } | undefined)?.name ?? 'source') : 'effect');
  return `${src}: ${ab?.text ?? 'triggered ability'}`;
}

/** Put queued triggers on the chain: turn player first, each controller orders their own (CR 383.3.d). */
/**
 * R-16 (CR 334.1-334.2, 337.1.b, 383.3.d): triggers met are first ORDERED (each player orders their own simultaneous ones, turn
 * player first) and become pending chain items; the cleanup runs; then all pending items are FINALIZED (modes, "you may", targets,
 * costs) oldest first. orderTriggers handles the first step, finalizeTriggers the last.
 */
export function orderTriggers(g: GameState): void {
  const queue = g.triggerQueue as QueuedTrigger[];
  const fresh = queue.filter(t => t.seq === undefined);
  if (fresh.length === 0) return;
  let seq = queue.reduce((m, t) => Math.max(m, t.seq ?? 0), 0);
  const batches = [...new Set(fresh.map(t => t.batch ?? 0))].sort((a, b) => a - b);
  // CR 383.3 / 383.3.d.1 (DECISIONS #7205, ADJUDICATOR-4; supersedes the cross-batch part of rules-decisions #47): triggers met
  // by separate events are placed chronologically — batch by batch (a cost's "becomes exhausted" before the move it paid for,
  // T209; Promising Future's Snapvine entering before Rex, RJ#7205). Only abilities triggered simultaneously (one batch) are
  // placed in turn order starting with the turn player, each player ordering their own. A batch whose event fixes the order
  // (combat designations: attacker first, defender last, 466.2.d.1 — after the showdown-start triggers, RJ#11703) uses it.
  const fixedOf = (bn: number) => fresh.filter(t => (t.batch ?? 0) === bn).map(t => t.event.playerOrder as PlayerId[] | undefined).find(x => Array.isArray(x));
  const segments: { batches: number[]; fixed?: PlayerId[] }[] = batches.map(bn => ({ batches: [bn], fixed: fixedOf(bn) }));
  for (const seg of segments) for (const p of (seg.fixed ? [...seg.fixed, ...turnOrderFrom(g).filter(q => !seg.fixed!.includes(q))] : turnOrderFrom(g))) for (const bn of seg.batches) {
    const batch = fresh.filter(t => (t.batch ?? 0) === bn);
    {
      const mine = batch.filter(t => t.controller === p);
      if (mine.length === 0) continue;
      let ordered = mine;
      if (mine.length > 1) {
        // AUTO-AUDIT F-4: instances of one ability triggered by different events (two friendly units dying at once) are ordered by
        // the player too; only identical instances (same ability, source and event object) are left in any order
        const evObj = (t: QueuedTrigger) => String(t.event.obj ?? '');
        const distinct = new Set(mine.map(t => t.key + '|' + t.source + '|' + evObj(t)));
        if (distinct.size > 1) {
          const perAb = new Map<string, Set<string>>();
          for (const t of mine) { const k = t.key + '|' + t.source; if (!perAb.has(k)) perAb.set(k, new Set()); perAb.get(k)!.add(evObj(t)); }
          const forLabel = (t: QueuedTrigger) => {
            if ((perAb.get(t.key + '|' + t.source)?.size ?? 0) < 2 || !t.event.obj) return '';
            const o = t.event.obj as ObjId;
            const nm = g.objects[o] ? cardName(g, o) : String((t.event.lki as { name?: string } | undefined)?.name ?? o);
            return ` (for ${nm})`;
          };
          const ids = chooseOrderKind(g, p, 'orderTriggers', 'Order your triggered abilities (first chosen goes on the chain first, resolves last)',
            mine.map((t, i) => ({ id: String(i), label: trigLabel(g, t, abilityFromKey(g, t.key)) + forLabel(t), objIds: [...(t.source && g.objects[t.source] ? [t.source] : []), ...(forLabel(t) && g.objects[t.event.obj as ObjId] ? [t.event.obj as ObjId] : [])] })));
          ordered = ids.map(i => mine[Number(i)]);
        }
      }
      for (const t of ordered) t.seq = ++seq;
    }
  }
}

/** Finalize every ordered (pending) trigger, oldest first. Triggers met meanwhile stay queued for the next round. */
export function finalizeTriggers(g: GameState): void {
  const queue = g.triggerQueue as QueuedTrigger[];
  const ready = queue.filter(t => t.seq !== undefined).sort((a, b) => a.seq! - b.seq!);
  if (ready.length === 0) { enterWaitingPlays(g, () => false, true); g.ex.dirty = true; return; }
  const rest = queue.filter(t => t.seq === undefined);
  queue.splice(0, queue.length, ...rest);
  const wasEmpty = g.chain.length === 0;
  let added = false;
  // CR 340 step 1 (RJ#8175): permanents played by the last resolution enter once the triggers met before them are placed
  for (let i = 0; i < ready.length; i++) {
    enterWaitingPlays(g, qts => ready.slice(i).some(r => r.ts <= qts));
    if (placeTrigger(g, ready[i])) added = true;
  }
  enterWaitingPlays(g, () => false, true);
  if (added && wasEmpty && g.chain.length > 0 && !g.ex.chainOpener) {
    g.ex.chainOpener = { player: g.chain[0].controller, byTrigger: true };
  }
  // CR 337: after pending items finalize, the controller of the newest chain item gets priority
  if (added && g.chain.length > 0) g.priority = g.chain[g.chain.length - 1].controller;
  if (added) g.ex.passes = [];
  g.ex.dirty = true;
}

/** Order and finalize at once (callers outside the main loop). */
export function flushTriggers(g: GameState): void {
  orderTriggers(g);
  finalizeTriggers(g);
}

/** "You may ..." at the start of the effect (text after any "When ...,", or the first group's prompt), no separate optional/cost step. */
function leadingMay(ab: TriggeredAbility, first: TargetSpec): boolean {
  if (ab.mayChoose !== undefined) return ab.mayChoose;
  if (ab.optional || ab.cost || ab.modes?.length) return false;
  return /^(?:when[^.]*?,\s*)?you may\b/i.test((ab.text ?? '').trim()) || /^(?:[^:.]*:\s*)?you may\b/i.test((first.prompt ?? '').trim());
}

/** Finalize one triggered ability onto the chain. Returns true if it was added. */
function placeTrigger(g: GameState, t: QueuedTrigger): boolean {
  const ab = abilityFromKey(g, t.key) as TriggeredAbility | undefined;
  if (!ab || ab.kind !== 'triggered') return false;
  const src = t.source ?? '';
  // B6-10: a "when you play me" trigger sees the play data (paid additional costs, Show Off, ...)
  const seed: Record<string, unknown> = t.event.type === 'play' && t.event.obj === t.source && t.event.playData ? { ...(t.event.playData as Record<string, unknown>) } : {};
  delete seed.hiddenHere;            // (the hidden battlefield of the card's own play choices)
  // CR 811.1.d.3/.3.a (RJ#2696, #11865, #10647; DECISIONS principle 12): a play effect of a permanent played from facedown chooses
  // at the battlefield it was played to, read from its source — gone from the board → no legal choice / mistarget on resolution
  if (t.event.type === 'play' && t.event.obj === t.source && t.event.fromHidden && src && g.objects[src]) {
    seed.hiddenSrc = src; seed.hiddenSrcEpoch = g.objects[src].epoch ?? 0;
    seed.hiddenAt = typeof t.event.loc === 'number' ? t.event.loc : (g.objects[src].battlefieldIndex ?? null);
  }
  if (t.costEpoch !== undefined) seed.__srcEpoch = t.costEpoch;    // ctx.sourceSame() (principle 17, RJ#12846)
  const item: ChainItem = { id: newItemId(g), kind: 'trigger', source: src, controller: t.controller, abilityKey: t.key, targets: [], choices: { data: { ...seed, ...(t.data ?? {}) } }, pending: true, event: t.event, label: trigLabel(g, t, ab) };
  if (t.abilitySource) item.abilitySource = t.abilitySource;      // SF-2
  const ctx = makeCtx(g, src, t.controller, { event: t.event, item, data: item.choices.data as Record<string, unknown> });
  if (t.abilitySource) ctx.abilitySource = t.abilitySource;
  if (ab.oncePerTurn && !oncePerTurnOk(g, t.source, useKeyOf(t), ab.oncePerTurn)) return false;
  if (ab.offerIf && !ab.offerIf(ctx)) { log(g, t.controller, `${item.label}: nothing to do`); return false; }   // SF2-1
  // CR 383.3.a-b: the finalize-time choices (leading "you may", modes, targets, costs) are made by the trigger's controller, or by
  // the player the text gives them to ("When a player plays a unit here, they may pay [1] …" — `payer`; RJ#12403, #12439)
  const dec = ab.payer ? ab.payer(ctx) : t.controller;
  const dctx = dec === t.controller ? ctx : ctx.as(dec);
  if (ab.cost) {
    // RJ#12813 (CR 124.1, 383.3.b): a "me" cost (banish / kill / recycle / exhaust me) can't be paid once the object that triggered
    // has become a new object (died in the cleanup before this finalizes: Ravenbloom Prefect vs Wages of Pain)
    const co = t.abilitySource ?? src;
    if (t.costEpoch !== undefined && (ab.cost.exhaustSelf || (ab.cost.extra ?? []).some(x => x.self)) && (g.objects[co]?.epoch ?? -1) !== t.costEpoch) {
      log(g, t.controller, `${item.label}: cost can't be paid (its source left)`); return false;
    }
    const rc0 = resolveCost(ab.cost, src && g.objects[src] ? chars(g, src).domains : []);
    if (!canPayNonResource(g, dec, src, rc0) || !autoPay(g, dec, rc0, 'ability', { exclude: src })) { log(g, dec, `${item.label}: cost can't be paid`); return false; }
  }
  // R-15 (CR 403.4): a trigger whose mandatory target group has no candidates is removed — don't ask "you may" first
  // (only the first group: later groups may depend on earlier choices)
  const g0 = ab.targets?.[0];
  if (!ab.modes?.length && g0 && (g0.min ?? 1) > 0 && candidatesFor(g, dctx, g0).length === 0) {
    log(g, dec, `${item.label}: no legal targets`); return false;
  }
  // CR 383.3.a: "you may" at the start is decided now; declining = never triggered (once-per-turn unused)
  if (ab.optional) {
    const prompt = typeof ab.optional === 'string' ? ab.optional : `${item.label} — use it?`;
    if (!askYesNo(g, dec, prompt, src || undefined)) return false;
  }
  if (ab.oncePerTurn) markUsed(g, t.source, useKeyOf(t));
  // R-1: bulleted modes are chosen as the trigger goes on the chain (CR 403.2); no legal mode -> removed
  let specs = ab.targets ?? [];
  if (ab.modes?.length) {
    // RJ#326 (SFD-FAQ Aphelios, Exalted): each instance of the ability keeps its own "hasn't been chosen this turn" list
    const memKey = (id: string) => `mode:${t.key}${t.inst !== undefined && t.inst >= 1000 ? `#${t.inst}` : ''}:${id}`;
    const avail = ab.modes.filter(m => (!m.condition || m.condition(dctx)) && (!ab.modesOncePerTurn || !dctx.remembered(memKey(m.id), src)) && m.targets?.every(sp => (sp.min ?? 1) === 0 || candidatesFor(g, dctx, sp).length > 0) !== false);
    if (!avail.length) { log(g, dec, `${item.label}: no mode can be chosen`); return false; }
    const n = Math.min(ab.chooseModes ?? 1, avail.length);
    const ids = chooseOptions(g, dec, 'chooseMode', `${item.label}: choose ${n === 1 ? 'one' : n}`, avail.map(m => ({ id: m.id, label: m.label })), n, n, { source: src || undefined });
    item.mode = ids.join(',');
    if (ab.modesOncePerTurn) for (const id of ids) dctx.remember(memKey(id), src);
    specs = ids.flatMap(id => ab.modes!.find(m => m.id === id)!.targets ?? []);
  }
  // targets (CR 402.4.b: no legal targets -> removed)
  const picked: ObjId[] = [];
  dctx.targets = item.targets;                       // R-14: later filters see the earlier groups
  for (const spec of specs) {
    let cands = candidatesFor(g, dctx, spec);
    // CR 355.16 / 809 (RJ#9448): an enemy Deflect unit whose cost (with the base cost) can't be paid can't be chosen
    if (!spec.pick && spec.kind !== 'destination') {
      const sofar = item.targets.flat().filter(x => !picked.includes(x));
      const doms = src && g.objects[src] ? chars(g, src).domains : [];
      cands = cands.filter(id => {
        const defl = deflectCost(g, dec, [...sofar, id]);
        if (defl === 0) return true;
        const rc = resolveCost(ab.cost ?? {}, doms);
        for (let i = 0; i < defl; i++) rc.power.push('any');
        return !!autoPay(g, dec, rc, 'ability', { exclude: src });
      });
    }
    let maxT = spec.max ?? 1;
    if (spec.splitAmount !== undefined) {
      // CR 355.14.c + 715.3: no more split recipients than the amount, raised by Bonus Damage (Volibear + Annie: 6)
      const amt = typeof spec.splitAmount === 'function' ? spec.splitAmount(dctx) : spec.splitAmount;
      const bonus = amt > 0 ? Math.max(0, ...cands.map(id => bonusDamageFor(g, { type: 'damage', obj: id, amount: amt, source: src || null, player: dec, combat: false }))) : 0;
      maxT = Math.min(maxT, amt + bonus);
    }
    const min = Math.min(spec.min ?? 1, cands.length), max = Math.min(maxT, cands.length);
    if ((spec.min ?? 1) > 0 && cands.length === 0) { log(g, dec, `${item.label}: no legal targets`); return false; }
    const ids = max > 0 ? chooseGroup(g, dec, spec, spec.prompt ?? 'Choose a target', cands, id => dctx.labelOf(id), min, max, { source: src || undefined, hint: spec.hint }) : [];
    item.targets.push(ids);
    if (spec.pick || spec.kind === 'destination') picked.push(...ids);   // not targeting (R-6, R-2)
    void chooseNumber;
  }
  item.targetEpochs = item.targets.map(grp => grp.map(x => g.objects[x]?.epoch ?? 0));
  // CR 383.3.a (RJ#6775, DECISIONS principle 11): a leading "you may choose ..." declined by choosing nothing removes the trigger
  if (specs[0] && (specs[0].min ?? 1) === 0 && item.targets[0]?.length === 0 && leadingMay(ab, specs[0])) {
    if (ab.oncePerTurn) unmarkUsed(g, t.source, useKeyOf(t));
    log(g, dec, `${item.label}: declined`); return false;
  }
  // base cost within the first instruction (CR 383.3.b), incl. Deflect for chosen enemy targets
  const chosenIds = item.targets.flat().filter(x => !picked.includes(x));
  if (ab.cost || deflectCost(g, dec, chosenIds) > 0) {
    const domains = src && g.objects[src] ? chars(g, src).domains : [];
    const rc = resolveCost(ab.cost ?? {}, domains);
    const defl = deflectCost(g, dec, chosenIds);
    for (let i = 0; i < defl; i++) rc.power.push('any');
    const plan = autoPay(g, dec, rc, 'ability', { exclude: src });
    if (!plan || !canPayNonResource(g, dec, src, rc)) { log(g, dec, `${item.label}: cost can't be paid`); return false; }
    // CR 405.2 / 383.3.b.1: a cost a trigger incurs (Deflect on its chosen targets) may be declined; the trigger is then removed
    if (defl > 0 && !askYesNo(g, dec, `${item.label}: pay ${defl === 1 ? '[A]' : `${defl} Power`} for Deflect? (No removes the trigger)`, src || undefined)) {
      log(g, dec, `${item.label}: Deflect cost declined, removed`); return false;
    }
    // each trigger's cost is its own payment: its events (a discard, a kill) are not simultaneous with another trigger's (RJ#6974:
    // three Rockets' discards → Jinx's "one or more" triggers three times)
    newBatch(g);
    // A-1 / E2: with "choose runes when paying" the player picks the runes (auto-pay preselected)
    executePayment(g, dec, rc, 'ability', choosePayment(g, dec, rc, 'ability', plan, src || undefined, { exclude: src || undefined, prompt: `${item.label}: pay` }));
    if (!payNonResource(g, dec, src, rc, item.choices.data as Record<string, unknown>)) return false;   // SF-5
  }
  for (const id of chosenIds) if (g.objects[id]) emitTargeted(g, id, dec, src);
  item.pending = false;
  if (ab.isAdd) {
    resolveItemEffect(g, item);
    return false;
  }
  g.chain.push(item);
  log(g, t.controller, `Trigger: ${item.label}`, src && g.objects[src] ? [src] : []);
  return true;
}

function specsForSpell(sp: SpellAbility | undefined, mode?: string): (TargetSpec | undefined)[] {
  if (!sp) return [];
  if (sp.modes && mode) {
    const out: (TargetSpec | undefined)[] = [];
    for (const mid of mode.split(',')) { const m = sp.modes.find(x => x.id === mid); out.push(...(m?.targets ?? [])); }
    return out;
  }
  return sp.targets ?? [];
}

function resolveItemEffect(g: GameState, item: ChainItem): void {
  if (item.kind === 'spell') {
    const o = g.objects[item.source];
    const cardId = o ? (chars(g, item.source).copyOf ?? o.cardId) : '';
    const sp = getScript(cardId)?.abilities.find(a => a.kind === 'spell') as SpellAbility | undefined;
    const times = 1 + (item.repeat ?? 0);
    for (let k = 0; k < times; k++) {
      if (!sp) { log(g, item.controller, `${item.label} resolves (no scripted effect)`); break; }
      if (k > 0) newBatch(g);            // CR 820.1.d: a Repeat execution is a new execution ("one or more" triggers again, RJ#6584)
      if (k > 0 && (sp.targets?.length || sp.modes)) {
        // CR 820.2: the repeated execution uses the choices made for it when the spell was played (RJ#92a, #193)
        const rt = item.choices[`repeatTargets:${k}`] as { targets: ObjId[][]; epochs: number[][] } | undefined;
        if (rt) { item.targets = rt.targets.map(x => [...x]); item.targetEpochs = rt.epochs.map(x => [...x]); }
        else rechooseTargets(g, item, item.controller, specsForSpell(sp, item.mode), 'Repeat: ', true);   // (older items / effects)
      }
      const specs = specsForSpell(sp, item.mode);
      const ctx = ctxForItem(g, item, specs);
      ctx.iteration = k;
      if (sp.modes && item.mode) {
        let offset = 0;
        for (const mid of item.mode.split(',')) {
          const m = sp.modes.find(x => x.id === mid);
          if (!m) continue;
          const n = m.targets?.length ?? 0;
          const sub = ctxForItem(g, item, specs);
          sub.targets = ctx.targets.slice(offset, offset + n);
          sub.iteration = k; sub.mode = mid;
          offset += n;
          m.effect(sub);
        }
      } else sp.effect?.(ctx);
    }
    return;
  }
  if (item.kind === 'ability') { runAbilityEffect(g, item); return; }
  // trigger
  const ab = abilityFromKey(g, item.abilityKey ?? '') as TriggeredAbility | undefined;
  if (!ab) return;
  if (ab.modes?.length && item.mode) {
    const picked = item.mode.split(',').map(id => ab.modes!.find(m => m.id === id)!).filter(Boolean);
    const allSpecs = picked.flatMap(m => m.targets ?? []);
    const base = ctxForItem(g, item, allSpecs);
    base.data = (item.choices.data as Record<string, unknown>) ?? {};
    // CR 383.2.a.1: an intervening "if" is part of the trigger condition, checked when the event happens only (not on resolution)
    let off = 0;
    for (const m of picked) {
      const n = m.targets?.length ?? 0;
      const sub = ctxForItem(g, item, allSpecs);
      sub.data = base.data; sub.targets = base.targets.slice(off, off + n); sub.mode = m.id; off += n;
      m.effect(sub);
    }
    return;
  }
  const ctx = ctxForItem(g, item, ab.targets ?? []);
  ctx.data = (item.choices.data as Record<string, unknown>) ?? {};
  // CR 383.2.a.1 (Sona example, RJ#11729): the trigger condition is not re-checked on resolution
  ab.effect(ctx);
}

/** Resolve the newest finalized chain item (CR 340). */
export function resolveTop(g: GameState): void {
  const item = g.chain[g.chain.length - 1];
  if (!item) return;
  log(g, item.controller, `Resolving ${item.label ?? item.kind}`, g.objects[item.source] ? [item.source] : []);
  beginResolving(g, item.label ?? item.kind, item.id);
  try {
    resolveItemEffect(g, item);
  } catch (e) {
    if (e instanceof Rollback) log(g, item.controller, `(effect could not complete: ${e.reason})`);
    else throw e;
  }
  // remove the item (it may already have been countered/removed by its own effect)
  const i = g.chain.findIndex(c => c.id === item.id);
  if (i >= 0) g.chain.splice(i, 1);
  if (item.kind === 'spell') {
    const o = g.objects[item.source];
    // RJ#13328 (Dancing Grenade): a spell played again by its own resolution is a new chain item for the same object — it
    // stays on the chain instead of leaving it
    // (only a new SPELL item counts: a reflexive "do this" item the spell put on the chain shares its source)
    const replayed = g.chain.some(c => c.kind === 'spell' && c.source === item.source && c.id !== item.id);
    if (o && o.zone === 'chain' && !replayed) {
      // B7-4: "play it, then banish / recycle it"
      if (item.viaFlow || item.choices.banishAfter || item.leaveTo === 'banish') banish(g, [item.source]);
      else if (item.leaveTo === 'recycle') recycle(g, [item.source]);
      else if (item.leaveTo === 'hand') moveToZone(g, item.source, 'hand');
      else toTrash(g, item.source);
    }
    emit(g, { type: 'spellResolved', obj: item.source, player: item.controller });
    // CR 420.4.a.1 / VEN-FAQ (Ravenbloom Student, Rebuttal): "when you play a spell" sees the spell's controller when it resolves
    if (item.choices.playEvent) emit(g, { ...(item.choices.playEvent as GameEvent), player: item.controller });
  }
  // CR 354.4: permanents played during this resolution enter now (after the spell's play completed: Diana vs HR, RJ#9227)
  endResolving(g);
  g.ex.revealed = [];
  g.priority = null;
  g.ex.passes = [];
  g.ex.dirty = true;
  if (g.chain.length === 0) emptyChain(g);
}

/** Pass while the chain is non-empty (CR 339). */
export function passPriority(g: GameState, p: PlayerId): void {
  g.ex.passes.push(p);
  const act = activePlayers(g);
  if (act.every(q => g.ex.passes.includes(q))) return;   // main loop resolves
  g.priority = nextPlayer(g, p);
}

export function allPassed(g: GameState): boolean {
  const act = activePlayers(g);
  return act.every(q => g.ex.passes.includes(q));
}
export { recycle };

/** CR 750: remake a chain item's choices (targets) with its controller as chooser. */
export function remakeChoices(g: GameState, item: ChainItem, chooser: PlayerId): void {
  let specs: (TargetSpec | undefined)[] = [];
  if (item.kind === 'spell') {
    const sp = getScript(g.objects[item.source]?.cardId ?? '')?.abilities.find(a => a.kind === 'spell') as SpellAbility | undefined;
    specs = specsForSpell(sp, item.mode);
  } else {
    const ab = abilityFromKey(g, item.abilityKey ?? '');
    if (ab && (ab.kind === 'triggered' || ab.kind === 'activated')) specs = ab.targets ?? [];
  }
  if (!specs.length) return;
  rechooseTargets(g, item, chooser, specs, 'New choice: ', true);
}

/**
 * The one "make new choices" path (Repeat CR 820, copies / control changes CR 750): groups are chosen in order and later filters
 * see earlier groups (R-14); `pick` specs are not targeting; no Deflect is charged (no cost is being paid).
 */
export function rechooseTargets(g: GameState, item: ChainItem, chooser: PlayerId, specs: (TargetSpec | undefined)[], prefix: string, emitEvents: boolean): void {
  const ctx = makeCtx(g, item.source, chooser, { item });
  const acc: ObjId[][] = [];
  ctx.targets = acc;
  for (const spec of specs) {
    if (!spec) { acc.push([]); continue; }
    const cands = candidatesFor(g, ctx, spec);
    const min = Math.min(spec.min ?? 1, cands.length), max = Math.min(spec.max ?? 1, cands.length);
    const ids = max > 0 ? chooseGroup(g, chooser, spec, `${prefix}${spec.prompt ?? 'choose'}`, cands, id => ctx.labelOf(id), min, max, { hint: spec.hint, source: item.source }) : [];
    if (emitEvents && !spec.pick && spec.kind !== 'destination') for (const id of ids) if (g.objects[id]) emitTargeted(g, id, chooser, item.source);
    acc.push(ids);
  }
  item.targets = acc;
  item.targetEpochs = item.targets.map(grp => grp.map(t => g.objects[t]?.epoch ?? 0));
}

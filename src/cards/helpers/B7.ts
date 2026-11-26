// Batch B7 helpers (card flow / zones): playing cards from other zones with partial costs, look / reveal
// with the Void Hatchling and Nocturne hooks, "then recycle / banish it" after the chain, drawing a
// specific card, and a few delayed abilities. Owned by scripting agent B7. Only public ctx / DSL APIs.
// Requests for proper engine support are in docs/dsl-requests.md (B7 entries).
import {
  delayedAbility, playRule, replacement, costModDyn, cost, F, type Ctx, type ObjId, type PlayerId, type CostSpec, type Filter,
} from '../dsl.ts';
import type { Destination } from '../dsl.ts';


// ------------------------------------------------------------------------------------------------
// players
// ------------------------------------------------------------------------------------------------

/** Player p picks one option (for opponents' choices such as "each other player chooses Cards or Runes"). */
export function modeFor(ctx: Ctx, p: PlayerId, options: { id: string; label: string }[], prompt: string): string {
  return ctx.as(p).chooseMode(options, prompt);
}

// ------------------------------------------------------------------------------------------------
// card facts (work in any zone)
// ------------------------------------------------------------------------------------------------

export const def = (ctx: Ctx, id: ObjId) => ctx.g.cards[ctx.cardIdOf(id)];
export const isUnitCard = (ctx: Ctx, id: ObjId) => ctx.type(id) === 'Unit';
export const isGearCard = (ctx: Ctx, id: ObjId) => ctx.type(id) === 'Gear';
/** A gear on the board, counting cards printed with Gear as an additional type (Patched Porobot, "UNIT GEAR").
 * SCRIPT-FIX: the engine's isGear does not read CardDef.additionalTypes yet (docs/dsl-requests.md SF-1). */
export const isGearAny = (ctx: Ctx, id: ObjId) => ctx.isGear(id) || !!def(ctx, id)?.additionalTypes?.includes('Gear');
/** Friendly gear (incl. Gear Units) other than `except` that p controls. */
export const gearControlled = (ctx: Ctx, except?: ObjId) =>
  [...new Set([...ctx.units(), ...ctx.gear()])].filter(id => id !== except && ctx.ctrl(id) === ctx.controller && isGearAny(ctx, id));
export const isSpellCard = (ctx: Ctx, id: ObjId) => ctx.type(id) === 'Spell';
export const hasHidden = (ctx: Ctx, id: ObjId) => ctx.has(id, 'Hidden');
/** printed Might of a card (in any zone); 0 if none */
export const cardMight = (ctx: Ctx, id: ObjId) => (ctx.onBoard(id) ? ctx.might(id) : (ctx.rawMight(id) ?? def(ctx, id)?.might ?? 0));
export const zone = (ctx: Ctx, id: ObjId) => ctx.obj(id)?.zone;
export const PET_TAGS = ['Bird', 'Cat', 'Dog', 'Poro'];
export const isPet = (ctx: Ctx, id: ObjId) => ctx.tags(id).some(t => PET_TAGS.includes(t));

/** Filter: a card in the trash of this ability's controller. */
export const inMyTrash: Filter = (ctx, id) => ctx.obj(id)?.zone === 'trash' && ctx.owner(id) === ctx.controller;
export const inAnyTrash: Filter = (ctx, id) => ctx.obj(id)?.zone === 'trash';

// ------------------------------------------------------------------------------------------------
// playing a card by an effect
// ------------------------------------------------------------------------------------------------

/**
 * How the cost is handled:
 *  'full'      — pay its cost ("then play it")
 *  'free'      — ignoring its cost
 *  'noEnergy'  — ignoring its Energy cost (the Power cost is still paid)
 *  {reduce: N} — reducing its (Energy) cost by [N]
 *  {pay: cost} — for this cost instead of its own ("play me for [A]")
 */
export type CostMode = 'full' | 'free' | 'noEnergy' | { reduce: number } | { pay: CostSpec };

export interface PlayItOpts {
  /** who plays it (default: this ability's controller) */
  payer?: PlayerId;
  cost?: CostMode;
  /** forced destination for a permanent */
  dest?: Destination;
  /** additional allowed destinations (the player still chooses among all) */
  extraDests?: Destination[];
  /** what happens to a spell when it would leave the chain for the trash */
  then?: 'recycle' | 'banish';
  /** "ignoring any and all costs": no additional costs either, mandatory ones included (CR 356.5.a; rules-spec §2.5 step 5;
   *  RJ#12433 Bone Skewer + Cruel Patron) */
  allCosts?: boolean;
}

/** The resources still to pay for a card played with `mode` (null for 'full'). */
export function effectCost(ctx: Ctx, id: ObjId, mode: CostMode): CostSpec | null {
  if (mode === 'full') return null;
  if (mode === 'free') return { energy: 0, power: [] };
  const powerSyms = new Array(ctx.powerCost(id)).fill('C') as CostSpec['power'];
  if (mode === 'noEnergy') return { energy: 0, power: powerSyms };
  if ('reduce' in mode) return { energy: Math.max(0, ctx.energyCost(id) - mode.reduce), power: powerSyms };
  return mode.pay;
}

/** Could `payer` afford to play `id` this way right now? */
export function canAffordPlay(ctx: Ctx, id: ObjId, mode: CostMode, payer: PlayerId = ctx.controller, destinations?: Destination[]): boolean {
  const c = ctx.as(payer);
  // the actual play cost, with the card's own cost modifications (Shadowblade Lurker's reduction, RJ#11999; Noxus Hopeful's
  // Legion under Void Rush's "reducing its cost by [2]", RJ#9731) — the engine computes it for every effect-cost mode.
  // `destinations`: the play must be allowed to one of them (RJ#3497)
  if (mode === 'free' && !destinations) return true;
  return c.canPlayByEffect(id, { cost: mode, destinations });
}

const EXTRA_DEST = delayedAbility('B7:extraDest', playRule(
  (ctx, id) => id === ctx.data.obj && (ctx.obj(id)?.epoch ?? 0) === ctx.data.epoch,
  { extraDestinations: ctx => (ctx.data.dests as Destination[]) ?? [] },
));

const AFTER_CHAIN = delayedAbility('B7:afterChain', replacement('toTrash',
  (ev, ctx) => ev.obj === ctx.data.obj && ev.from === 'chain' && (ctx.obj(ev.obj as ObjId)?.epoch ?? 0) === ctx.data.epoch,
  (ev, ctx) => {
    ctx.data.__consume = true;
    if (ctx.data.mode === 'banish') return { ...ev, type: 'banish' };
    ctx.recycle(ev.obj as ObjId);
    return null;
  },
  { text: 'Then recycle / banish it' },
));

/** "Then recycle it" / "Then banish this" for a spell on the chain (or about to be played: epochOffset 1). */
export function afterChain(ctx: Ctx, id: ObjId, mode: 'recycle' | 'banish', epochOffset = 0): void {
  const o = ctx.obj(id);
  if (!o) return;
  ctx.delay(AFTER_CHAIN, { obj: id, epoch: (o.epoch ?? 0) + epochOffset, mode }, 'endOfTurn');
}

/**
 * Play a card as part of an effect (CR 420 limited play). Pays the remaining resources first (auto-pay) and
 * returns whether the card was played. Unaffordable plays do nothing.
 */
export function playIt(ctx: Ctx, id: ObjId, o: PlayItOpts = {}): boolean {
  const p = o.payer ?? ctx.controller;
  const c = ctx.as(p);
  const obj = ctx.obj(id);
  if (!obj) return false;
  const mode = o.cost ?? 'free';
  const dests = [...(o.extraDests ?? []), ...(typeof o.dest === 'number' ? [o.dest] : [])].filter(d => typeof d === 'number');
  if (dests.length) c.delay(EXTRA_DEST, { obj: id, epoch: obj.epoch ?? 0, dests }, 'endOfTurn');
  // ENGINE-2: the engine pays the effect cost after the choices, with additional costs (Repeat, Deflect, ...) added before
  // the reduction (CR 356, 357; RJ#2734 Void Rush + Blood Rush's Repeat)
  const ok = c.play(id, { cost: mode, destination: o.dest, noAdditional: o.allCosts });
  if (!ok && mode !== 'free' && !c.canPlayByEffect(id, { cost: mode })) c.log(`can't pay to play ${ctx.name(id)}`);
  if (ok && o.then && ctx.obj(id)?.zone === 'chain') afterChain(c, id, o.then);
  return ok;
}

/** Banish a card, then play it (Blind Fury, Reinforce, Rek'Sai...). Returns whether it was played. */
export function banishThenPlay(ctx: Ctx, id: ObjId, o: PlayItOpts = {}): boolean {
  if (!ctx.obj(id)) return false;
  ctx.banish(id);
  if (ctx.obj(id)?.zone !== 'banishment') return false;
  return playIt(ctx, id, o);
}

/** The location a board object is at, as a play destination for its owner ("the same location"). */
export function locAsDest(ctx: Ctx, id: ObjId): Destination | null {
  const l = ctx.loc(id);
  return l === null ? null : l;
}

// ------------------------------------------------------------------------------------------------
// moving cards between hand / deck / trash
// ------------------------------------------------------------------------------------------------

/** Put a card from the Main Deck into the trash (not a burn of other cards). */
export function deckToTrash(ctx: Ctx, id: ObjId): void {
  const o = ctx.obj(id);
  if (!o || o.zone !== 'mainDeck') return;
  if (ctx.deck(o.owner)[0] !== id) ctx.toDeck(id, 'top');
  ctx.burn(1, o.owner);
}

/** Return cards from the trash to their owners' hands. */
export function trashToHand(ctx: Ctx, ids: ObjId[]): void {
  for (const id of ids) if (ctx.obj(id)?.zone === 'trash') ctx.toHand(id);
}

// ------------------------------------------------------------------------------------------------
// look / reveal with Void Hatchling (sfd-018-221) and Nocturne (ogn-194-298)
// ------------------------------------------------------------------------------------------------

export interface TopOpts { reveal?: boolean; deckOwner?: PlayerId; actor?: PlayerId }

/** Look at (or reveal) the top N cards of a Main Deck through the engine's one look path (ctx.lookTop / revealTop: Nocturne,
 * Void Hatchling and every other look/reveal reaction apply). Returns the cards still there. */
export function topCards(ctx: Ctx, n: number, o: TopOpts = {}): ObjId[] {
  const owner = o.deckOwner ?? ctx.controller;
  const actor = ctx.as(o.actor ?? ctx.controller);
  if (n <= 0) return [];
  return o.reveal ? actor.revealTop(n, owner) : actor.lookTop(n, owner);
}

/** Reveal cards from the top until one matches (ctx.revealUntil). Returns the revealed cards still in the deck and the hit. */
export function revealUntil(ctx: Ctx, pred: (id: ObjId) => boolean, o: TopOpts = {}): { revealed: ObjId[]; hit: ObjId | null } {
  const r = ctx.as(o.actor ?? ctx.controller).revealUntil(pred, o.deckOwner ?? ctx.controller);
  return { revealed: r.revealed, hit: r.hit && r.revealed.includes(r.hit) ? r.hit : null };
}

/**
 * Look at / reveal the top N, optionally pick up to `max` matching cards and do something with them, then put the
 * rest at the bottom (recycle, default), in the trash, or leave them on top.
 */
export function lookPick(ctx: Ctx, n: number, o: TopOpts & {
  filter?: (id: ObjId) => boolean; min?: number; max?: number; prompt: string;
  with: (ids: ObjId[]) => void; rest?: 'recycle' | 'trash' | 'top';
  /** reveal the picked card(s) ("You may reveal a unit from among them and draw it") */
  revealPicked?: boolean;
}): { seen: ObjId[]; picked: ObjId[] } {
  let seen = topCards(ctx, n, o);
  let cands = seen.filter(id => !o.filter || o.filter(id));
  // RJ#12559: revealing one of the looked-at cards is a reveal from a deck — Void Hatchling's look/recycle comes first (a card it
  // recycles can't be revealed and isn't recycled again with the rest)
  if (o.revealPicked && !o.reveal && cands.length) {
    const avail = ctx.beforeRevealFromDeck(seen, o.deckOwner ?? ctx.controller);
    seen = avail; cands = cands.filter(id => avail.includes(id));
  }
  const picked = cands.length ? ctx.chooseCards(cands, o.min ?? 0, o.max ?? 1, o.prompt) : [];
  if (o.revealPicked && !o.reveal && picked.length) ctx.reveal(picked);
  o.with(picked);
  const rest = seen.filter(id => !picked.includes(id) && zone(ctx, id) === 'mainDeck');
  if (o.rest === 'trash') for (const id of rest) deckToTrash(ctx, id);
  else if (o.rest !== 'top' && rest.length) ctx.recycle(rest);
  return { seen, picked };
}

// ------------------------------------------------------------------------------------------------
// targeting helpers
// ------------------------------------------------------------------------------------------------

/**
 * Objects chosen so far for an earlier target group of the item being played (for filters of later groups).
 * At resolution the item's targets are used; while choosing, the 'targeted' events of this source are used.
 */
export function chosenSoFar(ctx: Ctx, group = 0): ObjId[] {
  // the engine exposes the earlier groups in ctx.targets while choosing (plays, triggers, Repeat / new choices), during the
  // legality search and while re-validating on resolution (R-14, F-3a) — no event scanning needed
  const t = ctx.item?.targets;
  if (t && t.length > group && !ctx.item?.pending) return t[group];
  return ctx.targets[group] ?? [];
}

// ------------------------------------------------------------------------------------------------
// delayed abilities
// ------------------------------------------------------------------------------------------------

/** "The next time that unit would be dealt damage this turn, prevent it." */
export const PREVENT_NEXT = delayedAbility('B7:preventNext', replacement('damage',
  // an event already prevented (amount 0) is no damage to prevent: a second Counter Strike waits for the next one (RJ#8921, CR 373)
  (ev, ctx) => ev.obj === ctx.data.obj && (ctx.obj(ev.obj as ObjId)?.epoch ?? 0) === ctx.data.epoch && Number(ev.amount ?? 0) > 0,
  (ev, ctx) => { ctx.data.__consume = true; return { ...ev, amount: 0 }; },
  { text: 'Prevent the next damage' },
));

/** "You can hide ignoring costs this turn" (cost modification of the Hide action). */
export const HIDE_FREE = delayedAbility('B7:hideFree', costModDyn(ctx => (ctx.data.payer === undefined || ctx.data.payer === ctx.controller ? { power: -1, energy: 0 } : null), { scope: 'hide' }));

// ------------------------------------------------------------------------------------------------
// misc
// ------------------------------------------------------------------------------------------------

/** Parse the Energy part of a keyword cost string like "[3][C]". */
export function energyOf(costStr: string | undefined): number {
  if (!costStr) return 0;
  let n = 0;
  for (const m of costStr.matchAll(/\[(\d+)\]/g)) n += Number(m[1]);
  return n;
}

/**
 * Approximation of "Energy spent to play this spell" (the engine doesn't record payments; see docs/dsl-requests.md):
 * 0 from hiding, the Flow cost's Energy if played from the trash with Flow, otherwise its printed Energy cost.
 */
export function estSpent(ctx: Ctx, spell: ObjId, ev?: Record<string, unknown>): number {
  if (ev?.fromHidden) return 0;
  const d = def(ctx, spell) as (ReturnType<typeof def> & { keywordCosts?: Record<string, string> }) | undefined;
  if (ev?.from === 'trash' && d?.keywordCosts?.Flow) return energyOf(d.keywordCosts.Flow);
  return ctx.energyCost(spell);
}

export { F };

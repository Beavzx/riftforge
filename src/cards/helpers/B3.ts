// Batch B3 helpers (tokens / go-wide). Owned by scripting agent B3.
// Built only on the public DSL and Ctx APIs. See docs/dsl-requests.md for the engine-level versions
// these local helpers stand in for.
import { dep, when, replacement, type Ctx, type ObjId, type PlayerId, type GameEvent } from '../dsl.ts';
import type { Dependency, ReplacementAbility, TriggeredAbility } from '../../engine/abilities.ts';
import { makeCtx } from '../../engine/context.ts';

export type Loc = 'base' | number;

// -------------------------------------------------------------------------------------
// Token definitions (CR 187). Real token cards first; the engine's synthetic defs otherwise.
// Looking tokens up by id (not by name) keeps scripts independent of hand-made test defs
// that reuse token names.
// -------------------------------------------------------------------------------------

export const TOKEN_IDS: Record<string, string> = {
  Recruit: 'ven-t04',
  Gold: 'unl-t05',
  Sprite: 'unl-t07',
  Bird: 'unl-t02',
  Reflection: 'unl-t06',
  Mech: 'tok-mech',
  Bomb: 'tok-bomb',
  'Sand Soldier': 'tok-sand-soldier',
  'Shadow Clone': 'tok-shadow-clone',
  Tentacle: 'tok-tentacle',
};

export type TokenName = keyof typeof TOKEN_IDS | string;

/** Card id of a token by name (falls back to the name, which the engine resolves). */
export function tokenId(ctx: Ctx, name: TokenName): string {
  const id = TOKEN_IDS[name];
  if (id && ctx.g.cards[id]) return id;
  for (const cid in ctx.g.cards) { const d = ctx.g.cards[cid]; if (d.name === name && d.supertypes.includes('Token')) return cid; }
  return name;
}

/** Is this object a token of the given name? */
export function isTokenNamed(ctx: Ctx, id: ObjId, name: TokenName): boolean {
  return ctx.exists(id) && ctx.isToken(id) && ctx.name(id) === name;
}

/** Where a player may put a unit token when the text gives no location (CR 440: base or a battlefield they control). */
export function unitTokenLocations(ctx: Ctx, p: PlayerId = ctx.controller): Loc[] {
  return ['base', ...ctx.controlledBattlefields(p)];
}

/** Ask player p where a unit token goes (auto-answered when only the base is possible). */
export function chooseTokenLocation(ctx: Ctx, p: PlayerId = ctx.controller, prompt = 'Play the token to'): Loc | null {
  const locs = unitTokenLocations(ctx, p);
  // RJ#1553 / CR 811.1.d.5: a unit token played by a card played from facedown is played at the battlefield it was hidden at
  const hb = ctx.data.hiddenHere;
  // (if it can't be played there — e.g. Mageseeker Warden — it isn't played at all, RJ#3977)
  if (p === ctx.controller && ctx.item?.fromHidden && typeof hb === 'number') return locs.includes(hb) ? hb : null;
  if (locs.length === 1) return locs[0];
  return ctx.as(p).chooseLocation(locs, prompt) ?? 'base';
}

export interface UnitTokenOpts {
  /** 'choose' (default: "play a token", no location given), 'here', 'base', or a battlefield index */
  at?: Loc | 'here' | 'choose';
  ready?: boolean;
  /** the player who plays the token (default: the ability's controller) */
  player?: PlayerId;
  might?: number;
}

/** "Play N <name> unit tokens [here / to your base / there]". Each token's location is chosen separately when it isn't given. */
export function playUnitTokens(ctx: Ctx, name: TokenName, count = 1, o: UnitTokenOpts = {}): ObjId[] {
  const p = o.player ?? ctx.controller;
  const id = tokenId(ctx, name);
  const out: ObjId[] = [];
  for (let i = 0; i < count; i++) {
    let at: Loc | null;
    if (o.at === undefined || o.at === 'choose') at = chooseTokenLocation(ctx, p, count > 1 ? `Play ${name} token ${i + 1} of ${count} to` : `Play the ${name} token to`);
    // "here" is read when the instruction executes: a source that left the board has no location → no token (CR 359.3.f,
    // DECISIONS principle 17; RJ#2323 Sprite Mother killed in response)
    else if (o.at === 'here') at = ctx.here();
    else at = o.at;
    if (at === null) continue;
    out.push(...ctx.createToken(id, at, { count: 1, exhausted: o.ready ? false : undefined, controller: p, might: o.might }));
  }
  return out;
}

/** "Play N Gold gear tokens [exhausted]" — gear tokens go to their player's base. */
export function playGold(ctx: Ctx, count = 1, o: { exhausted?: boolean; player?: PlayerId } = {}): ObjId[] {
  return ctx.createToken(tokenId(ctx, 'Gold'), 'base', { count, exhausted: o.exhausted ?? true, controller: o.player ?? ctx.controller });
}

/** "Play N Bomb gear tokens to a (single) battlefield": the player chooses one battlefield (Deploy: any battlefield, CR 830.1.b.1). */
export function playBombs(ctx: Ctx, count = 1, o: { bf?: number; player?: PlayerId } = {}): ObjId[] {
  const p = o.player ?? ctx.controller;
  const bf = o.bf ?? ctx.as(p).chooseBattlefield(undefined, count > 1 ? `Play ${count} Bomb tokens to which battlefield?` : 'Play the Bomb token to which battlefield?');
  if (bf === undefined) return [];
  return ctx.createToken(tokenId(ctx, 'Bomb'), bf, { count, controller: p });
}

// -------------------------------------------------------------------------------------
// Legion (CR 812.1.c): another *card* was finalized this turn. Tokens and abilities don't count.
// (The engine's dep.legion() also counts played tokens; see docs/dsl-requests.md.)
// -------------------------------------------------------------------------------------

export function legionPlayed(ctx: Ctx, self: ObjId = ctx.self): boolean {
  return ctx.playedThisTurn().some(id => id !== self && ctx.exists(id) && !ctx.isToken(id));
}
export const legion = (): Dependency => dep.custom(ctx => legionPlayed(ctx));

// -------------------------------------------------------------------------------------
// Unit counts / "alone"
// -------------------------------------------------------------------------------------

/** Units controlled by p at a location (base = p's base). */
export function unitsOfAt(ctx: Ctx, loc: Loc, p: PlayerId = ctx.controller): ObjId[] {
  return ctx.unitsAt(loc, u => ctx.ctrl(u) === p, p);
}

/** "alone": no other friendly units at its location (CR glossary; LKI-free version). */
export function isAlone(ctx: Ctx, id: ObjId): boolean {
  const l = ctx.loc(id);
  if (l === null) return false;
  const p = ctx.ctrl(id);
  return !ctx.unitsAt(l, u => u !== id && ctx.ctrl(u) === p, p).length;
}

// -------------------------------------------------------------------------------------
// Bonus damage (CR 711): "deal 1 Bonus Damage" = each instance of damage increased by 1.
// -------------------------------------------------------------------------------------

export function bonusDamage(applies: (ctx: Ctx, ev: GameEvent) => boolean, n = 1, text = 'Bonus Damage'): ReplacementAbility {
  // `bonus`: lets split damage raise its pool (CR 715.3, RJ#5474)
  return replacement('damage', (ev, ctx) => !ev.combat && Number(ev.amount) > 0 && applies(ctx, ev), ev => ({ ...ev, amount: Number(ev.amount) + n }), { text, bonus: () => n });
}

const GEAR_LKI = 'b3:gearlki:';
/** Remember the controller of gear that died (tokens cease to exist, so their abilities' damage has no source object). */
export const gearDeathRecorder: TriggeredAbility = when('die', (ev, ctx) => {
  const lki = ev.lki as { type?: string; controller?: PlayerId } | undefined;
  if (lki?.type === 'Gear' && typeof ev.obj === 'string' && ctx.count(GEAR_LKI + ev.obj) === 0) ctx.bump(GEAR_LKI + ev.obj, (lki.controller ?? 0) + 1);
  return false;
}, () => {}, { text: '(records gear deaths)' });

/** Is the damage source a gear controlled by p (on the board, or a gear that has died)? */
export function sourceIsGearOf(ctx: Ctx, src: unknown, p: PlayerId): boolean {
  if (typeof src !== 'string') return false;
  if (ctx.exists(src)) return ctx.isGear(src) && !ctx.isUnit(src) && ctx.ctrl(src) === p;
  return ctx.count(GEAR_LKI + src) === p + 1;
}

// -------------------------------------------------------------------------------------
// Excess combat damage (Yeti Brawler, Trapping Grounds): "if you assigned 3 or more excess damage".
// Excess on a unit = damage marked beyond what was lethal for it (damage - Might at death).
// Recorded by an observer on the dying units (the observer never triggers).
// -------------------------------------------------------------------------------------



// -------------------------------------------------------------------------------------
// Misc
// -------------------------------------------------------------------------------------

/** All exhausted objects that can be readied: units, gear, runes, legends. */
export function exhaustedThings(ctx: Ctx, exclude: ObjId[] = []): ObjId[] {
  const out: ObjId[] = [];
  for (const id in ctx.g.objects) {
    const o = ctx.g.objects[id];
    if (!o.exhausted || exclude.includes(id)) continue;
    const z = o.zone;
    const bfCard = ctx.g.battlefields.some(b => b.objId === id);
    if (((z === 'base' || z === 'battlefield') && !bfCard) || z === 'runePool' || z === 'legendZone') out.push(id);
  }
  return out;
}

/** Is a showdown going on at this object's battlefield? ("While I'm in a showdown") */
export function inShowdownHere(ctx: Ctx, id: ObjId = ctx.self): boolean {
  const sd = ctx.g.showdown;
  return !!sd && ctx.exists(id) && ctx.loc(id) === sd.battlefieldIndex;
}

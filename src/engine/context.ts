// EffectCtx: the API card scripts use inside effects / conditions / filters.
import type { ChainItem, Domain, GameEvent, GameState, ObjId, PlayerId, CardType } from './types.ts';
import type { TargetSpec, Destination } from './abilities.ts';
import * as A from './actions.ts';
import { ruleApplies } from './rules.ts';
import { chars, might as mightOf, mightOr0, hasKw, kwVal, isUnit, isGear, isEquipment, onBoard, attachedTo } from './chars.ts';
import { locOf, type Loc, isBattlefieldCard, facedownAt, permanentsAt } from './state.ts';
import { opponents, isOpponent, cardName, log } from './util.ts';
import { chooseOptions, askYesNo, chooseNumber as askNumber, chooseOne } from './ask.ts';
import { candidatesFor, legalTarget, destLoc, BASE_DEST } from './targets.ts';
import { counterItem, playCardByEffect, canPlayByEffect as canPlayByEffectFn, playAffordableWith as playAffordableWithFn, isDeferredPlay as isDeferredPlayFn, cardTiming, costMods as costModsFn, applyMods as applyModsFn, type EffectPlayOpts } from './play.ts';
import { resolveCost, canAfford, autoPay, executePayment, choosePayment, canPayNonResource, payNonResource, type ResolvedCost } from './payment.ts';

export class Ctx {
  data: Record<string, unknown>;
  targets: ObjId[][] = [];
  mode?: string;
  x?: number;
  /** object whose ability this is (differs from self for effect text of attached gear) */
  abilitySource?: ObjId;
  /** which execution of a Repeat (0 = first) */
  iteration = 0;
  /** chosen "shown off" object for Show Off */
  shownOff?: ObjId | null;
  constructor(public g: GameState, public self: ObjId, public controller: PlayerId, public event?: GameEvent, public item?: ChainItem, data?: Record<string, unknown>) {
    this.data = data ?? {};
  }

  // ---------------- info ----------------
  get you(): PlayerId { return this.controller; }
  get opponent(): PlayerId { return opponents(this.g, this.controller)[0]; }
  opponents(): PlayerId[] { return opponents(this.g, this.controller); }
  isOpponent(p: PlayerId): boolean { return isOpponent(this.g, this.controller, p); }
  obj(id: ObjId) { return this.g.objects[id]; }
  exists(id: ObjId | undefined): boolean { return !!id && !!this.g.objects[id]; }
  name(id: ObjId): string { return cardName(this.g, id); }
  chars(id: ObjId) { return chars(this.g, id); }
  might(id: ObjId): number { return mightOr0(this.g, id); }
  rawMight(id: ObjId): number | null { return mightOf(this.g, id); }
  has(id: ObjId, kw: string): boolean { return !!this.g.objects[id] && hasKw(this.g, id, kw); }
  kw(id: ObjId, kw: string): number { return kwVal(this.g, id, kw); }
  isUnit(id: ObjId): boolean { return isUnit(this.g, id); }
  isGear(id: ObjId): boolean { return isGear(this.g, id); }
  isEquipment(id: ObjId): boolean { return isEquipment(this.g, id); }
  type(id: ObjId): CardType { return chars(this.g, id).type; }
  tags(id: ObjId): string[] { return chars(this.g, id).tags; }
  hasTag(id: ObjId, tag: string): boolean { return chars(this.g, id).tags.includes(tag); }
  isChampion(id: ObjId): boolean { return chars(this.g, id).supertypes.includes('Champion'); }
  isToken(id: ObjId): boolean { return !!this.g.objects[id]?.isToken; }
  ctrl(id: ObjId): PlayerId { return this.g.objects[id].controller; }
  owner(id: ObjId): PlayerId { return this.g.objects[id].owner; }
  isEnemy(id: ObjId): boolean { const o = this.g.objects[id]; return !!o && isOpponent(this.g, this.controller, o.controller); }
  isFriendly(id: ObjId): boolean { const o = this.g.objects[id]; return !!o && !isOpponent(this.g, this.controller, o.controller); }
  onBoard(id: ObjId): boolean { return onBoard(this.g, id); }
  /**
   * Principle 17 / rules-decisions #64 (RJ#12846, ENGINE-9): is this trigger's source still the object that triggered (on the board,
   * not a new object since — CR 124.1)? For effects that refer to "me" / "here". True outside triggers.
   */
  sourceSame(): boolean {
    const e = this.data.__srcEpoch as number | undefined;
    if (e === undefined) return true;
    const o = this.g.objects[this.abilitySource ?? this.self];
    return !!o && (o.epoch ?? 0) === e && onBoard(this.g, this.abilitySource ?? this.self);
  }
  loc(id: ObjId): Loc | null { return locOf(this.g, id); }
  /** location of this ability's source (or of the event's object LKI if it left the board) */
  here(): Loc | null {
    const l = locOf(this.g, this.self);
    if (l !== null) return l;
    if (this.self && isBattlefieldCard(this.g, this.self)) return this.g.battlefields.findIndex(b => b.objId === this.self);
    const lk = (this.event?.lki as { obj?: ObjId; loc?: Loc } | undefined);
    if (lk && lk.obj === this.self && lk.loc !== undefined) return lk.loc;
    return null;
  }
  /** battlefield index of this battlefield card (for battlefield scripts) */
  bfIndex(): number { return this.g.battlefields.findIndex(b => b.objId === this.self); }
  atBattlefield(id: ObjId): boolean { return typeof locOf(this.g, id) === 'number'; }
  sameLocation(a: ObjId, b: ObjId): boolean {
    const la = locOf(this.g, a), lb = locOf(this.g, b);
    if (la === null || lb === null) return false;
    if (la === 'base' && lb === 'base') return this.g.objects[a].controller === this.g.objects[b].controller;
    return la === lb;
  }
  isHere(id: ObjId): boolean {
    const h = this.here(); const l = locOf(this.g, id);
    if (h === null || l === null) return false;
    if (h === 'base') return l === 'base' && this.g.objects[id].controller === this.controller;
    return h === l;
  }
  units(filter?: (id: ObjId) => boolean): ObjId[] { return A.allUnits(this.g).filter(u => !filter || filter(u)); }
  unitsAt(loc: Loc, filter?: (id: ObjId) => boolean, basePlayer?: PlayerId): ObjId[] {
    return A.unitsAtLoc(this.g, loc, loc === 'base' ? (basePlayer ?? this.controller) : undefined).filter(u => !filter || filter(u));
  }
  enemyUnits(filter?: (id: ObjId) => boolean): ObjId[] { return this.units(u => this.isEnemy(u) && (!filter || filter(u))); }
  friendlyUnits(filter?: (id: ObjId) => boolean): ObjId[] { return this.units(u => this.isFriendly(u) && (!filter || filter(u))); }
  gear(filter?: (id: ObjId) => boolean): ObjId[] {
    const out: ObjId[] = [];
    for (const id in this.g.objects) { const o = this.g.objects[id]; if ((o.zone === 'base' || o.zone === 'battlefield') && !isBattlefieldCard(this.g, id) && isGear(this.g, id) && (!filter || filter(id))) out.push(id); }
    return out;
  }
  attachments(unit: ObjId): ObjId[] { return attachedTo(this.g, unit); }
  battlefields(): number[] { return this.g.battlefields.map((_, i) => i); }
  bfController(bf: number): PlayerId | null { return this.g.battlefields[bf]?.controller ?? null; }
  controls(bf: number, p: PlayerId = this.controller): boolean { return this.g.battlefields[bf]?.controller === p; }
  controlledBattlefields(p: PlayerId = this.controller): number[] { return this.battlefields().filter(b => this.controls(b, p)); }
  bfCard(bf: number): ObjId { return this.g.battlefields[bf].objId; }
  facedownAt(bf: number): ObjId | null { return facedownAt(this.g, bf); }
  permanentsAt(bf: number): ObjId[] { return permanentsAt(this.g, bf); }
  points(p: PlayerId = this.controller): number { return this.g.players[p].points; }
  xp(p: PlayerId = this.controller): number { return this.g.players[p].xp; }
  hand(p: PlayerId = this.controller): ObjId[] { return this.g.players[p].hand; }
  deck(p: PlayerId = this.controller): ObjId[] { return this.g.players[p].mainDeck; }
  trash(p: PlayerId = this.controller): ObjId[] { return this.g.players[p].trash; }
  runes(p: PlayerId = this.controller): ObjId[] { return this.g.players[p].runesInPlay; }
  legend(p: PlayerId = this.controller): ObjId { return this.g.players[p].legend; }
  /** B4-3: battlefields this player conquered this turn */
  conqueredThisTurn(p: PlayerId = this.controller): number[] { return (this.g.ex.turnFacts[`conquered:${p}`] as number[] | undefined) ?? []; }
  /** B3-7 / B4-9: excess combat damage assigned by a player in the current/last combat */
  excessDamage(p: PlayerId = this.controller): number { return Number((this.g.ex.turnFacts[`excess:${p}`] as number | undefined) ?? 0); }
  isMyTurn(): boolean { return this.g.activePlayer === this.controller; }
  inShowdown(): boolean { return !!this.g.showdown; }
  inCombat(): boolean { return !!this.g.showdown?.isCombat; }
  isAttacking(id: ObjId): boolean { return this.g.objects[id]?.combatRole === 'attacker'; }
  isDefending(id: ObjId): boolean { return this.g.objects[id]?.combatRole === 'defender'; }
  isStunned(id: ObjId): boolean { return !!this.g.objects[id]?.stunned; }
  isBuffed(id: ObjId): boolean { return !!this.g.objects[id]?.counters.buff; }
  isExhausted(id: ObjId): boolean { return !!this.g.objects[id]?.exhausted; }
  isEmpowered(id: ObjId = this.self): boolean { return (this.g.objects[id]?.empowered ?? 0) > 0; }
  isMighty(id: ObjId): boolean { const m = mightOf(this.g, id); return m !== null && m >= 5; }
  damage(id: ObjId): number { return this.g.objects[id]?.damage ?? 0; }
  /** has lethal damage marked (it will die in the next cleanup) — for "if this kills it" */
  lethallyDamaged(id: ObjId): boolean { return A.isLethallyDamaged(this.g, id); }
  playedThisTurn(p: PlayerId = this.controller): ObjId[] { return this.g.ex.playedThisTurn[p] ?? []; }
  count(key: string): number { return this.g.ex.counts[key] ?? 0; }
  bump(key: string, n = 1): number { this.g.ex.counts[key] = (this.g.ex.counts[key] ?? 0) + n; return this.g.ex.counts[key]; }
  turn(): number { return this.g.turn; }

  // ---------------- targets ----------------
  /** first still-legal target of group i */
  target(i = 0): ObjId | undefined { return this.targets[i]?.[0]; }
  targetsOf(i = 0): ObjId[] { return this.targets[i] ?? []; }
  /** R-2: the location chosen in destination group i (T.destination) — 'base' or a battlefield index */
  destination(i = 0): Loc | null { return destLoc(this.g, this.targets[i]?.[0]); }
  /** Can an effect move `unit` to `to` (a valid destination, and no "can't move" rule negates the move)? */
  canMoveTo(unit: ObjId | undefined, to: Loc | null): boolean {
    if (!this.validMoveDest(unit, to)) return false;
    return !ruleApplies(this.g, 'cantMove', unit, locOf(this.g, unit!), to, this.controller);
  }
  /**
   * R-2: is `to` a valid Move Destination for `unit` (CR 355.4: another location; 449.2 / 451.2: battlefield entry limits)?
   * "Can't move" prohibitions don't make it invalid — they negate the move (VEN-FAQ #33 Vilemaw's Lair + Ride the Wind, RJ#181).
   */
  validMoveDest(unit: ObjId | undefined, to: Loc | null): boolean {
    if (!unit || to === null || !this.onBoard(unit)) return false;
    const from = locOf(this.g, unit);
    if (from === null || from === to) return false;
    return to === 'base' || A.canEnterBattlefield(this.g, to, this.g.objects[unit].controller);
  }
  /** the location a destination choice id stands for ("loc:base" / a battlefield card) */
  destOf(id: string): Loc | null { return destLoc(this.g, id); }
  /**
   * Chosen split amounts for a split target group (id -> amount). Bonus Damage (CR 715.3) is part of the pool: the bonus common to
   * every recipient raises the amount to split (Annie / a split among units all at Void Gate: 5 → 6); a recipient-specific
   * remainder (Void Gate when only some recipients are there — "only for damage dealt to units at Void Gate", OGN-FAQ) is added to
   * that recipient's part. The returned amounts already include the bonus: deal them with `dealSplit` / `noBonus`.
   */
  split(i = 0, total?: number, source: ObjId | null = this.self): Record<ObjId, number> {
    const key = `split${i}:${this.iteration}`;
    const have = (this.item?.choices[key] ?? this.data[key]) as Record<ObjId, number> | undefined;
    if (have) return have;
    let ids = this.targetsOf(i).filter(id => this.onBoard(id));
    let amount = total;
    if (amount === undefined) {
      const sp = (this.item ? specAmount(this) : undefined);
      amount = sp ?? 0;
    }
    const bonusOf = (id: ObjId) => amount! > 0 ? bonusDamageForFn(this.g, { type: 'damage', obj: id, amount, source, player: this.controller, combat: false }) : 0;
    const bonus0 = ids.length ? Math.min(...ids.map(bonusOf)) : 0;
    if (amount > 0) amount += bonus0;     // CR 715.3 (715.4: no damage → no bonus)
    // R-4 (CR 355.14.h-h.1): with fewer damage than targets, the controller chooses which targets stay (each gets >= 1)
    if (amount > 0 && ids.length > amount) {
      ids = chooseOptions(this.g, this.controller, 'chooseCards', `Split ${amount}: choose ${amount} of the targets to keep`, ids.map(id => ({ id, label: this.labelOf(id), objIds: [id] })), amount, amount, { source: this.self });
    }
    const out: Record<ObjId, number> = {};
    let left = amount;
    ids.forEach((id, k) => {
      if (left <= 0) return;
      if (k === ids.length - 1) { out[id] = left; return; }
      const n = askNumber(this.g, this.controller, `Split: how much to ${cardName(this.g, id)}? (${left} left)`, Math.min(1, left), Math.max(1, left - (ids.length - k - 1)), this.self);
      out[id] = n; left -= n;
    });
    for (const id of Object.keys(out)) if (out[id] > 0) out[id] += Math.max(0, bonusOf(id) - bonus0);
    if (this.item) this.item.choices[key] = out; else this.data[key] = out;
    return out;
  }
  /** Split damage of target group i (amount from the spec or `total`) and deal it — Bonus Damage is in the pool (CR 715.3). */
  dealSplit(i = 0, total?: number, source: ObjId | null = this.self): Record<ObjId, number> {
    const legal = this.targetsOf(i).filter(id => this.onBoard(id));
    if (!legal.length) return {};
    const parts = this.split(i, total, source);
    const spell = !!source && this.g.objects[source]?.zone === 'chain';
    return A.dealDamage(this.g, { player: this.controller, obj: source ?? undefined, spell, noBonus: true },
      Object.entries(parts).filter(([id]) => legal.includes(id)).map(([id, amount]) => ({ id, amount })));
  }

  // ---------------- choices (made on resolution; not targeting unless spec.pick === false) ----------------
  choose(spec: TargetSpec): ObjId[] {
    const cands = candidatesFor(this.g, this, spec);
    const min = Math.min(spec.min ?? 1, cands.length), max = Math.min(spec.max ?? 1, cands.length);
    if (cands.length === 0) return [];
    const ids = chooseOptions(this.g, this.controller, 'chooseTargets', spec.prompt ?? 'Choose', cands.map(id => ({ id, label: this.labelOf(id), objIds: [id] })), min, max, { source: this.self, hint: spec.hint });
    if (!spec.pick) for (const id of ids) if (this.g.objects[id]) this.emitTargeted(id);
    return ids;
  }
  chooseOneObj(spec: TargetSpec): ObjId | undefined { return this.choose({ ...spec, min: spec.min ?? 1, max: 1 })[0]; }
  private emitTargeted(id: ObjId) { emitTargetedFn(this.g, id, this.controller, this.self); }
  labelOf(id: string): string {
    if (this.g.objects[id]) {
      const l = locOf(this.g, id);
      return `${cardName(this.g, id)}${l === null ? '' : l === 'base' ? ' (base)' : ' @' + cardName(this.g, this.g.battlefields[l].objId)}`;
    }
    if (id === BASE_DEST) return 'Base';
    const it = this.g.chain.find(c => c.id === id);
    return it ? (it.label ?? cardName(this.g, it.source)) : id;
  }
  may(prompt: string): boolean { return askYesNo(this.g, this.controller, prompt, this.self); }
  mayFor(p: PlayerId, prompt: string): boolean { return askYesNo(this.g, p, prompt, this.self); }
  chooseMode(options: { id: string; label: string }[], prompt = 'Choose one'): string {
    return chooseOne(this.g, this.controller, 'chooseMode', prompt, options, { source: this.self });
  }
  chooseNumber(min: number, max: number, prompt = 'Choose a number'): number { return askNumber(this.g, this.controller, prompt, min, max, this.self); }
  /** pick cards from an explicit list (hand, revealed cards, trash...) — not targeting */
  chooseCards(ids: ObjId[], min: number, max: number, prompt: string, chooser: PlayerId = this.controller): ObjId[] {
    if (ids.length === 0) return [];
    return chooseOptions(this.g, chooser, 'chooseCards', prompt, ids.map(id => ({ id, label: this.labelOf(id), objIds: [id] })), Math.min(min, ids.length), Math.min(max, ids.length), { source: this.self });
  }
  chooseOpponent(prompt = 'Choose an opponent'): PlayerId {
    const opps = this.opponents();
    if (opps.length <= 1) return opps[0];
    return Number(chooseOne(this.g, this.controller, 'chooseOpponent', prompt, opps.map(p => ({ id: String(p), label: this.g.players[p].name })))) as PlayerId;
  }
  chooseBattlefield(filter?: (bf: number) => boolean, prompt = 'Choose a battlefield'): number | undefined {
    const bfs = this.battlefields().filter(b => !filter || filter(b));
    if (bfs.length === 0) return undefined;
    return Number(chooseOne(this.g, this.controller, 'chooseBattlefield', prompt, bfs.map(b => ({ id: String(b), label: cardName(this.g, this.bfCard(b)), objIds: [this.bfCard(b)] })), { source: this.self }));
  }
  chooseLocation(options: Loc[], prompt = 'Choose a location'): Loc | undefined {
    if (options.length === 0) return undefined;
    const r = chooseOne(this.g, this.controller, 'chooseDestination', prompt, options.map(l => ({ id: String(l), label: l === 'base' ? 'Base' : cardName(this.g, this.bfCard(l)) })), { source: this.self });
    return r === 'base' ? 'base' : Number(r);
  }
  isLegalTarget(spec: TargetSpec, id: ObjId): boolean { return legalTarget(this.g, this, spec, id); }

  // ---------------- actions ----------------
  private ids(x: ObjId | ObjId[] | undefined | null): ObjId[] { return x == null ? [] : Array.isArray(x) ? x.filter(Boolean) : [x]; }
  deal(amount: number, targets: ObjId | ObjId[] | undefined | null, source: ObjId | null = this.self): Record<ObjId, number> {
    const spell = !!source && this.g.objects[source]?.zone === 'chain';
    return A.dealDamage(this.g, { player: this.controller, obj: source ?? undefined, spell }, this.ids(targets).map(id => ({ id, amount })));
  }
  /** opts.noBonus: the amounts already include Bonus Damage (parts of a `split`, CR 715.3); opts.unitDealt: the effect names the
   *  unit `source` as the dealer ("it deals damage equal to its Might", CR 418.6.b.3) — not spell/ability damage */
  dealEach(list: { id: ObjId; amount: number }[], source: ObjId | null = this.self, opts: { noBonus?: boolean; unitDealt?: boolean } = {}) { return A.dealDamage(this.g, { player: this.controller, obj: source ?? undefined, ...(opts.noBonus ? { noBonus: true } : {}), ...(opts.unitDealt ? { unitDealt: true } : {}) }, list); }
  /** `performers`: who performs each kill when the instruction has other players kill (Cull the Weak; DECISIONS #3618 B) */
  kill(targets: ObjId | ObjId[] | undefined | null, performers?: Record<ObjId, PlayerId>): ObjId[] { return A.kill(this.g, this.ids(targets), { player: this.controller, obj: this.self }, performers); }
  /**
   * Banish; the cards are linked to `this.self` ("banished with this"). SF-3: `linkTo` names another object (an Equipment whose
   * band banishes its host: The Zero Drive), `linkTo: null` links to nothing.
   */
  banish(targets: ObjId | ObjId[] | undefined | null, o: { linkTo?: ObjId | null } = {}): ObjId[] {
    const by = 'linkTo' in o ? (o.linkTo ?? undefined) : this.self;
    const out = A.banish(this.g, this.ids(targets), by);
    if (!by) for (const id of out) delete this.g.ex.links[id];
    return out;
  }
  recycle(targets: ObjId | ObjId[] | undefined | null): ObjId[] { return A.recycle(this.g, this.ids(targets)); }
  returnToHand(targets: ObjId | ObjId[] | undefined | null): ObjId[] { return this.ids(targets).flatMap(id => A.returnToHand(this.g, [id], { source: this.self, chosen: this.chose(id), player: this.controller })); }
  discard(n: number, p: PlayerId = this.controller): ObjId[] { return A.chooseDiscard(this.g, p, n, this.self); }
  discardCards(ids: ObjId[], p: PlayerId = this.controller): ObjId[] { return A.discard(this.g, p, ids); }
  draw(n = 1, p: PlayerId = this.controller): ObjId[] { return A.draw(this.g, p, n); }
  burn(n: number, p: PlayerId = this.controller): ObjId[] { return A.burn(this.g, p, n); }
  channel(n = 1, exhausted = false, p: PlayerId = this.controller): ObjId[] {
    const got = A.channel(this.g, p, n, exhausted);
    if (got.length) log(this.g, p, `${this.g.players[p].name} channels ${got.length} rune${got.length > 1 ? 's' : ''}${exhausted ? ' exhausted' : ''}`);
    return got;
  }
  ready(targets: ObjId | ObjId[] | undefined | null) { A.ready(this.g, this.ids(targets), this.controller); }
  exhaust(targets: ObjId | ObjId[] | undefined | null) { A.exhaust(this.g, this.ids(targets), this.controller); }
  stun(targets: ObjId | ObjId[] | undefined | null) { for (const id of this.ids(targets)) A.stun(this.g, [id], this.controller, { source: this.self, chosen: this.chose(id) }); }
  buff(target: ObjId | undefined | null): boolean { return target ? A.buff(this.g, target, false, this.controller) : false; }
  spendBuff(target: ObjId): boolean { return A.spendBuff(this.g, target); }
  heal(targets: ObjId | ObjId[] | undefined | null) { A.heal(this.g, this.ids(targets)); }
  /** +N/-N Might (CR 477.3) for a duration */
  giveMight(targets: ObjId | ObjId[] | undefined | null, n: number, duration: 'endOfTurn' | 'endOfCombat' | 'permanent' | 'whileSource' = 'endOfTurn') {
    for (const id of this.ids(targets)) {
      if (!this.onBoard(id)) continue;
      // N4: Might changes pass through replacement effects ({type:'giveMight', amount, source, chosen})
      const ev = applyReplacementsFn(this.g, { type: 'giveMight', obj: id, amount: n, source: this.self, player: this.controller, chosen: this.chose(id), duration });
      if (!ev || ev.type !== 'giveMight') continue;
      const amt = Number(ev.amount);
      if (amt !== 0) A.addModifier(this.g, String(ev.obj ?? id), { source: this.self, duration: (ev.duration as typeof duration) ?? duration, might: amt, data: { by: this.controller } });
    }
  }
  /** did this spell/ability choose (target) the object? */
  chose(id: ObjId): boolean { return !!this.item && this.item.targets.some(grp => grp.includes(id)); }
  setMight(targets: ObjId | ObjId[] | undefined | null, n: number, duration: 'endOfTurn' | 'endOfCombat' | 'permanent' = 'endOfTurn') {
    for (const id of this.ids(targets)) if (this.onBoard(id)) A.addModifier(this.g, id, { source: this.self, duration, setMight: n });
  }
  giveKeyword(targets: ObjId | ObjId[] | undefined | null, kw: string | string[], duration: 'endOfTurn' | 'endOfCombat' | 'permanent' | 'whileSource' = 'endOfTurn') {
    const kws = Array.isArray(kw) ? kw : [kw];
    for (const id of this.ids(targets)) if (this.g.objects[id]) A.addModifier(this.g, id, { source: this.self, duration, addKeywords: kws });
  }
  removeKeyword(targets: ObjId | ObjId[] | undefined | null, kw: string | string[], duration: 'endOfTurn' | 'endOfCombat' | 'permanent' = 'endOfTurn') {
    const kws = Array.isArray(kw) ? kw : [kw];
    for (const id of this.ids(targets)) if (this.g.objects[id]) A.addModifier(this.g, id, { source: this.self, duration, removeKeywords: kws });
  }
  /** grant a registered ability (registry.registerGrant) */
  grant(targets: ObjId | ObjId[] | undefined | null, key: string, duration: 'endOfTurn' | 'endOfCombat' | 'permanent' | 'whileSource' = 'endOfTurn') {
    for (const id of this.ids(targets)) if (this.g.objects[id]) A.addModifier(this.g, id, { source: this.self, duration, grants: [key] });
  }
  untargetable(targets: ObjId | ObjId[] | undefined | null, duration: 'endOfTurn' | 'permanent' = 'endOfTurn') {
    for (const id of this.ids(targets)) if (this.g.objects[id]) A.addModifier(this.g, id, { source: this.self, duration, cantBeChosenByEnemy: true });
  }
  move(targets: ObjId | ObjId[] | undefined | null, to: Loc): ObjId[] { return A.moveUnits(this.g, this.ids(targets), to, 'effect', this.controller); }
  recall(targets: ObjId | ObjId[] | undefined | null) { A.recall(this.g, this.ids(targets)); }
  createToken(nameOrId: string, loc: Loc = 'base', opts: A.TokenOpts & { count?: number } = {}): ObjId[] {
    const out: ObjId[] = [];
    for (let i = 0; i < (opts.count ?? 1); i++) out.push(...A.createTokens(this.g, opts.controller ?? this.controller, nameOrId, loc, opts));
    return out;
  }
  gainPoints(n = 1, p: PlayerId = this.controller, how = 'effect'): number { return A.gainPoints(this.g, p, n, how); }
  losePoints(n = 1, p: PlayerId = this.controller): number { return A.losePoints(this.g, p, n); }
  add(energy: number, power: (Domain | 'any')[] = [], only?: string) { A.addResources(this.g, this.controller, energy, power, only, this.self); }
  predict(n = 1, p: PlayerId = this.controller) { A.predict(this.g, p, n, this.self); }
  /** Look at the top N cards of a Main Deck (THE look path: replacements + "as you look at me" abilities). */
  lookTop(n: number, p: PlayerId = this.controller): ObjId[] { return A.lookDeck(this.g, this.controller, p, n, { source: this.self }); }
  /** Reveal cards from the top until one matches; returns {revealed (still in deck), hit}. */
  revealUntil(pred: (id: ObjId) => boolean, p: PlayerId = this.controller): { revealed: ObjId[]; hit: ObjId | null } {
    const ids = A.lookDeck(this.g, this.controller, p, 'all', { reveal: true, until: pred, source: this.self });
    const hit = ids.length && pred(ids[ids.length - 1]) ? ids[ids.length - 1] : null;
    return { revealed: ids, hit };
  }
  /** Draw a specific card (a Draw game action: replacements, draw triggers, draw counts). */
  drawCard(id: ObjId, p: PlayerId = this.controller): boolean { return A.drawCard(this.g, p, id); }
  /** Put a card into one of its owner's zones (not a game action like kill/discard/burn: no events except leaveBoard). */
  toZone(id: ObjId, zone: 'trash' | 'hand' | 'banishment' | 'championZone' | 'legendZone' | 'setAside' | 'mainDeckTop' | 'mainDeckBottom'): boolean {
    if (!this.g.objects[id]) return false;
    if (zone === 'trash') return A.toTrash(this.g, id);
    if (zone === 'mainDeckTop' || zone === 'mainDeckBottom') return import_moveToZone(this.g, id, 'mainDeck', { position: zone === 'mainDeckTop' ? 'top' : 'bottom' });
    return import_moveToZone(this.g, id, zone);
  }
  /** A context for another player acting in this effect ("they choose", "that player pays") — same source/item/data. */
  as(p: PlayerId): Ctx {
    const sub = new Ctx(this.g, this.self, p, this.event, this.item, this.data);
    sub.targets = this.targets; sub.mode = this.mode; sub.x = this.x; sub.abilitySource = this.abilitySource; sub.iteration = this.iteration;
    return sub;
  }
  /** Per-object memory that lasts while the object stays the same object (survives turns). */
  memo<T = unknown>(obj: ObjId, key: string, value?: T): T | undefined {
    const o = this.g.objects[obj]; if (!o) return undefined;
    const k = `${obj}#${o.epoch ?? 0}:${key}`;
    if (value !== undefined) { this.g.ex.memo[k] = value as unknown; return value; }
    return this.g.ex.memo[k] as T | undefined;
  }
  /**
   * Turn history (all per turn, reset at turn start). Keys: played, spells, energySpent, powerSpent, maxSpellEnergy,
   * spellEnergy, playedToBf, chose, choseEnemy, unitsDied, gearDied, permanentsDied, unitsDiedBeginning, discard, draws,
   * xpGained, conquered, holdPoints.
   */
  history(key: string, p: PlayerId = this.controller): number { return this.g.ex.counts[`${key}:${p}`] ?? 0; }
  /** moves of an object this turn */
  movesThisTurn(id: ObjId): number { return this.g.objects[id]?.movesThisTurn ?? 0; }
  /** R-7: put a reflexive item ("Do this: ...") on the chain after this resolution: dsl.reflexiveAbility(key, ...) */
  reflexive(key: string, data: Record<string, unknown> = {}) {
    // SF2-2 (CR 389.1, 383.3.d): the reflexive item is a pending item met with the latest event batch (e.g. the token play that
    // also triggered Weaponmaster), so its controller orders it together with that batch's triggers
    const batch = this.g.ex.memo?.__batch as number | undefined;
    (this.g.triggerQueue as import('./events.ts').QueuedTrigger[]).push({ source: this.self || null, key: `delayed:${key}`, controller: this.controller, event: { type: '__reflexive', source: this.self, item: this.item?.id ?? null }, data, ts: ++this.g.timestamp, ...(batch !== undefined ? { batch } : {}) });
  }
  /**
   * B8-4 / CR 383.4.g "activate the [conquer] effects of units here": queue those objects' triggered abilities for
   * the event type as if it happened (their other conditions are checked).
   */
  activateTriggers(objs: ObjId[], ev: GameEvent): number { return activateTriggersFn(this.g, objs, ev); }
  /** B8-5 Neeko: put one of the player's extra legends into the Legend Zone while this object stays on the board */
  addLegend(legend: ObjId, whileSourceOnBoard = true): boolean {
    const o = this.g.objects[legend];
    if (!o || !this.g.ex.extraLegends[o.owner]?.includes(legend) || o.zone === 'legendZone') return false;
    o.zone = 'legendZone'; o.exhausted = false; o.timestamp = ++this.g.timestamp; this.g.timestamp++;
    if (whileSourceOnBoard) this.delay('core:returnLegend', { legend, src: this.self, epoch: this.g.objects[this.self]?.epoch ?? 0 }, 'never', 1);
    log(this.g, this.controller, `${cardName(this.g, legend)} enters the Legend Zone`, [legend]);
    return true;
  }
  extraLegends(p: PlayerId = this.controller): ObjId[] { return this.g.ex.extraLegends[p] ?? []; }
  /** events emitted together with `ev` (same batch id), optionally filtered — for "one or more" / "at the same time" */
  batchOf(ev: GameEvent | undefined = this.event, f?: (e: GameEvent) => boolean): GameEvent[] {
    if (!ev || ev.batch === undefined) return ev ? [ev] : [];
    return this.g.ex.lastEvents.filter(e => e.batch === ev.batch && e.type === ev.type && (!f || f(e)));
  }
  reveal(ids: ObjId[]) { A.reveal(this.g, ids); }
  toHand(id: ObjId) {
    const o = this.g.objects[id]; if (!o) return;
    import_moveToZone(this.g, id, 'hand');
  }
  /** put a card on the top/bottom of its owner's deck */
  toDeck(id: ObjId, position: 'top' | 'bottom' = 'top') { import_moveToZone(this.g, id, 'mainDeck', { position }); }
  counter(itemId: string): boolean { return counterItem(this.g, itemId, this.controller); }
  attach(gear: ObjId, unit: ObjId): boolean { return A.attach(this.g, gear, unit); }
  detach(gear: ObjId) { A.detach(this.g, gear); }
  empower(id: ObjId = this.self, max = 1): boolean { return A.empower(this.g, id, max, this.controller); }
  /** B4-12: gain a tag (layer 1) */
  addTag(id: ObjId, tag: string, duration: 'endOfTurn' | 'permanent' = 'permanent') { if (this.g.objects[id]) A.addModifier(this.g, id, { source: this.self, duration, addTags: [tag] }); }
  disempower(id: ObjId = this.self): boolean { return A.disempower(this.g, id); }
  gainXp(n = 1, p: PlayerId = this.controller) { A.gainXp(this.g, p, n); }
  spendXp(n: number, p: PlayerId = this.controller): boolean { return A.spendXp(this.g, p, n); }
  takeControl(id: ObjId, p: PlayerId = this.controller) { A.changeControl(this.g, id, p); }
  /** Prevent the next N (or all) damage that would be dealt to a unit this turn (CR 437). */
  prevent(id: ObjId, n: number | 'all', duration: 'endOfTurn' | 'endOfCombat' = 'endOfTurn') {
    const o = this.g.objects[id]; if (!o) return;
    this.g.ex.delayed.push({ id: `d${++this.g.timestamp}`, controller: this.controller, source: this.self, key: 'builtin:prevent', data: { obj: id, epoch: o.epoch ?? 0, remaining: n }, expires: duration, turn: this.g.turn, timestamp: this.g.timestamp });
  }
  /** register a delayed ability (registry.registerDelayed) */
  delay(key: string, data: Record<string, unknown> = {}, expires: 'endOfTurn' | 'endOfCombat' | 'never' | 'nextTurnEnd' | 'whileSource' = 'endOfTurn', uses?: number) {
    this.g.ex.delayed.push({ id: `d${++this.g.timestamp}`, controller: this.controller, source: this.self || null, key, data, expires, turn: this.g.turn, uses, timestamp: this.g.timestamp, sourceEpoch: this.g.objects[this.self]?.epoch });
  }
  /** play a card as part of an effect (e.g. "play it, ignoring its cost") */
  /**
   * Play a card as part of this effect (no timing restrictions). `cost`: 'free' (default, "ignoring its cost"),
   * 'full', 'noEnergy' ("ignoring its Energy cost"), { reduce, power } or { pay: CostSpec } ("play it for [A]").
   * `destinations` restricts/extends where a permanent may go; `then` = 'banish' | 'recycle' after it resolves;
   * `noAdditional` skips optional additional costs. Returns false (card left where it was) if it can't be played.
   */
  play(id: ObjId, opts: EffectPlayOpts = {}): boolean {
    // CR 811.1.d.5: a unit played by a hidden spell or a play effect of a hidden permanent must be played at that battlefield
    const hb = this.hiddenPlayBattlefield();
    if (hb !== undefined && this.g.objects[id] && chars(this.g, id).type === 'Unit') opts = { ...opts, destination: hb, destinations: [hb] };
    return playCardByEffect(this.g, this.controller, id, opts);
  }
  /** The battlefield a hidden spell / a hidden permanent's play effect is bound to (CR 811.1.d.3, .5), or undefined. */
  hiddenPlayBattlefield(): number | undefined {
    const src = this.data?.hiddenSrc as ObjId | undefined;
    const at = src !== undefined ? this.data.hiddenAt : this.data?.hiddenHere;
    return typeof at === 'number' ? at : undefined;
  }
  /**
   * The board object a just-played permanent is / will be (CR 354.4: one played while a spell or ability resolves waits on the
   * chain until it finishes, then enters as a new object). For "if you do, ... it" reflexive items. null if it wasn't played.
   */
  /**
   * The timing card `id` has as player `p` plays it (to `dest`): its keywords, Reaction from facedown (CR 811), Ambush to a battlefield
   * with p's units (CR 822.1.b), play rules. For "cards with [Reaction]" effects that must see Ambush's Reaction (RJ#11862).
   */
  playTiming(id: ObjId, p: PlayerId = this.controller, dest?: 'base' | number): 'normal' | 'action' | 'reaction' {
    const o = this.g.objects[id];
    return cardTiming(this.g, p, id, { fromHidden: o?.zone === 'facedown' || !!(this.item?.source === id && this.item.fromHidden), dest });
  }
  playedObj(id: ObjId): { id: ObjId; epoch: number } | null {
    const o = this.g.objects[id];
    if (!o) return null;
    if (isDeferredPlayFn(this.g, id)) return { id, epoch: (o.epoch ?? 0) + 1 };
    return this.onBoard(id) ? { id, epoch: o.epoch ?? 0 } : null;
  }
  /**
   * While this card is being played (asPlay): would its play cost be payable with this extra change (negative = discount)?
   * Lets "you may ... as an additional cost" choices skip options that make the play impossible (CR 355.16, F-3c).
   */
  playAffordableWith(delta: { energy?: number; power?: number } = {}): boolean { return playAffordableWithFn(this.g, this.controller, this.self, this.item, delta); }
  /** Can `id` be played by this effect with these options (cost affordable)? */
  canPlayByEffect(id: ObjId, opts: EffectPlayOpts = {}): boolean { return canPlayByEffectFn(this.g, this.controller, id, opts); }
  /**
   * Show Off (Radiance): reveal a matching card from hand or pick a friendly object on the board.
   * Returns the chosen object (information is locked in when shown) or null.
   */
  showOff(filter: (id: ObjId) => boolean, prompt = 'Show off?'): ObjId | null {
    const fromHand = this.hand().filter(id => id !== this.self && filter(id));
    const onB: ObjId[] = [];
    for (const id in this.g.objects) { const o = this.g.objects[id]; if ((o.zone === 'base' || o.zone === 'battlefield') && !isBattlefieldCard(this.g, id) && id !== this.self && this.isFriendly(id) && filter(id)) onB.push(id); }
    const all = [...fromHand, ...onB];
    if (all.length === 0) { this.shownOff = null; return null; }
    const pick = chooseOptions(this.g, this.controller, 'chooseCards', prompt, all.map(id => ({ id, label: this.labelOf(id), objIds: [id] })), 0, 1, { source: this.self });
    const id = pick[0] ?? null;
    if (id && fromHand.includes(id)) A.reveal(this.g, [id]);
    if (id) { this.data.shownOff = id; this.data.shownOffMight = mightOf(this.g, id); }
    this.shownOff = id;
    return id;
  }
  /** Can the controller pay this cost right now (resources via auto-pay + non-resource parts)? */
  canPay(cost: import('./abilities.ts').CostSpec, src: ObjId = this.self): boolean {
    return this.canPayResolved(resolveCost(cost, this.g.objects[src] ? chars(this.g, src).domains : []), src);
  }
  /**
   * A [Repeat] cost granted to a spell on the chain (Temporal Portal), with the 'repeat'-scope cost modifications that apply to
   * Repeat costs (Ezreal, Prodigy; "friendly Repeat costs cost [1] less") — CR 356 (RJ#3472). Modifiers see the base cost as
   * `item.choices.grantedRepeat`.
   */
  grantedRepeatCost(cost: import('./abilities.ts').CostSpec, spell: ObjId, item?: ChainItem): ResolvedCost {
    if (item) item.choices.grantedRepeat = cost;
    try {
      return applyModsFn(resolveCost(cost, chars(this.g, spell).domains), costModsFn(this.g, this.controller, spell, 'repeat', item));
    } finally { if (item) delete item.choices.grantedRepeat; }
  }
  /** canPay / pay for an already resolved cost (e.g. one with cost modifiers applied by the engine) */
  canPayResolved(rc: ResolvedCost, src: ObjId = this.self): boolean {
    return canPayNonResource(this.g, this.controller, src, rc) && canAfford(this.g, this.controller, rc, 'ability', { exclude: src });
  }
  /** Pay a cost during resolution (auto-pay). Returns false if it couldn't be paid. */
  pay(cost: import('./abilities.ts').CostSpec, src: ObjId = this.self): boolean {
    return this.payResolved(resolveCost(cost, this.g.objects[src] ? chars(this.g, src).domains : []), src);
  }
  payResolved(rc: ResolvedCost, src: ObjId = this.self): boolean {
    if (!canPayNonResource(this.g, this.controller, src, rc)) return false;
    const plan = autoPay(this.g, this.controller, rc, 'ability', { exclude: src });
    if (!plan) return false;
    if (!payNonResource(this.g, this.controller, src, rc)) return false;
    // A-1 / E2: a cost paid during resolution honours "choose runes when paying" (auto-pay preselected)
    executePayment(this.g, this.controller, rc, 'ability', choosePayment(this.g, this.controller, rc, 'ability', plan, src, { exclude: src }));
    return true;
  }
  /** "You may pay X to do Y": asks only if payable. */
  mayPay(cost: import('./abilities.ts').CostSpec, prompt: string): boolean {
    if (!this.canPay(cost)) return false;
    if (!this.may(prompt)) return false;
    return this.pay(cost);
  }
  // ---------------- other players' choices ----------------
  /** a different player makes this choice (opponent decides) */
  chooseFor(p: PlayerId, spec: TargetSpec): ObjId[] {
    const sub = new Ctx(this.g, this.self, p, this.event, this.item, this.data);
    return sub.choose(spec);
  }
  mayPayFor(p: PlayerId, cost: import('./abilities.ts').CostSpec, prompt: string): boolean {
    const sub = new Ctx(this.g, this.self, p, this.event, this.item, this.data);
    return sub.mayPay(cost, prompt);
  }
  /** run fn for each player in turn order (from the turn player, or starting with the next player) */
  eachPlayer(fn: (p: PlayerId) => void, opts: { startWithNext?: boolean; opponentsOnly?: boolean; others?: boolean } = {}): void {
    const start = opts.startWithNext ? nextPlayerFn(this.g, this.controller) : this.g.activePlayer;
    for (const p of turnOrderFromFn(this.g, start)) {
      if ((opts.opponentsOnly || opts.others) && (opts.opponentsOnly ? !this.isOpponent(p) : p === this.controller)) continue;
      fn(p);
    }
  }
  choosePlayer(prompt = 'Choose a player', filter?: (p: PlayerId) => boolean): PlayerId {
    const ps = this.g.players.filter(p => !p.conceded && (!filter || filter(p.id))).map(p => p.id);
    if (ps.length <= 1) return ps[0];
    return Number(chooseOne(this.g, this.controller, 'chooseOpponent', prompt, ps.map(p => ({ id: String(p), label: this.g.players[p].name })))) as PlayerId;
  }

  // ---------------- game-level hooks ----------------
  /** CR 734: an additional turn after this one */
  extraTurn(p: PlayerId = this.controller) { this.g.ex.extraTurns.unshift(p); log(this.g, p, `${this.g.players[p].name} will take an extra turn`); }
  winGame(p: PlayerId = this.controller, why = 'card effect') { declareWinnerFn(this.g, p, why); }
  scorePoint(p: PlayerId = this.controller, n = 1): number { return A.gainPoints(this.g, p, n, 'effect'); }
  /** gain control of a spell/ability on the chain; optionally remake its choices (CR 750) */
  takeControlOfItem(itemId: string, remake = false): boolean {
    const it = this.g.chain.find(c => c.id === itemId);
    if (!it) return false;
    it.controller = this.controller;
    log(this.g, this.controller, `${this.g.players[this.controller].name} gains control of ${it.label}`);
    if (remake) remakeChoicesFn(this.g, it, this.controller);
    return true;
  }
  chainItems(): ChainItem[] { return this.g.chain; }
  item_(id: string): ChainItem | undefined { return this.g.chain.find(c => c.id === id); }
  /** the objects chosen by a chain item */
  itemTargets(id: string): ObjId[] { return (this.g.chain.find(c => c.id === id)?.targets ?? []).flat(); }
  /** the card definition id an object currently copies / is */
  cardIdOf(id: ObjId): string { return chars(this.g, id).copyOf ?? this.g.objects[id].cardId; }
  /** become a copy of another object's (or card's) copyable traits (CR 477.1.b) */
  becomeCopy(id: ObjId, of: ObjId | string, duration: 'permanent' | 'endOfTurn' | 'whileSource' = 'permanent') {
    const cardId = this.g.objects[of] ? (chars(this.g, of).copyOf ?? this.g.objects[of].cardId) : of;
    if (!this.g.cards[cardId]) return;
    A.addModifier(this.g, id, { source: this.self, duration, copyOf: cardId });
    if (this.g.objects[of]?.isToken && this.g.objects[id]) this.g.objects[id].counters.tokenMight = (this.g.objects[of].counters.tokenMight ?? this.g.cards[cardId].might ?? 0);
    else if (this.g.objects[id]?.isToken) this.g.objects[id].counters.tokenMight = this.g.cards[cardId].might ?? 0;
  }
  /** gear becomes a unit with the given Might (Lady of Clockwork) */
  becomeUnit(id: ObjId, mightValue: number) { const o = this.g.objects[id]; if (o) { o.counters.unitGearMight = mightValue; this.g.ex.typeStatics = true; this.g.ex.dirty = true; } }
  stopBeingUnit(id: ObjId) { const o = this.g.objects[id]; if (o) { delete o.counters.unitGearMight; this.g.ex.dirty = true; } }
  /** replace a battlefield with a battlefield token (CR 438); the original goes to banishment */
  replaceBattlefield(bf: number, token: string): ObjId | null {
    const b = this.g.battlefields[bf];
    const cardId = A.findTokenDef(this.g, token);
    if (!b || !cardId) return null;
    const t = newObjectFn(this.g, cardId, this.controller, 'battlefield', { isToken: true });
    t.battlefieldIndex = bf;
    const old = b.objId;
    const oldObj = this.g.objects[old];
    log(this.g, this.controller, `${cardName(this.g, old)} is replaced by ${cardName(this.g, t.id)}`);
    if (oldObj?.isToken) {
      // UNL-FAQ "Brush a Brush" (DECISIONS #9356): a replaced battlefield token ceases to exist; the new token inherits what it
      // replaced, so a swap back can still return the original battlefield
      if (oldObj.counters.replaced !== undefined) t.counters.replaced = oldObj.counters.replaced;
      delete this.g.objects[old];
    } else {
      t.counters.replaced = Number(old.slice(1));
      import_moveToZone(this.g, old, 'banishment');
    }
    b.objId = t.id;
    return t.id;
  }
  /** swap a replacement battlefield token back to what it replaced */
  swapBackBattlefield(bf: number): boolean {
    const b = this.g.battlefields[bf];
    const t = this.g.objects[b.objId];
    if (!t || t.counters.replaced === undefined) return false;
    const old = `o${t.counters.replaced}`;
    if (!this.g.objects[old]) return false;
    import_moveToZone(this.g, old, 'setAside');
    const o = this.g.objects[old];
    o.zone = 'battlefield'; o.battlefieldIndex = bf; this.g.players[o.owner].banishment = this.g.players[o.owner].banishment.filter(x => x !== old);
    delete this.g.objects[b.objId];
    b.objId = old;
    return true;
  }
  /** add a battlefield token to the board (Baron Pit) */
  addBattlefield(token: string): number | null {
    const cardId = A.findTokenDef(this.g, token);
    if (!cardId) return null;
    if (this.g.battlefields.some(b => this.g.objects[b.objId]?.cardId === cardId)) return null;
    const t = newObjectFn(this.g, cardId, this.controller, 'battlefield', { isToken: true });
    const idx = this.g.battlefields.length;
    t.battlefieldIndex = idx;
    this.g.battlefields.push({ objId: t.id, controller: null, contested: false, scoredThisTurnBy: [], contestedBy: null, owner: this.controller });
    return idx;
  }
  /** name a tag (as you play) — options are all tags in this game's card pool */
  nameTag(prompt = 'Name a tag', only?: string[]): string {
    const tags = only ?? [...new Set(Object.values(this.g.cards).flatMap(c => c.tags))].sort();
    return chooseOne(this.g, this.controller, 'chooseMode', prompt, tags.map(t => ({ id: t, label: t })), { source: this.self });
  }
  /** name a card (by name) among this game's card pool matching a filter */
  nameCard(filter: (cardId: string) => boolean = () => true, prompt = 'Name a card'): string {
    const names = [...new Set(Object.values(this.g.cards).filter(c => !c.supertypes.includes('Token') && filter(c.id)).map(c => c.name))].sort();
    if (!names.length) return '';
    return chooseOne(this.g, this.controller, 'chooseMode', prompt, names.map(n => ({ id: n, label: n })), { source: this.self });
  }
  /** cards banished by this object (linked abilities, CR 427.4) */
  banishedWithThis(src: ObjId = this.abilitySource ?? this.self): ObjId[] {
    const ep = this.g.objects[src]?.epoch ?? 0;
    return Object.entries(this.g.ex.links).filter(([id, l]) => l.by === src && l.epoch === ep && this.g.objects[id]?.zone === 'banishment').map(([id]) => id);
  }
  /** permission to play a specific card later ("Until your next Ending Phase, you may play that card") */
  allowPlay(id: ObjId, until: 'endOfTurn' | 'nextEnding' | 'never' = 'endOfTurn', opts: { ignoreCost?: boolean; player?: PlayerId } = {}) {
    const o = this.g.objects[id]; if (!o) return;
    this.g.ex.playPermissions.push({ obj: id, epoch: o.epoch ?? 0, player: opts.player ?? this.controller, until, turn: this.g.turn, ignoreCost: opts.ignoreCost });
  }
  /** two units deal damage equal to their Might to each other simultaneously */
  fight(a: ObjId, b: ObjId) {
    if (!this.onBoard(a) || !this.onBoard(b)) return;
    const ma = this.might(a), mb = this.might(b);
    // CR 418.6.b.3: the units are the source of the damage, not the spell/ability (event `unitDealt`; RJ#2602, RJ#8373)
    A.dealDamage(this.g, { player: this.g.objects[a].controller, obj: a, unitDealt: true }, [{ id: b, amount: ma }]);
    A.dealDamage(this.g, { player: this.g.objects[b].controller, obj: b, unitDealt: true }, [{ id: a, amount: mb }]);
  }
  doubleMight(id: ObjId, duration: 'endOfTurn' | 'endOfCombat' | 'permanent' = 'endOfTurn') { const m = this.might(id); if (m > 0) this.giveMight(id, m, duration); }
  swapMight(a: ObjId, b: ObjId, duration: 'endOfTurn' | 'permanent' = 'endOfTurn') {
    const ma = this.might(a), mb = this.might(b), d = Math.abs(ma - mb);
    if (d === 0) return;
    const [lo, hi] = ma < mb ? [a, b] : [b, a];
    this.giveMight(lo, d, duration); this.giveMight(hi, -d, duration);
  }
  swapLocations(a: ObjId, b: ObjId) {
    const la = locOf(this.g, a), lb = locOf(this.g, b);
    if (la === null || lb === null) return;
    this.move(a, lb === 'base' ? 'base' : lb); this.move(b, la === 'base' ? 'base' : la);
  }
  revealTop(n: number, p: PlayerId = this.controller): ObjId[] { return A.lookDeck(this.g, this.controller, p, n, { reveal: true, source: this.self }); }
  /**
   * RJ#12559 (DECISIONS #12559): about to reveal card(s) still in a Main Deck that were looked at ("reveal a unit from among them"):
   * that is a reveal from a deck, so the replaceable `revealDeck` event happens first (Void Hatchling: look at the top card, you may
   * recycle it). Call before the reveal choice; returns those of `ids` that may still be revealed (in the deck, not recycled meanwhile).
   */
  beforeRevealFromDeck(ids: ObjId[], p: PlayerId = this.controller): ObjId[] {
    const n0 = this.g.ex.lastEvents.length;
    applyReplacementsFn(this.g, { type: 'revealDeck', player: this.controller, owner: p, n: 0, source: this.self });
    const moved = new Set(this.g.ex.lastEvents.slice(n0).flatMap(e => (e.type === 'recycle' ? (e.objs as ObjId[]) : [])));
    return ids.filter(id => this.g.objects[id]?.zone === 'mainDeck' && !moved.has(id));
  }
  revealHand(p: PlayerId): ObjId[] { const ids = [...this.g.players[p].hand]; A.reveal(this.g, ids); return ids; }
  /** "As you play" hooks: add to the cost being paid (X costs, "pay any amount of Power") */
  addPlayCost(cost: import('./abilities.ts').CostSpec) {
    // state must stay plain data: resource parts go to ctx.data, non-resource parts to a step-local side table
    const prev = (this.data.__extraCost as import('./abilities.ts').CostSpec | undefined) ?? { energy: 0, power: [] };
    this.data.__extraCost = { energy: (prev.energy ?? 0) + (cost.energy ?? 0), power: [...(prev.power ?? []), ...(cost.power ?? [])] };
    if (cost.extra?.length) { const key = this.item?.id ?? '_'; PENDING_EXTRA.set(key, [...(PENDING_EXTRA.get(key) ?? []), ...cost.extra]); }
  }
  /** per-object, per-turn memory (e.g. modes already chosen this turn) */
  remember(key: string, obj: ObjId = this.abilitySource ?? this.self): void { this.g.ex.usage[`mem:${obj}#${this.g.objects[obj]?.epoch ?? 0}:${key}`] = 1; }
  remembered(key: string, obj: ObjId = this.abilitySource ?? this.self): boolean { return !!this.g.ex.usage[`mem:${obj}#${this.g.objects[obj]?.epoch ?? 0}:${key}`]; }
  /** banish the spell itself after it resolves instead of trashing it ("Banish this.") */
  banishAfterResolve() { if (this.item) this.item.choices.banishAfter = true; }
  counterReturn(itemId: string): boolean { return counterItem(this.g, itemId, this.controller, { toHand: true }); }
  isSpell(id: ObjId): boolean { return this.type(id) === 'Spell'; }
  energyCost(id: ObjId): number { return chars(this.g, id).energy ?? 0; }
  powerCost(id: ObjId): number { return chars(this.g, id).power ?? 0; }
  domains(id: ObjId): string[] { return this.g.objects[id] ? chars(this.g, id).domains : (this.data.__srcDomains as string[] | undefined) ?? []; }
  /** the player who controls this battlefield's abilities (controller or turn player if uncontrolled) */
  battlefieldOwnerPlayer(bf: number = this.bfIndex()): PlayerId { return this.g.battlefields[bf]?.controller ?? this.g.activePlayer; }
  log(text: string) { log(this.g, this.controller, text, [this.self]); }
  emit(ev: GameEvent) { emitFn(this.g, ev); }
}

import { moveToZone as import_moveToZone, newObject as newObjectFn } from './state.ts';
import { nextPlayer as nextPlayerFn, turnOrderFrom as turnOrderFromFn } from './util.ts';
import { declareWinner as declareWinnerFn } from './actions.ts';
import { remakeChoices as remakeChoicesFn } from './chain.ts';
import { emit as emitFn, activateTriggers as activateTriggersFn } from './events.ts';
import { applyReplacements as applyReplacementsFn, bonusDamageFor as bonusDamageForFn } from './replace.ts';
import { emitTargeted as emitTargetedFn } from './targets.ts';

/** the split amount declared on the item's target spec (T.unit({split: N})) */
function specAmount(ctx: Ctx): number | undefined {
  const it = ctx.item!;
  const o = ctx.g.objects[it.source];
  if (!o) return undefined;
  const s = getScriptFn(o.cardId);
  const sp = s?.abilities.find(a => a.kind === 'spell') as import('./abilities.ts').SpellAbility | undefined;
  const ab = it.kind === 'spell' ? sp : undefined;
  const specs = ab?.modes && it.mode ? ab.modes.find(m => m.id === it.mode)?.targets : ab?.targets;
  const spec = specs?.find(x => x.splitAmount !== undefined);
  if (!spec) return undefined;
  return typeof spec.splitAmount === 'function' ? spec.splitAmount(ctx) : spec.splitAmount;
}
import { getScript as getScriptFn } from '../cards/registry.ts';

/** Non-resource play costs added during "as you play" (functions; never stored in state). Keyed by chain item id. */
export const PENDING_EXTRA = new Map<string, import('./abilities.ts').ExtraCost[]>();

export function makeCtx(g: GameState, self: ObjId, controller: PlayerId, opts: { event?: GameEvent; item?: ChainItem; data?: Record<string, unknown> } = {}): Ctx {
  return new Ctx(g, self, controller, opts.event, opts.item, opts.data);
}

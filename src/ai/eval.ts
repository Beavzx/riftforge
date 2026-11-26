// META-SIM AI / AI-CORE: static evaluation of a game state from one player's point of view.
// Only public information is used for the opponent (board, points, runes, hand/deck SIZES, facedown COUNT), plus the
// evaluating player's own hand and facedown cards, so it can be applied to a determinized state without leaking
// anything. Higher = better for `p`. Wins/losses are ±WIN. Old version: src/ai/legacy/eval.ts.
//
// Features (AI-CORE overhaul, 2026-11-26):
//  - scoring race: points with an urgency term near the victory score, a two-half-turn projection (opponent's next turn,
//    then ours) of holds and conquers that respects the final-point rule (CR 473.1.b: at victory-1 a conquer only wins
//    if another battlefield was already scored that turn), and a "projected win/loss" term;
//  - board: per-unit value (Might, cost as a proxy for abilities, keywords, Equipment), battlefield presence/defence;
//  - card quality: own hand cards valued by cost (castable soon > uncastable), opponent hand by count;
//  - rune economy: runes valued by what we will have NEXT turn (a recycled rune comes back with the next channel once the
//    rune deck is short), so [C] spends cost exactly what they really cost;
//  - facedown cards: value of the card + a reaction premium (it is played later ignoring its base cost) at a battlefield
//    we keep, discounted when the battlefield is threatened; enemy facedown cards are a known unknown;
//  - reactions held up: at the end of our turn, ready runes that pay for Reaction/Action cards in hand are worth something;
//  - deck plans (src/ai/plans): weight overrides, per-card values, free bonus feature, rune value, reserve policy.
import type { GameState, ObjId, PlayerId } from '../engine/types.ts';
import { chars, hasKw, kwVal } from '../engine/chars.ts';
import { allUnits } from '../engine/actions.ts';
import { victoryScore } from '../engine/rules.ts';
import type { DeckPlan, PlanCtx } from './plans/types.ts';
import { makeCtx, cardInfo } from './core/ctx.ts';

export const WIN = 100000;

export interface EvalWeights {
  point: number;          // per point of lead
  urgency: number;        // extra per point above (victory - 4), squared
  hold: number;           // (legacy, unused)
  contestedCtl: number;   // (legacy, unused)
  might: number;          // per Might of a unit anywhere
  mightBf: number;        // extra per Might of a unit at a battlefield
  unitBase: number;       // flat per unit (a body)
  cost: number;           // per Energy+Power of a permanent (abilities beyond Might)
  card: number;           // per card in hand
  cardCost: number;       // own hand: per point of cost (castable cards), capped
  rune: number;           // per rune available next turn (ramp)
  runeNow: number;        // per rune in play now (this turn's flexibility / reactions)
  champion: number;       // chosen champion still available in the champion zone
  deckOut: number;        // penalty per missing card when the main deck is nearly empty
  xp: number;
  threatened: number;     // (legacy, unused)
  gearBase: number;       // unattached non-Equipment gear: flat + per cost
  projOpp: number;        // weight of the opponent's projected points next turn (x point)
  projMine: number;       // weight of our projected points on our next turn
  projWin: number;        // bonus/penalty when the projection reaches the victory score
  ctl: number;            // flat value of controlling a battlefield
  gearCost: number;
  hidden: number;         // premium of an own facedown card over the same card in hand
  oppHidden: number;      // threat of an enemy facedown card (beyond the card itself)
  reactReady: number;     // end of our turn: per Reaction/Action card in hand/facedown we can still pay for (max 2)
  defend: number;         // per Might defending a battlefield we control (capped at 6)
  stun: number;           // per Might of a stunned unit (lost tempo)
  extraTurn: number;      // per queued extra turn (CR 734)
  race: number;           // hold race: who reaches the victory score first by holding what they control now (default 0 = off; opt in per plan via eval.weights.race)
  siege: number;          // attack-from-base threat: mobile Might left after the projection / (defence of the weakest enemy-held battlefield + 1), capped at 1, per side (AI-CORE-2)
  siegeRace: number;      // siege multiplier shift by the hold race: the side losing the race gets (1 + siegeRace), the side winning it (1 - siegeRace)
  reinforce: number;      // our projected attacks: the opponent adds this x their runes next turn of Might to each battlefield they hold (units played there on their turn)
  overDefend: number;     // share of mightBf removed for Might at a held battlefield beyond the enemy's mobile Might + 3 (stacking a hold that cannot be attacked)
}

export const DEFAULT_WEIGHTS: EvalWeights = {
  point: 10, urgency: 2.5, hold: 6, contestedCtl: 2.5, might: 1.3, mightBf: 0.5, unitBase: 0.8, cost: 0.75,
  card: 1.2, cardCost: 0.12, rune: 1.25, runeNow: 0.2, champion: 2.5, deckOut: 3, xp: 0.3, threatened: 0.35, gearBase: 1.0, gearCost: 0.9,
  projOpp: 0.85, projMine: 0.55, projWin: 60, ctl: 1, hidden: 0.8, oppHidden: 0.6, reactReady: 1.0, defend: 0.3, stun: 0.3, extraTurn: 12, race: 0,
  siege: 5, siegeRace: 0.4, overDefend: 1, reinforce: 0.4,
};

/** Might / Assault without "this turn" / "this combat" modifiers on the unit itself (they expire before the next turn). */
export function lastingMight(g: GameState, id: ObjId): number {
  let m = 0;
  try { m = chars(g, id).might ?? 0; } catch { return 0; }
  for (const md of g.objects[id]?.modifiers ?? []) if ((md.duration === 'endOfTurn' || md.duration === 'endOfCombat') && md.might) m -= md.might;
  return Math.max(0, m);
}
function lastingAssault(g: GameState, id: ObjId): number {
  let a = kwVal(g, id, 'Assault');
  for (const md of g.objects[id]?.modifiers ?? []) {
    if (md.duration !== 'endOfTurn' && md.duration !== 'endOfCombat') continue;
    for (const k of md.addKeywords ?? []) { const mm = /^Assault\s*(\d+)?/.exec(k); if (mm) a -= mm[1] ? +mm[1] : 1; }
  }
  return Math.max(0, a);
}

const KW_BONUS: Record<string, number> = { Tank: 0.8, Shield: 0.5, Assault: 0.4, Deflect: 0.6, Ganking: 0.8, Deathknell: 0.6, Hunt: 0.3, Legion: 0.2, Backline: 0.2, Weaponmaster: 0.3 };

/** Value of one unit on the board (public). */
export function unitValue(g: GameState, id: ObjId, w: EvalWeights = DEFAULT_WEIGHTS): number {
  const o = g.objects[id];
  let c;
  try { c = chars(g, id); } catch { return 0; }
  const m = lastingMight(g, id);
  let v = w.unitBase + m * w.might + ((c.energy ?? 0) + (c.power ?? 0)) * w.cost;
  for (const k in KW_BONUS) if (c.keywords.has(k)) v += KW_BONUS[k] * Math.min(3, c.keywords.get(k) ?? 1);
  if (c.supertypes.includes('Champion')) v += 1;
  if (o.zone === 'battlefield') v += m * w.mightBf;
  if (o.stunned) v -= m * w.stun;
  return v;
}

function pointsValue(pts: number, vs: number, w: EvalWeights): number {
  const over = Math.max(0, pts - (vs - 4));
  return pts * w.point + over * over * w.urgency;
}

function costOf(g: GameState, id: ObjId): number {
  const d = g.cards[g.objects[id]?.cardId];
  return (d?.energy ?? 0) + (d?.power ?? 0);
}

/** Own hand card value: a body of options; cheap-to-castable cards are worth a little more than bricks. */
function handCardValue(g: GameState, id: ObjId, runesNext: number, w: EvalWeights): number {
  const d = g.cards[g.objects[id]?.cardId];
  if (!d) return w.card;
  const c = (d.energy ?? 0) + (d.power ?? 0);
  const castable = c <= runesNext + 1;
  return w.card + Math.min(c, 7) * w.cardCost * (castable ? 1 : 0.4);
}

function isReactive(g: GameState, id: ObjId): boolean {
  const d = g.cards[g.objects[id]?.cardId];
  return !!d?.keywords?.some(k => k === 'Reaction' || k === 'Action' || k.startsWith('Reaction') || k.startsWith('Action'));
}

export interface EvalOptions { plan?: DeckPlan | null; ctx?: PlanCtx }

let legacyEval: ((g: GameState, p: PlayerId) => number) | null = null;
/** experiments: route every evaluation through another function (null = this one) */
export function setEvalOverride(f: ((g: GameState, p: PlayerId) => number) | null): void { legacyEval = f; }

export function evaluate(g: GameState, p: PlayerId, w: EvalWeights = DEFAULT_WEIGHTS, eo: EvalOptions = {}): number {
  if (legacyEval) return legacyEval(g, p);
  if (g.winner !== null) return g.winner === p ? WIN : -WIN;
  const plan = eo.plan ?? null;
  if (plan?.eval?.weights) w = { ...w, ...plan.eval.weights };
  const vs = victoryScore(g);
  const q = (g.players.find(x => x.id !== p && !x.conceded)?.id ?? (1 - p)) as PlayerId;
  let s = 0;
  const myTurnEnd = g.activePlayer === p;    // evaluated as "we end our turn here"
  for (const pl of g.players) {
    const sign = pl.id === p ? 1 : -1;
    if (pl.conceded) { s += sign * -WIN / 2; continue; }
    let v = pointsValue(pl.points, vs, w);
    const inPlay = pl.runesInPlay.length;
    const runesNext = Math.min(12, inPlay + Math.min(2, pl.runeDeck.length));
    const runeW = pl.id === p && plan?.resources?.runeValue !== undefined ? plan.resources.runeValue : w.rune;
    v += runesNext * runeW + Math.min(12, inPlay) * w.runeNow;
    if (pl.id === p) for (const id of pl.hand) v += handCardValue(g, id, runesNext, w);
    else v += pl.hand.length * (w.card + 3 * w.cardCost);
    if (pl.championZone.length) v += w.champion;
    if (pl.mainDeck.length < 5) v -= (5 - pl.mainDeck.length) * w.deckOut;
    v += (pl.xp ?? 0) * w.xp;
    s += sign * v;
  }
  // battlefield knowledge: Frozen Fortress (1 damage to each unit here at every Beginning Phase) kills 1-Might units;
  // Forbidding Waste (a lone defender has -2)
  const bfName = g.battlefields.map(b => g.cards[g.objects[b.objId]?.cardId]?.name ?? '');
  const unitsAtBf: Record<string, number>[] = g.battlefields.map(() => ({}));
  // units
  const mightAt: Record<string, number>[] = g.battlefields.map(() => ({}));
  for (const u of allUnits(g)) {
    const o = g.objects[u];
    const sign = o.controller === p ? 1 : -1;
    const doomed = o.zone === 'battlefield' && o.battlefieldIndex !== undefined && bfName[o.battlefieldIndex] === 'Frozen Fortress' && lastingMight(g, u) - (o.damage ?? 0) <= 1;
    // a stun ends with the turn: it only costs the unit something while its controller's current turn goes on
    const stunBack = o.stunned && !(o.controller === g.activePlayer && g.activePlayer !== p) ? lastingMight(g, u) * w.stun : 0;
    s += sign * (unitValue(g, u, w) + stunBack) * (doomed ? 0.3 : 1);
    if (doomed) continue;
    if (o.zone === 'battlefield' && o.battlefieldIndex !== undefined && unitsAtBf[o.battlefieldIndex]) unitsAtBf[o.battlefieldIndex][o.controller] = (unitsAtBf[o.battlefieldIndex][o.controller] ?? 0) + 1;
    if (o.zone === 'battlefield' && o.battlefieldIndex !== undefined && mightAt[o.battlefieldIndex]) {
      let m = 0;
      try { m = lastingMight(g, u) + kwVal(g, u, 'Shield'); } catch { /* ignore */ }
      mightAt[o.battlefieldIndex][o.controller] = (mightAt[o.battlefieldIndex][o.controller] ?? 0) + m;
    }
  }
  // gear, attached Equipment, facedown cards
  const facedownMine: ObjId[] = [];
  for (const id in g.objects) {
    const o = g.objects[id];
    if (o.zone === 'facedown') {
      if (o.controller === p) facedownMine.push(id);
      else s -= w.card + 3 * w.cardCost + w.oppHidden;
      continue;
    }
    if (o.zone !== 'base' && o.zone !== 'battlefield') continue;
    const sign = o.controller === p ? 1 : -1;
    if (o.attachedTo) {
      if (!g.objects[o.attachedTo]) continue;
      s += sign * (0.5 + costOf(g, id) * 0.6);    // its Might bonus / keywords are already in the unit's value
      continue;
    }
    if (o.zone !== 'base') continue;
    let c;
    try { c = chars(g, id); } catch { continue; }
    if (c.type !== 'Gear') continue;
    // an unattached Equipment does nothing until equipped: a discounted promise of its Might bonus
    if (c.tags.includes('Equipment')) s += sign * (0.4 + ((c.energy ?? 0) + (c.power ?? 0)) * 0.25 + Math.max(0, c.might ?? 0) * w.might * 0.5);
    else s += sign * (w.gearBase + ((c.energy ?? 0) + (c.power ?? 0)) * w.gearCost);
  }
  // ---- two half-turn projection (threat of conquer / hold) ----
  const fresh = g.activePlayer === p;          // opponent's next action is a new turn
  // mobile attackers next half-turn: units at base (+ Ganking units anywhere), lasting Might + Assault, strongest first
  const mobileOf = (pl: PlayerId, readyOnly: boolean): number[] => {
    const out: number[] = [];
    for (const u of allUnits(g)) {
      const o = g.objects[u];
      // stuns end at the end of every turn (CR 317.2): a stun only stops a unit in the turn being played
      if (o.controller !== pl || (o.stunned && readyOnly)) continue;
      if (o.zone !== 'base' && !hasKw(g, u, 'Ganking')) continue;
      if (readyOnly && o.exhausted) continue;
      const m = lastingMight(g, u) + lastingAssault(g, u);
      if (m > 0) out.push(m);
    }
    return out.sort((a, b) => b - a);
  };
  const ctl = g.battlefields.map(b => b.controller);
  const def = g.battlefields.map((_, i) => ({ ...mightAt[i] }));
  g.battlefields.forEach((_, i) => { if (bfName[i] === 'Forbidding Waste') for (const k of Object.keys(def[i])) if (unitsAtBf[i][+k] === 1) def[i][k] = Math.max(0, def[i][k] - 2); });
  // facedown cards defend their battlefield (a Reaction played for free when attacked): mine by card (plan hook or
  // 2 for a unit / 1.5 otherwise), the opponent's as an unknown 1.5
  let ctx: PlanCtx | undefined = eo.ctx;
  const getCtx = () => (ctx ??= makeCtx(g, p));
  for (const id in g.objects) {
    const o = g.objects[id];
    if (o.zone !== 'facedown' || o.battlefieldIndex === undefined || !def[o.battlefieldIndex]) continue;
    let add = 1.5;
    if (o.controller === p) {
      const d = g.cards[o.cardId];
      add = d?.type === 'Unit' ? Math.min(4, Math.max(1, d.might ?? 2)) : 1.5;
      if (plan?.hide?.defense) { try { const ci = cardInfo(g, id); const v = ci ? plan.hide.defense(ci, o.battlefieldIndex, getCtx()) : undefined; if (v !== undefined) add = v; } catch { /* ignore */ } }
    }
    def[o.battlefieldIndex][o.controller] = (def[o.battlefieldIndex][o.controller] ?? 0) + add;
  }
  const proj: Record<number, number> = { [p]: 0, [q]: 0 };
  const lost = new Set<number>();     // battlefields p loses in the opponent's half-turn
  const halfTurn = (x: PlayerId, readyOnly: boolean, holds: boolean) => {
    let scored = 0;
    const pts = () => g.players[x].points + proj[x];
    if (holds) ctl.forEach(c => { if (c === x) { proj[x]++; scored++; } });
    const units = mobileOf(x, readyOnly);
    if (!units.length) return units;
    const targets = ctl.map((c, i) => ({ i, need: c === x ? Infinity : Object.entries(def[i]).filter(([k]) => +k !== x).reduce((t, [, v]) => t + v, 0) }))
      .filter(t => t.need < Infinity && !(g.battlefields[t.i].scoredThisTurnBy.includes(x) && g.activePlayer === x))
      .sort((a, b) => a.need - b.need);
    for (const t of targets) {
      if (!units.length) break;
      // each conquer needs its own units: the weakest single unit that beats the defence, else the strongest group
      let pick: number[] | null = null;
      for (let j = units.length - 1; j >= 0; j--) if (units[j] > t.need) { pick = [j]; break; }
      if (!pick) { let sum = 0; const idx: number[] = []; for (let j = 0; j < units.length && sum <= t.need; j++) { sum += units[j]; idx.push(j); } if (sum > t.need) pick = idx; }
      if (!pick) continue;
      const sent = pick.reduce((s2, j) => s2 + units[j], 0);
      for (const j of [...pick].sort((a, b) => b - a)) units.splice(j, 1);
      // final point rule: at victory-1 a conquer only scores if another battlefield was scored this turn
      const alreadyScored = scored > 0 || (g.activePlayer === x && !holds && g.battlefields.some(b => b.scoredThisTurnBy.includes(x)));
      if (pts() < vs - 1 || alreadyScored) proj[x]++;
      scored++;
      if (ctl[t.i] === p && x === q) lost.add(t.i);
      ctl[t.i] = x; def[t.i] = { [x]: Math.max(1, sent - t.need) };
    }
    return units;
  };
  // over-defence: Might stacked at a held battlefield beyond what the enemy can bring next turn (their mobile units + 3)
  // earns no battlefield bonus (those units would threaten more from base)
  if (w.overDefend) {
    const threat: Record<number, number> = { [p]: mobileOf(p, false).reduce((t, m) => t + m, 0), [q]: mobileOf(q, false).reduce((t, m) => t + m, 0) };
    g.battlefields.forEach((b, i) => {
      if (b.controller === null) return;
      const c = b.controller, other = c === p ? q : p;
      const excess = (mightAt[i][c] ?? 0) - (threat[other] + 3);
      if (excess > 0) s -= (c === p ? 1 : -1) * excess * w.mightBf * w.overDefend;
    });
  }
  const leftQ = halfTurn(q, !fresh, fresh);
  const oppReach = g.players[q].points + proj[q];
  // the opponent's own turn comes first: they play units to the battlefields they hold before we can attack them
  if (w.reinforce && fresh) {
    const qp = g.players[q];
    const r = w.reinforce * Math.min(12, qp.runesInPlay.length + Math.min(2, qp.runeDeck.length)) * Math.min(1, qp.hand.length / 3);
    ctl.forEach((c, i) => { if (c === q) def[i][q] = (def[i][q] ?? 0) + r; });
  }
  const leftP = halfTurn(p, false, true);
  const myReach = g.players[p].points + proj[p];
  s -= proj[q] * w.point * w.projOpp;
  s += proj[p] * w.point * w.projMine;
  if (oppReach >= vs) s -= w.projWin;
  else if (myReach >= vs) s += w.projWin * 0.6;
  // hold race (PILOT-B): turns each player needs to win by holding what they control after the projection; the player
  // who moves next (the opponent, when we end our turn) wins ties. Rewards breaking the opponent's hold when behind.
  if (w.race) {
    const holdsOf = (x: PlayerId) => ctl.filter(c => c === x).length;
    const tt = (x: PlayerId, reach: number) => { const h = holdsOf(x); return h ? Math.ceil(Math.max(0, vs - reach) / h) : 99; };
    const tMe = tt(p, myReach), tOpp = tt(q, oppReach);
    if (tMe < 99 || tOpp < 99) {
      const oppFirst = g.activePlayer === p;   // after our turn the opponent scores first
      const iWin = oppFirst ? tMe < tOpp : tMe <= tOpp;
      s += (iWin ? 1 : -1) * w.race / Math.max(1, Math.min(tMe, tOpp));
    }
  }
  // siege (AI-CORE-2): units at base are the only attackers (a unit at a battlefield must go back to base first), so the
  // mobile Might each side keeps after the projection is progress towards breaking the other side's weakest hold
  // (smooth, where the projection is a threshold). Weighted up for the side that loses the hold race.
  if (w.siege) {
    const holdsOf = (x: PlayerId) => ctl.filter(c => c === x).length;
    const tt = (x: PlayerId, reach: number) => { const h = holdsOf(x); return h ? Math.ceil(Math.max(0, vs - reach) / h) : 99; };
    const tMe = tt(p, myReach), tOpp = tt(q, oppReach);
    const behind = g.activePlayer === p ? tMe >= tOpp : tMe > tOpp;      // the opponent scores first after our turn
    const prog = (x: PlayerId, left: number[]) => {
      const m = left.reduce((t, v) => t + v, 0);
      if (m <= 0) return 0;
      let bestD = Infinity;
      ctl.forEach((c, i) => { if (c !== null && c !== x) bestD = Math.min(bestD, Object.entries(def[i]).filter(([k]) => +k !== x).reduce((t, [, v]) => t + v, 0)); });
      return bestD === Infinity ? 0 : Math.min(1, m / (bestD + 1));
    };
    const fp = tMe < 99 || tOpp < 99 ? (behind ? 1 + w.siegeRace : 1 - w.siegeRace) : 1;
    const fq = tMe < 99 || tOpp < 99 ? (behind ? 1 - w.siegeRace : 1 + w.siegeRace) : 1;
    s += w.siege * (fp * prog(p, leftP) - fq * prog(q, leftQ));
  }
  // queued extra turns (Time Warp): roughly a turn's worth of tempo each
  for (const x of g.ex.extraTurns ?? []) s += (x === p ? 1 : -1) * w.extraTurn;
  // defended battlefields, presence
  g.battlefields.forEach((b, i) => {
    const mine = mightAt[i][p] ?? 0;
    let theirs = 0;
    for (const [k, v] of Object.entries(mightAt[i])) if (+k !== p) theirs += v;
    if (b.controller === p) s += Math.min(mine, 6) * w.defend + w.ctl;
    else if (b.controller !== null) s -= Math.min(theirs, 6) * w.defend + w.ctl;
  });
  // own facedown cards: card value + reaction premium, lost if the battlefield falls
  for (const id of facedownMine) {
    const o = g.objects[id];
    const keep = o.battlefieldIndex !== undefined && g.battlefields[o.battlefieldIndex]?.controller === p && !lost.has(o.battlefieldIndex);
    let v = handCardValue(g, id, 12, w) + w.hidden + Math.min(6, g.cards[o.cardId]?.energy ?? 0) * 0.2;
    if (plan?.hide?.hideValue) { try { const ci = cardInfo(g, id); if (ci) v += plan.hide.hideValue(ci, o.battlefieldIndex ?? 0, getCtx()) ?? 0; } catch { /* ignore */ } }
    s += keep ? v : v * 0.25;
  }
  // reactions held up at the end of our turn
  if (myTurnEnd) {
    const pl = g.players[p];
    const ready = pl.runesInPlay.filter(r => !g.objects[r]?.exhausted).length;
    let n = 0;
    for (const id of pl.hand) if (isReactive(g, id) && (g.cards[g.objects[id].cardId]?.energy ?? 0) <= ready && ++n >= 2) break;
    for (const id of facedownMine) if (n < 2 && g.objects[id].hiddenTurn !== undefined) n++;
    s += Math.min(2, n) * w.reactReady;
    let rs: ReturnType<NonNullable<NonNullable<DeckPlan['resources']>['reserve']>> | undefined;
    try { rs = plan?.resources?.reserve?.(getCtx()); } catch { rs = undefined; }
    if (rs && ready >= rs.energy) {
      const names = rs.forCards;
      const has = !names || pl.hand.some(id => names.includes(g.cards[g.objects[id].cardId]?.name ?? ''));
      if (has) s += rs.value;
    }
  }
  // deck plan: per-card values and free bonus
  if (plan?.eval?.cardValue || plan?.eval?.bonus) {
    const c = getCtx();
    try {
      if (plan.eval.cardValue) {
        for (const ci of c.hand) s += plan.eval.cardValue(ci, c) ?? 0;
        for (const ci of c.board) s += plan.eval.cardValue(ci, c) ?? 0;
      }
      if (plan.eval.bonus) s += plan.eval.bonus(c);
    } catch { /* a plan bug must not crash the search */ }
  }
  return s;
}

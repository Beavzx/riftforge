// META-SIM AI: static evaluation of a game state from one player's point of view.
// Only public information is used (board, points, runes, hand/deck sizes), so it can be applied to a
// determinized state without leaking anything. Higher = better for `p`. Wins/losses are ±WIN.
import type { GameState, ObjId, PlayerId } from '../../engine/types.ts';
import { chars, hasKw, kwVal } from '../../engine/chars.ts';
import { allUnits } from '../../engine/actions.ts';
import { victoryScore } from '../../engine/rules.ts';

export const WIN = 100000;

export interface EvalWeights {
  point: number;          // per point of lead
  urgency: number;        // extra per point above (victory - 4), squared
  hold: number;           // controlled battlefield with no enemy units (≈ next hold point)
  contestedCtl: number;   // controlled battlefield that still has enemy units on it
  might: number;          // per Might of a unit anywhere
  mightBf: number;        // extra per Might of a unit at a battlefield
  unitBase: number;       // flat per unit (a body)
  cost: number;           // per Energy+Power of a permanent (abilities beyond Might)
  card: number;           // per card in hand
  rune: number;           // per rune in play (ramp)
  champion: number;       // chosen champion still available in the champion zone
  deckOut: number;        // penalty per missing card when the main deck is nearly empty
  xp: number;
  threatened: number;     // hold value multiplier for a battlefield the opponent can take next turn
  gearBase: number;       // unattached gear: flat + per cost
  projOpp: number;        // weight of the opponent's projected points next turn (x point)
  projMine: number;       // weight of our projected points on our next turn
  projWin: number;        // bonus/penalty when the projection reaches the victory score
  ctl: number;            // flat value of controlling a battlefield
  gearCost: number;
}

export const DEFAULT_WEIGHTS: EvalWeights = {
  point: 10, urgency: 2.5, hold: 6, contestedCtl: 2.5, might: 1.3, mightBf: 0.5, unitBase: 0.8, cost: 0.75,
  card: 1.2, rune: 1.4, champion: 2.5, deckOut: 3, xp: 0.3, threatened: 0.35, gearBase: 1.0, gearCost: 0.9, projOpp: 0.85, projMine: 0.55, projWin: 60, ctl: 1,
};

const KW_BONUS: Record<string, number> = { Tank: 0.8, Shield: 0.5, Assault: 0.4, Deflect: 0.6, Ganking: 0.8, Deathknell: 0.6, Hunt: 0.3, Legion: 0.2, Backline: 0.2 };

/** Value of one unit on the board (public). */
export function unitValue(g: GameState, id: ObjId, w: EvalWeights = DEFAULT_WEIGHTS): number {
  const o = g.objects[id];
  let c;
  try { c = chars(g, id); } catch { return 0; }
  const m = Math.max(0, c.might ?? 0);
  let v = w.unitBase + m * w.might + ((c.energy ?? 0) + (c.power ?? 0)) * w.cost;
  for (const [k, b] of Object.entries(KW_BONUS)) if (c.keywords.has(k)) v += b * Math.min(3, c.keywords.get(k) ?? 1);
  if (c.supertypes.includes('Champion')) v += 1;
  if (o.zone === 'battlefield') v += m * w.mightBf;
  if (o.stunned) v -= m * 0.3;
  return v;
}

function pointsValue(pts: number, vs: number, w: EvalWeights): number {
  const over = Math.max(0, pts - (vs - 4));
  return pts * w.point + over * over * w.urgency;
}

export function evaluate(g: GameState, p: PlayerId, w: EvalWeights = DEFAULT_WEIGHTS): number {
  if (g.winner !== null) return g.winner === p ? WIN : -WIN;
  const vs = victoryScore(g);
  let s = 0;
  for (const pl of g.players) {
    const sign = pl.id === p ? 1 : -1;
    if (pl.conceded) { s += sign * -WIN / 2; continue; }
    let v = pointsValue(pl.points, vs, w);
    v += pl.hand.length * w.card;
    v += Math.min(12, pl.runesInPlay.length) * w.rune;
    // META-AUDIT: a rune recycled to pay [C] comes back with the next channel once the rune deck is (nearly) empty, so
    // late-game power costs are cheaper than a permanent loss of a rune (Equip [C], Weaponmaster, Accelerate).
    v += Math.min(2, pl.runeDeck.length) * w.rune * 0.5;
    if (pl.championZone.length) v += w.champion;
    if (pl.mainDeck.length < 5) v -= (5 - pl.mainDeck.length) * w.deckOut;
    v += (pl.xp ?? 0) * w.xp;
    s += sign * v;
  }
  // units
  const mightAt: Record<string, number>[] = g.battlefields.map(() => ({}));
  for (const u of allUnits(g)) {
    const o = g.objects[u];
    const sign = o.controller === p ? 1 : -1;
    s += sign * unitValue(g, u, w);
    if (o.zone === 'battlefield' && o.battlefieldIndex !== undefined && mightAt[o.battlefieldIndex]) {
      let m = 0;
      try { m = Math.max(0, chars(g, u).might ?? 0) + kwVal(g, u, 'Shield'); } catch { /* ignore */ }
      mightAt[o.battlefieldIndex][o.controller] = (mightAt[o.battlefieldIndex][o.controller] ?? 0) + m;
    }
  }
  // gear and other permanents at base (non-unit)
  for (const id in g.objects) {
    const o = g.objects[id];
    if (o.zone !== 'base' || o.attachedTo) continue;
    let c;
    try { c = chars(g, id); } catch { continue; }
    if (c.type !== 'Gear') continue;
    // META-AUDIT: an unattached Equipment does nothing until equipped; value it as a discounted promise of its
    // Might bonus so that equipping it (paying its Equip cost) shows up as a gain.
    if (c.tags.includes('Equipment')) s += (o.controller === p ? 1 : -1) * (0.4 + ((c.energy ?? 0) + (c.power ?? 0)) * 0.25 + Math.max(0, c.might ?? 0) * w.might * 0.5);
    else s += (o.controller === p ? 1 : -1) * (w.gearBase + ((c.energy ?? 0) + (c.power ?? 0)) * w.gearCost);
  }
  for (const id in g.objects) {
    const o = g.objects[id];
    if (!o.attachedTo || !g.objects[o.attachedTo]) continue;
    let c2;
    try { c2 = chars(g, id); } catch { continue; }
    s += (o.controller === p ? 1 : -1) * (0.5 + ((c2.energy ?? 0) + (c2.power ?? 0)) * 0.6);   // equipment: its Might bonus is already in the unit's Might
  }
  // ---- two half-turn projection (threat of conquer / hold) ----
  // The opponent moves next (a fresh turn if it is our turn now): they score holds, then send their mobile
  // units (base + Ganking; all of them on a fresh turn, ready ones mid-turn) to conquer what they can beat. Then
  // we do the same on our next turn. Projected points are valued with discounts; reaching the victory score in
  // the projection is a strong (but not certain) signal.
  const q = (g.players.find(x => x.id !== p && !x.conceded)?.id ?? (1 - p)) as PlayerId;
  const fresh = g.activePlayer === p;          // opponent's next action is a new turn
  const mobileOf = (pl: PlayerId, readyOnly: boolean): number => {
    let m = 0;
    for (const u of allUnits(g)) {
      const o = g.objects[u];
      if (o.controller !== pl || o.stunned) continue;
      if (o.zone !== 'base' && !hasKw(g, u, 'Ganking')) continue;
      if (readyOnly && o.exhausted) continue;
      try { m += Math.max(0, chars(g, u).might ?? 0) + kwVal(g, u, 'Assault'); } catch { /* ignore */ }
    }
    return m;
  };
  const ctl = g.battlefields.map(b => b.controller);
  const def = g.battlefields.map((_, i) => mightAt[i]);
  const proj: Record<number, number> = { [p]: 0, [q]: 0 };
  const halfTurn = (x: PlayerId, readyOnly: boolean, holds: boolean) => {
    if (holds) ctl.forEach(c => { if (c === x) proj[x]++; });
    let m = mobileOf(x, readyOnly);
    if (m <= 0) return;
    const targets = ctl.map((c, i) => ({ i, need: c === x ? Infinity : Object.entries(def[i]).filter(([k]) => +k !== x).reduce((t, [, v]) => t + v, 0) }))
      .filter(t => t.need < Infinity && !(g.battlefields[t.i].scoredThisTurnBy.includes(x) && g.activePlayer === x))
      .sort((a, b) => a.need - b.need);
    for (const t of targets) {
      if (m > t.need) { proj[x]++; ctl[t.i] = x; m -= Math.max(1, t.need + 1); def[t.i] = { [x]: Math.max(1, t.need + 1) }; }
      if (m <= 0) break;
    }
  };
  halfTurn(q, !fresh, fresh);
  const oppReach = g.players[q].points + proj[q];
  halfTurn(p, false, true);
  const myReach = g.players[p].points + proj[p];
  s -= proj[q] * w.point * w.projOpp;
  s += proj[p] * w.point * w.projMine;
  if (oppReach >= vs) s -= w.projWin;
  else if (myReach >= vs) s += w.projWin * 0.6;
  // small terms: defended battlefields, presence
  g.battlefields.forEach((b, i) => {
    const mine = mightAt[i][p] ?? 0;
    let theirs = 0;
    for (const [k, v] of Object.entries(mightAt[i])) if (+k !== p) theirs += v;
    if (b.controller === p) s += Math.min(mine, 6) * 0.3 + w.ctl;
    else if (b.controller !== null) s -= Math.min(theirs, 6) * 0.3 + w.ctl;
  });
  void hasKw;
  return s;
}

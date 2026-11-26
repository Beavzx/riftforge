// Heuristic bot: picks sensible legal actions. Used as the vs-bot opponent and for fuzzing.
// chooseAction(state, player) returns a legal Action for the player's pending decision (or null).
import type { Action, Decision, GameState, ObjId, PlayerId } from './types.ts';
import { getLegalActions } from './game.ts';
import { validate } from './legal.ts';
import { chars, mightOr0, hasKw, kwVal, isUnit } from './chars.ts';
import { allUnits, unitsAtLoc } from './actions.ts';
import { locOf } from './state.ts';
import { opponents, isOpponent } from './util.ts';
import { victoryScore } from './rules.ts';
import { makeRng } from './rng.ts';

export interface BotOptions { randomness?: number; seed?: number }

const rngs = new Map<string, () => number>();
function rnd(o: BotOptions, g: GameState, p: PlayerId): number {
  if (!o.randomness) return 0.5;
  const k = `${o.seed ?? 0}:${p}`;
  let r = rngs.get(k);
  if (!r) { r = makeRng((o.seed ?? 0) * 31 + p); rngs.set(k, r); }
  void g;
  return r();
}

// ---------------- evaluation helpers ----------------

function sideMight(g: GameState, bf: number, p: PlayerId, asAttacker: boolean): number {
  let s = 0;
  for (const u of unitsAtLoc(g, bf)) {
    if (g.objects[u].controller !== p || g.objects[u].stunned) continue;
    s += mightOr0(g, u) + (asAttacker ? kwVal(g, u, 'Assault') : kwVal(g, u, 'Shield'));
  }
  return s;
}

function unitValue(g: GameState, id: ObjId): number {
  const c = chars(g, id);
  return (c.might ?? 0) * 2 + (c.energy ?? 0) + (c.supertypes.includes('Champion') ? 3 : 0) + (hasKw(g, id, 'Tank') ? 1 : 0);
}

function cardValue(g: GameState, id: ObjId): number {
  const c = chars(g, id);
  return (c.energy ?? 0) + (c.power ?? 0) * 1.5 + (c.might ?? 0) * 0.5;
}

function ownerOfOption(g: GameState, id: string): PlayerId | null {
  const o = g.objects[id];
  if (o) return o.controller;
  const it = g.chain.find(c => c.id === id);
  return it ? it.controller : null;
}

// ---------------- in-step decisions ----------------

function answerInStep(g: GameState, p: PlayerId, d: Decision, legal: Action[], o: BotOptions): Action {
  const opts = d.options ?? [];
  const min = d.min ?? 1, max = d.max ?? 1;
  const ch = (ids: string[]): Action => ({ type: 'choose', player: p, optionIds: ids });
  switch (d.kind) {
    case 'assignDamage': return legal[0];
    case 'payment': return ch(['auto']);
    case 'mulligan': {
      const costly = opts.filter(x => (chars(g, x.id).energy ?? 0) >= 6).sort((a, b) => cardValue(g, b.id) - cardValue(g, a.id));
      return ch(costly.slice(0, Math.min(max, 2)).map(x => x.id));
    }
    case 'optional': {
      // generally yes; decline paying when that would leave us unable to act (cheap heuristic: always yes)
      const yes = opts.find(x => x.id === 'yes');
      return ch([yes ? 'yes' : opts[0].id]);
    }
    case 'chooseMode': {
      if (opts.some(x => x.id === 'first')) return ch(['first']);
      const i = o.randomness ? Math.floor(rnd(o, g, p) * opts.length) : 0;
      return ch(opts.slice(i, i + Math.max(1, min)).map(x => x.id).concat(opts.slice(0, Math.max(0, min - 1)).map(x => x.id)).slice(0, Math.max(1, min)));
    }
    case 'chooseTargets': case 'chooseCards': case 'chooseUnitsToMove': {
      const harm = d.hint === 'harm', help = d.hint === 'help';
      const prompt = d.prompt.toLowerCase();
      const scored = opts.map(x => {
        const ctl = ownerOfOption(g, x.id);
        const enemy = ctl !== null && isOpponent(g, p, ctl);
        const val = g.objects[x.id] ? (isUnit(g, x.id) ? unitValue(g, x.id) : cardValue(g, x.id)) : 1;
        let s = val;
        if (harm) s = enemy ? 100 + val : -val;
        else if (help) s = enemy ? -val : 100 + val;
        else if (/discard|recycle|kill a friendly|spend|banish .*your/.test(prompt)) s = -val;   // costs: give up the least valuable
        else if (ctl !== null) s = enemy ? 50 + val : val;
        return { id: x.id, s };
      }).sort((a, b) => b.s - a.s);
      let n = min;
      if (max > min && (harm || help)) n = Math.min(max, scored.filter(x => x.s >= 100).length || min);
      // MA-4a: Weaponmaster — attach an unattached Equipment; pulling one off another unit (and paying its Equip again) is a waste
      if (/weaponmaster/.test(prompt)) {
        const free = scored.filter(x => g.objects[x.id] && !g.objects[x.id].attachedTo);
        return ch(free.slice(0, Math.max(min, Math.min(max, free.length ? 1 : 0))).map(x => x.id).concat(free.length >= min ? [] : scored.filter(x => !free.includes(x)).slice(0, min - free.length).map(x => x.id)));
      }
      if (/predict/.test(prompt)) n = 0;
      if (/mulligan/.test(prompt)) n = 0;
      n = Math.max(min, Math.min(max, n));
      return ch(scored.slice(0, n).map(x => x.id));
    }
    case 'chooseNumber': {
      // split damage: give as much as possible to the first target
      return ch([opts[opts.length - 1].id]);
    }
    case 'chooseDestination': {
      const base = opts.find(x => x.id === 'base');
      return ch([base ? base.id : opts[0].id]);
    }
    default:
      return legal[0] ?? ch(opts.slice(0, Math.max(1, min)).map(x => x.id));
  }
}

// ---------------- main / showdown / chain ----------------

function canWinByConquer(g: GameState, p: PlayerId): boolean {
  const pl = g.players[p];
  if (pl.points + 1 < victoryScore(g)) return false;
  return true;
}

interface Scored { a: Action; s: number }

function scoreMain(g: GameState, p: PlayerId, legal: Action[], o: BotOptions): Scored[] {
  const out: Scored[] = [];
  const opp = opponents(g, p)[0];
  for (const a of legal) {
    let s = 0;
    switch (a.type) {
      case 'endTurn': s = 0; break;
      case 'playCard': {
        const c = chars(g, a.obj);
        const cost = (c.energy ?? 0) + (c.power ?? 0);
        if (c.type === 'Unit') {
          s = 10 + cost * 2 + (c.might ?? 0);
          if (a.destination !== undefined && a.destination !== 'base') {
            // to a battlefield we control: good if contested by enemies or to defend
            const bf = a.destination as number;
            const threat = unitsAtLoc(g, bf).some(u => g.objects[u].controller !== p);
            s += threat ? 3 : -1;
          }
        } else if (c.type === 'Gear') s = 6 + cost;
        else {
          // spells: playable when there are enemy units (likely removal) or as card advantage
          const enemies = allUnits(g).filter(u => g.objects[u].controller !== p).length;
          s = 5 + cost + (enemies ? 4 : -3);
        }
        break;
      }
      case 'activate': s = a.abilityIndex >= 950 ? -5 : 4; break;
      case 'hide': s = 2; break;
      case 'move': {
        if (a.to === 'base') {
          // retreat only from hopeless battlefields we don't control
          s = -5;
          break;
        }
        const bf = a.to as number;
        const b = g.battlefields[bf];
        const mine = b.controller === p;
        if (mine) { s = -4; break; }  // already ours: units elsewhere are better
        const enemyMight = opp !== undefined ? sideMight(g, bf, opp, false) : 0;
        const enemyUnits = unitsAtLoc(g, bf).filter(u => g.objects[u].controller !== p).length;
        let myMight = 0;
        for (const u of a.units) myMight += mightOr0(g, u) + kwVal(g, u, 'Assault');
        myMight += sideMight(g, bf, p, true);
        const scoredAlready = b.scoredThisTurnBy.includes(p);
        if (scoredAlready) { s = -3; break; }
        if (enemyUnits === 0) {
          // free conquer: send the cheapest group that does it (fewest units)
          s = 30 - a.units.length * 3;
          if (canWinByConquer(g, p)) s += 100;
        } else if (myMight > enemyMight) {
          s = 25 + (myMight - enemyMight > 3 ? -2 : 2) - a.units.length;
          if (canWinByConquer(g, p)) s += 100;
        } else s = -10;
        // don't leave a controlled battlefield undefended
        for (const u of a.units) {
          const from = locOf(g, u);
          if (typeof from === 'number' && g.battlefields[from].controller === p && unitsAtLoc(g, from).filter(x => g.objects[x].controller === p).length <= a.units.filter(x => locOf(g, x) === from).length) s -= 8;
        }
        break;
      }
      default: s = 0;
    }
    if (o.randomness) s += (rnd(o, g, p) - 0.5) * o.randomness * 20;
    out.push({ a, s });
  }
  return out.sort((x, y) => y.s - x.s);
}

function scoreResponse(g: GameState, p: PlayerId, legal: Action[], o: BotOptions): Scored[] {
  const out: Scored[] = [];
  const sd = g.showdown;
  let losingCombat = false;
  if (sd?.isCombat && g.ex.combat) {
    const meAtk = sd.attacker === p;
    const mine = sideMight(g, g.ex.combat.bf, p, meAtk);
    const theirs = sideMight(g, g.ex.combat.bf, meAtk ? sd.defender! : sd.attacker!, !meAtk);
    losingCombat = mine <= theirs;
  }
  const topEnemy = g.chain.length > 0 && isOpponent(g, p, g.chain[g.chain.length - 1].controller);
  for (const a of legal) {
    let s = 0;
    if (a.type === 'pass') s = 1;
    else if (a.type === 'playCard') {
      const c = chars(g, a.obj);
      s = (losingCombat ? 6 : -2) + (topEnemy && /counter/i.test(c.name + ' ' + (g.cards[g.objects[a.obj].cardId]?.text ?? '')) ? 8 : 0);
      if (c.type === 'Unit') s += losingCombat ? 3 : -1;
    } else if (a.type === 'activate') s = a.abilityIndex >= 950 ? -5 : losingCombat ? 3 : -1;
    if (o.randomness) s += (rnd(o, g, p) - 0.5) * o.randomness * 10;
    out.push({ a, s });
  }
  return out.sort((x, y) => y.s - x.s);
}

/** Choose an action for `player` (null if it isn't their decision). */
export function chooseAction(state: GameState, player: PlayerId, opts: BotOptions = {}): Action | null {
  const d = state.pending;
  if (!d || d.player !== player || state.winner !== null) return null;
  const undone = new Set((state.ex.memo?.__rolledBack as string[] | undefined) ?? []);
  const all = getLegalActions(state, player).filter(a => a.type !== 'cancel');   // UI-CANCEL: bots never back out
  // F-3d: never re-pick an action that was just undone (fall back to all actions if nothing else is left)
  const legal = all.filter(a => !undone.has(JSON.stringify(a)));
  if (all.length === 0) return null;
  if (legal.length === 0) return all.find(a => a.type === 'pass' || a.type === 'endTurn') ?? all[0];
  if (d.inStep) {
    // F-4: answers must pass the decision's validator (sameLocation, groupRules, ...)
    const a = answerInStep(state, player, d, legal, opts);
    return validate(state, a) === null ? a : legal[0];
  }
  if (d.kind === 'mainAction') return scoreMain(state, player, legal, opts)[0].a;
  return scoreResponse(state, player, legal, opts)[0].a;
}

/** Uniformly random legal action (fuzzing). `r` is a [0,1) RNG. */
export function randomAction(state: GameState, player: PlayerId, r: () => number): Action | null {
  const d = state.pending;
  if (!d || d.player !== player) return null;
  const legal = getLegalActions(state, player).filter(a => a.type !== 'cancel');   // UI-CANCEL
  if (!legal.length) return null;
  return legal[Math.floor(r() * legal.length)];
}

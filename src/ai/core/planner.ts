// AI-CORE: turn-level planning. From a quiet main-phase state of player p, search over SEQUENCES of p's own actions
// (beam search by depth, transpositions merged by state signature), where each move is a legal action settled to the
// next quiet point or a deck-plan combo line (macro-move). Every node is scored as "end the turn here" by the static
// evaluation (which projects the opponent's next turn), plus plan priors and resource costs. Optionally the best few
// lines are re-ranked by a light reply simulation (the opponent's next turn played out by the heuristic bot in the
// determinized world). Returns the whole line, with p's in-step answers, keyed by state signatures so the caller can
// replay it while the real game follows the prediction and re-plan as soon as it deviates.
import type { Action, GameState, PlayerId } from '../../engine/types.ts';
import { applyAction, getLegalActions } from '../../engine/index.ts';
import { evaluate, WIN, type EvalWeights } from '../eval.ts';
import type { DeckPlan, PlanCtx } from '../plans/types.ts';
import { makeCtx } from './ctx.ts';
import { stateSig } from './hash.ts';
import { mainCandidates, topMain, settle, matchStep, actingCard, fastPolicy, planOptionPick, optionScorer, type Budget, type Cand } from './policy.ts';

export interface PlanStep { sig: string; a: Action }
export interface TurnPlan { steps: PlanStep[]; score: number; expanded: number; lines: number; best?: string }

export interface PlannerOpts {
  beam: number;          // states kept per depth
  depth: number;         // max own main-phase moves per line
  k0: number;            // candidates at the root
  k: number;             // candidates deeper
  settleCap: number;
  oppResponds: boolean;
  meResponds: boolean;
  combos: boolean;
  replyTop: number;      // re-rank the best N lines by a simulated opponent turn (0 = off)
  replyWeight: number;   // weight of the reply evaluation in the final score
  replyCap: number;      // max engine steps for one reply simulation
  priorWeight: number;   // default weight of plan priors in line scores
  resample: boolean;     // re-score draw/reveal lines in a second determinization
  branchOptional: boolean; // try both answers of an optional cost / the 2 best single targets asked right after a move
}

const DEBUG = !!process.env.AI_DEBUG;

export const PLANNER_DEFAULTS: PlannerOpts = {
  beam: 4, depth: 6, k0: 7, k: 5, settleCap: 40, oppResponds: false, meResponds: true, combos: true,
  replyTop: 0, replyWeight: 0.5, replyCap: 40, priorWeight: 0.25, branchOptional: true, resample: true,
};

interface PNode { g: GameState; steps: PlanStep[]; adj: number; score: number; depth: number; first: string; combos: string[]; label: string; moves: Action[] }

export function planTurn(det: GameState, p: PlayerId, plan: DeckPlan | null, w: EvalWeights, budget: Budget, o: PlannerOpts, redet?: () => GameState): TurnPlan {
  const sigOf = (g: GameState) => stateSig(g, p);
  const evalNode = (g: GameState, ctx?: PlanCtx) => evaluate(g, p, w, { plan, ctx });
  const pw = plan?.priorWeight ?? o.priorWeight;
  const root: PNode = { g: det, steps: [], adj: 0, score: evalNode(det), depth: 0, first: 'end', combos: [], label: 'end', moves: [] };
  let best = root;
  const seen = new Map<string, number>([[sigOf(det), root.score]]);
  let frontier: PNode[] = [root];
  let expanded = 0, lines = 1;
  const byFirst = new Map<string, PNode>([['end', root]]);
  const consider = (n: PNode) => {
    lines++;
    if (n.score > best.score) best = n;
    const cur = byFirst.get(n.first);
    if (!cur || n.score > cur.score) byFirst.set(n.first, n);
  };

  const recycleCost = (g: GameState, a: Action, n: number, ctx: PlanCtx | null): number => {
    if (!n || !plan?.resources?.recycleCost || !ctx) return 0;
    try { return n * (plan.resources.recycleCost(actingCard(g, a), ctx) ?? 0); } catch { return 0; }
  };

  const expandAction = (n: PNode, c: Cand, ctx: PlanCtx | null): PNode[] => {
    const sig = sigOf(n.g);
    let g: GameState;
    const runes0 = n.g.players[p].runesInPlay.length;
    try {
      let r = applyAction(n.g, c.a); budget.nodes--;
      if (r.events.some(e => e.type === 'rollback') && (c.a.type === 'playCard' || c.a.type === 'hide') && c.a.payment) {
        // an explicit payment plan the engine refused: fall back to auto-payment
        c = { ...c, a: { ...c.a, payment: undefined } }; r = applyAction(n.g, c.a); budget.nodes--;
      }
      if (r.events.some(e => e.type === 'rollback')) return [];
      g = r.state;
    } catch { return []; }
    // an optional cost / "may" asked right away (Accelerate, "pay [C] to ...", "you may ..."): try both answers when
    // the plan has no opinion (the evaluation decides whether paying is worth it)
    const branches: { g: GameState; pre: PlanStep[] }[] = [{ g, pre: [] }];
    const d0 = g.pending;
    let alts: Action[] = [];
    if (o.branchOptional && d0 && d0.inStep && d0.player === p && budget.nodes > 8) {
      if (d0.kind === 'optional' && (d0.options ?? []).length === 2 && !(plan && ctx && planOptionPick(g, d0, plan, ctx)))
        alts = d0.options!.map(opt => ({ type: 'choose', player: p, optionIds: [opt.id] }) as Action);
      else if ((d0.kind === 'chooseTargets' || d0.kind === 'chooseCards') && (d0.min ?? 1) === 1 && (d0.max ?? 1) === 1 && (d0.options ?? []).length > 1 && (d0.hint === 'harm' || d0.hint === 'help')) {
        // a single target for a removal / buff: try the two best by the target prior
        const sc = optionScorer(g, d0, plan, ctx);
        alts = d0.options!.map(x => x.id).sort((x, y) => sc(y) - sc(x)).slice(0, 2).map(id => ({ type: 'choose', player: p, optionIds: [id] }) as Action);
      }
    }
    if (alts.length > 1) {
      branches.length = 0;
      for (const a2 of alts) {
        try { const r2 = applyAction(g, a2); budget.nodes--; if (!r2.events.some(e => e.type === 'rollback')) branches.push({ g: r2.state, pre: [{ sig: sigOf(g), a: a2 }] }); } catch { /* skip */ }
      }
      if (!branches.length) branches.push({ g, pre: [] });
    }
    const out: PNode[] = [];
    for (const br of branches) {
      const st = settle(br.g, p, { cap: o.settleCap, oppResponds: o.oppResponds, meResponds: o.meResponds, plan }, budget, sigOf);
      if (!st.ok) continue;
      const rec = Math.max(0, runes0 - br.g.players[p].runesInPlay.length) + st.recycled;
      const planPrior = (c as Cand & { planPrior?: number }).planPrior ?? 0;
      // information first: among equivalent orders, prefer drawing / revealing early (later choices see the card)
      const drawn = Math.max(0, st.g.players[p].hand.length - n.g.players[p].hand.length + (c.a.type === 'playCard' || c.a.type === 'hide' ? 1 : 0));
      const adj = n.adj + pw * planPrior - recycleCost(n.g, c.a, rec, ctx) + (drawn ? 0.15 * Math.min(2, drawn) / (n.depth + 1) : 0);
      const steps = [...n.steps, { sig, a: c.a }, ...br.pre, ...st.mine];
      const label = (n.label === 'end' ? '' : n.label + ' > ') + describe(n.g, c.a) + (br.pre.length ? ` (${describe(g, br.pre[0].a)})` : '');
      const child: PNode = { g: st.g, steps, adj, score: 0, depth: n.depth + 1, first: n.depth === 0 ? JSON.stringify(c.a) + (br.pre.length ? JSON.stringify(br.pre[0].a) : '') : n.first, combos: n.combos, label, moves: [...n.moves, c.a] };
      child.score = st.g.winner !== null ? (st.g.winner === p ? WIN : -WIN) : evalNode(st.g) + adj;
      (child as PNode & { over?: boolean }).over = st.turnOver;
      out.push(child);
    }
    return out;
  };

  const expandCombo = (n: PNode, ci: number, ctx: PlanCtx): PNode | null => {
    const line = plan!.combos![ci];
    let g = n.g;
    const steps = [...n.steps];
    let first: string | null = null;
    let rec = 0;
    let any = false;
    for (const st of line.steps) {
      if (budget.nodes <= 0) return null;
      if (!g.pending || g.pending.inStep || g.pending.kind !== 'mainAction' || g.pending.player !== p) { if (st.optional) continue; return null; }
      const legal = getLegalActions(g, p); budget.nodes--;
      const cctx = makeCtx(g, p);
      const m = matchStep(g, p, legal, st, cctx);
      if (!m.length) { if (st.optional) continue; return null; }
      const a = m[0];
      const sig = sigOf(g);
      const runes0 = g.players[p].runesInPlay.length;
      let g2: GameState;
      try { const r = applyAction(g, a); budget.nodes--; if (r.events.some(e => e.type === 'rollback')) return null; g2 = r.state; } catch { return null; }
      const s = settle(g2, p, { cap: o.settleCap, oppResponds: o.oppResponds, meResponds: o.meResponds, plan, rules: line.choices }, budget, sigOf);
      if (!s.ok) return null;
      rec += Math.max(0, runes0 - g2.players[p].runesInPlay.length) + s.recycled;
      steps.push({ sig, a }, ...s.mine);
      first ??= JSON.stringify(a);
      g = s.g; any = true;
      if (g.winner !== null || s.turnOver) break;
    }
    if (!any) return null;
    const adj = n.adj + (line.bonus ?? 0) - (rec && plan?.resources?.recycleCost ? rec * (plan.resources.recycleCost(null, ctx) ?? 0) : 0);
    const label = (n.label === 'end' ? '' : n.label + ' > ') + `[${line.name}]`;
    const child: PNode = { g, steps, adj, score: 0, depth: n.depth + 1, first: n.depth === 0 ? first! : n.first, combos: [...n.combos, line.name], label, moves: [...n.moves, ...steps.slice(n.steps.length).filter(x => x.a.type !== 'choose' && x.a.type !== 'pass').map(x => x.a)] };
    child.score = g.winner !== null ? (g.winner === p ? WIN : -WIN) : evalNode(g) + adj;
    return child;
  };

  // keep a reserve for re-scoring draw/reveal lines in a second determinization
  const reserve = redet && o.resample ? Math.min(30, Math.floor(budget.nodes / 4)) : 0;
  const spend = { nodes: budget.nodes - reserve };
  const outer = budget;
  budget = spend;
  for (let depth = 0; depth < o.depth && frontier.length && budget.nodes > 0; depth++) {
    const children: PNode[] = [];
    for (const n of frontier) {
      if (budget.nodes <= 0) break;
      const d = n.g.pending;
      if (!d || d.inStep || d.kind !== 'mainAction' || d.player !== p || n.g.winner !== null) continue;
      const legal = getLegalActions(n.g, p); budget.nodes--;
      const ctx = plan ? makeCtx(n.g, p) : null;
      const cands = mainCandidates(n.g, p, legal, plan, ctx);
      (n as PNode & { expanded?: boolean }).expanded = true;
      if (plan?.prior && ctx) for (const c of cands) { try { (c as Cand & { planPrior?: number }).planPrior = plan.prior(c.a, actingCard(n.g, c.a), d, ctx) ?? 0; } catch { /* ignore */ } }
      const top = topMain(cands, depth === 0 ? o.k0 : o.k);
      if (DEBUG && depth === 0) console.log(`[root] ${cands.length} cands, top: ${top.map(c => describe(n.g, c.a) + '=' + c.prior.toFixed(0)).join(', ')}`);
      // combo lines first (they are the deck's intended sequences)
      if (o.combos && plan?.combos?.length && ctx) {
        plan.combos.forEach((line, ci) => {
          if (budget.nodes <= 0 || n.combos.includes(line.name)) return;
          let ok = true;
          try { ok = !line.when || line.when(ctx); } catch { ok = false; }
          if (!ok) return;
          const ch = expandCombo(n, ci, ctx);
          expanded++;
          if (!ch) return;
          const key = sigOf(ch.g);
          if ((seen.get(key) ?? -Infinity) >= ch.score) return;
          seen.set(key, ch.score);
          consider(ch); children.push(ch);
        });
      }
      for (const c of top) {
        if (budget.nodes <= 0) break;
        expanded++;
        for (const ch of expandAction(n, c, ctx)) {
          const key = sigOf(ch.g);
          if ((seen.get(key) ?? -Infinity) >= ch.score) continue;
          seen.set(key, ch.score);
          consider(ch);
          if (ch.score >= WIN) return finish(ch);
          if (!(ch as PNode & { over?: boolean }).over) children.push(ch);
        }
      }
    }
    // beam: keep the best states, first the best of each distinct opening (so different plans survive), then fill
    children.sort((a, b) => b.score - a.score);
    const next: PNode[] = [];
    const firsts = new Set<string>();
    for (const c of children) { if (next.length >= Math.ceil(o.beam / 2)) break; if (!firsts.has(c.first)) { firsts.add(c.first); next.push(c); } }
    for (const c of children) { if (next.length >= o.beam) break; if (!next.includes(c)) next.push(c); }
    if (DEBUG) console.log(`[beam d${depth}] all: ${children.map(c => c.score.toFixed(1) + " " + c.label).join(" | ")}\n   keep: ${next.map(c => c.score.toFixed(1) + ' ' + c.label).join(' || ')}`);
    frontier = next;
  }

  outer.nodes = budget.nodes + reserve;
  budget = outer;
  // lines that draw / reveal were scored with ONE sampled deck order: re-score the best few in a second sample
  if (DEBUG) console.log(`[resample?] nodes ${budget.nodes} deck ${best.g.players[p].mainDeck.length} vs ${det.players[p].mainDeck.length}`);
  if (redet && o.resample && budget.nodes > 8 && best.g.players[p].mainDeck.length !== det.players[p].mainDeck.length) {
    const tops = [...byFirst.values()].sort((a, b) => b.score - a.score).slice(0, 3);
    if (tops.length > 1) {
      let det2: GameState | null = null;
      try { det2 = redet(); } catch { det2 = null; }
      if (det2) {
        let bestR: PNode | null = null, bestS = -Infinity;
        for (const n of tops) {
          const v2 = n.moves.length ? replayMoves(det2, p, n.moves, plan, budget, o, w) : evalNode(det2);
          const s2 = v2 === null ? n.score : (n.score + v2 + n.adj) / 2;
          if (DEBUG) console.log(`[resample] ${n.score.toFixed(1)} -> ${s2.toFixed(1)} (v2 ${v2?.toFixed(1)}) ${n.label}`);
          if (s2 > bestS) { bestS = s2; bestR = n; }
        }
        if (bestR) best = bestR;
      }
    }
  }

  // light reply: re-rank the best lines (distinct first moves) by simulating the opponent's next turn
  if (o.replyTop > 0) {
    const tops = [...byFirst.values()].sort((a, b) => b.score - a.score).slice(0, o.replyTop);
    if (tops.length > 1) {
      // replies get their own budget (replyCap steps per line), charged to the caller's budget afterwards
      const rb: Budget = { nodes: tops.length * o.replyCap };
      const rb0 = rb.nodes;
      // every candidate needs a complete reply (a reply cut by the budget mid-turn is not comparable): else keep the best
      const rs: number[] = [];
      for (const n of tops) { const r = replyScore(n.g, p, w, plan, rb, o); if (r === null) break; rs.push(r); }
      budget.nodes -= rb0 - rb.nodes;
      if (rs.length === tops.length) {
        let bestR: PNode | null = null, bestS = -Infinity;
        tops.forEach((n, i) => {
          const s = (1 - o.replyWeight) * n.score + o.replyWeight * (rs[i] + n.adj);
          if (DEBUG) console.log(`[reply] ${n.score.toFixed(1)} -> ${s.toFixed(1)} (reply ${rs[i].toFixed(1)}) ${n.label}`);
          if (s > bestS) { bestS = s; bestR = n; }
        });
        if (bestR) best = bestR;
      }
    }
  }
  return finish(best);

  function finish(n: PNode): TurnPlan {
    if (budget === spend) { outer.nodes = spend.nodes + reserve; budget = outer; }
    const steps = n.steps.slice();
    // end the turn only when ending was compared with continuing (the node's own moves were searched); a line that
    // stops at the search horizon is played and then re-planned from where it ends
    const expandedHere = !!(n as PNode & { expanded?: boolean }).expanded || n.depth >= o.depth;
    if (expandedHere && n.g.winner === null && n.g.pending && !n.g.pending.inStep && n.g.pending.kind === 'mainAction' && n.g.pending.player === p) steps.push({ sig: sigOf(n.g), a: { type: 'endTurn', player: p } });
    return { steps, score: n.score, expanded, lines, best: n.label };
  }
}

/** Re-play a line's own main-phase moves in another determinization (in-step answers by the quick policy). */
function replayMoves(g0: GameState, p: PlayerId, moves: Action[], plan: DeckPlan | null, budget: Budget, o: PlannerOpts, w: EvalWeights): number | null {
  let g = g0;
  for (const a of moves) {
    if (budget.nodes <= 0) return null;
    const d = g.pending;
    if (!d || d.inStep || d.kind !== 'mainAction' || d.player !== p || g.winner !== null) break;
    try { const r = applyAction(g, a); budget.nodes--; if (r.events.some(e => e.type === 'rollback')) break; g = r.state; } catch { break; }
    const st = settle(g, p, { cap: o.settleCap, oppResponds: o.oppResponds, meResponds: o.meResponds, plan }, budget, () => '');
    g = st.g;
  }
  return g.winner !== null ? (g.winner === p ? WIN : -WIN) : evaluate(g, p, w, { plan });
}

/** End the turn and let the bot play the opponent's next turn (and our responses); evaluate at our next main phase. */
function replyScore(g0: GameState, p: PlayerId, w: EvalWeights, plan: DeckPlan | null, budget: Budget, o: PlannerOpts): number | null {
  let g = g0;
  try { g = applyAction(g, { type: 'endTurn', player: p }).state; budget.nodes--; } catch { return null; }
  let done = false;
  for (let i = 0; i < o.replyCap && budget.nodes > 0; i++) {
    const d = g.pending;
    if (g.winner !== null || !d || (!d.inStep && d.kind === 'mainAction' && d.player === p)) { done = true; break; }
    const a = fastPolicy(g, d.player);
    if (!a) return null;
    try { g = applyAction(g, a).state; budget.nodes--; } catch { return null; }
  }
  if (!done && !(g.winner !== null || (g.pending && !g.pending.inStep && g.pending.kind === 'mainAction' && g.pending.player === p))) { if (DEBUG) console.log(`[reply-cut] turn ${g.turn} pending ${g.pending?.kind}/${g.pending?.player}`); return null; }
  return g.winner !== null ? (g.winner === p ? WIN : -WIN) : evaluate(g, p, w, { plan });
}

export function describe(g: GameState, a: Action): string {
  const nm = (id: string) => g.cards[g.objects[id]?.cardId]?.name ?? id;
  switch (a.type) {
    case 'playCard': return `play ${nm(a.obj)}${a.destination !== undefined && a.destination !== 'base' ? ' @' + a.destination : ''}${a.hidden ? ' (hidden)' : ''}`;
    case 'activate': return `activate ${nm(a.obj)}#${a.abilityIndex}`;
    case 'move': return `move ${a.units.map(nm).join('+')} -> ${a.to}`;
    case 'hide': return `hide ${nm(a.obj)} @${a.battlefieldIndex}`;
    case 'choose': return `choose ${a.optionIds.map(x => g.objects[x] ? nm(x) : x).join(',') || 'none'}`;
    case 'assignDamage': return 'assign damage';
    default: return a.type;
  }
}

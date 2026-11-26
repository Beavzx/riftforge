// ENUM audit: how complete is getLegalActions, per decision kind, and how does the factored layer (src/ai/env) do?
//   tsx tools/enum-audit.ts [randomGames=200] [searchGames=6] [manualPayGames=40]
import { createGame, applyAction, getLegalActions, validateAction } from '../src/engine/index.ts';
import type { Action, Decision, GameState, ObjId, PlayerId, DeckList } from '../src/engine/types.ts';
import { canMoveUnit, canStandardMove } from '../src/engine/legal.ts';
import { binom } from '../src/engine/util.ts';
import type { AssignTarget } from '../src/engine/showdown.ts';
import type { Loc } from '../src/engine/state.ts';
import { cardDb, loadMetaDecks } from './sim-lib.ts';
import { makeRng } from '../src/engine/rng.ts';
import { SearchAI } from '../src/ai/index.ts';
import { factor, isAction, enumerateAssignments, enumeratePayments, pickCompletable, randomSubPolicy, type FNode } from '../src/ai/env/factored.ts';

const [NR, NS, NM] = [Number(process.argv[2] ?? 200), Number(process.argv[3] ?? 6), Number(process.argv[4] ?? 40)];
const decks = loadMetaDecks();

interface KindStat { decisions: number; empty: number; truncated: number; missingTotal: number; mattersDecisions: number; maxExact: number; maxListed: number }
const stats: Record<string, Record<string, KindStat>> = {};
const st = (run: string, k: string) => ((stats[run] ??= {})[k] ??= { decisions: 0, empty: 0, truncated: 0, missingTotal: 0, mattersDecisions: 0, maxExact: 0, maxListed: 0 });

function countMoveSubsets(g: GameState, p: PlayerId, to: Loc, cap = 4096): number {
  const us: ObjId[] = [];
  for (const id in g.objects) if (canMoveUnit(g, p, id, to)) us.push(id);
  let n = 0;
  const cur: ObjId[] = [];
  const rec = (i: number) => {
    if (n >= cap) return;
    for (let j = i; j < us.length; j++) { cur.push(us[j]); if (canStandardMove(g, p, cur, to)) { n++; rec(j + 1); } cur.pop(); }
  };
  rec(0);
  return n;
}

function countPicks(g: GameState, d: Decision, cap = 20000): number {
  const ids = (d.options ?? []).map(o => o.id);
  const min = d.min ?? 1, max = Math.min(d.max ?? 1, ids.length);
  let n = 0;
  const cur: string[] = [];
  const rec = (i: number) => {
    if (n >= cap) return;
    if (cur.length >= min && validateAction(g, { type: 'choose', player: d.player, optionIds: [...cur] }) === null) n++;
    if (cur.length >= max) return;
    for (let j = i; j < ids.length; j++) { cur.push(ids[j]); if (pickCompletable(g, d, cur)) rec(j + 1); cur.pop(); }
  };
  rec(0);
  return n;
}

const killSet = (ts: AssignTarget[], a: Record<ObjId, number>) => ts.filter(t => t.lethal !== null && (a[t.obj] ?? 0) >= t.lethal).map(t => t.obj).sort().join(',');

function audit(run: string, g: GameState) {
  const d = g.pending!;
  const p = d.player;
  const legal = getLegalActions(g, p).filter(a => a.type !== 'cancel');
  const kind = d.kind;
  const s = st(run, kind);
  s.decisions++;
  if (!legal.length) s.empty++;
  s.maxListed = Math.max(s.maxListed, legal.length);
  if (!d.inStep) {
    if (!legal.some(a => a.type === 'move')) return;
    const ms = st(run, 'move (standard move, per destination)');
    for (const to of ['base', ...g.battlefields.map((_, i) => i)] as Loc[]) {
      const listed = legal.filter(a => a.type === 'move' && a.to === to).length;
      if (!listed) continue;
      ms.decisions++;
      const exact = countMoveSubsets(g, p, to);
      ms.maxExact = Math.max(ms.maxExact, exact); ms.maxListed = Math.max(ms.maxListed, listed);
      if (exact > listed) { ms.truncated++; ms.missingTotal += exact - listed; ms.mattersDecisions++; }
    }
    return;
  }
  if (kind === 'assignDamage') {
    const ts = d.data!.targets as AssignTarget[];
    const rows = enumerateAssignments(ts, d.data!.total as number);
    s.maxExact = Math.max(s.maxExact, rows.length);
    const listedSets = new Set(legal.map(a => a.type === 'assignDamage' ? JSON.stringify(a.assignment) : ''));
    const missing = rows.filter(r => !listedSets.has(JSON.stringify(r))).length;
    if (missing > 0) { s.truncated++; s.missingTotal += missing; }
    const lk = new Set(legal.map(a => a.type === 'assignDamage' ? killSet(ts, a.assignment) : ''));
    if (rows.some(r => !lk.has(killSet(ts, r)))) s.mattersDecisions++;
    return;
  }
  if (kind === 'payment') {
    const plans = enumeratePayments(g, d);
    const sig = (pl: { recycle: ObjId[]; other?: Record<string, unknown> }) => JSON.stringify([pl.recycle.map(r => g.cards[g.objects[r].cardId].domains[0]).sort(), pl.other?.abilities ?? []]);
    const sugg = d.data!.suggested as { recycle: ObjId[]; other?: Record<string, unknown> };
    const distinct = new Set([sig(sugg), ...plans.map(sig)]);
    s.maxExact = Math.max(s.maxExact, distinct.size);
    if (distinct.size > 1) { s.truncated++; s.missingTotal += distinct.size - 1; s.mattersDecisions++; }
    return;
  }
  const n = (d.options ?? []).length, min = d.min ?? 1, max = Math.min(d.max ?? 1, n);
  let total = 0;
  for (let k = min; k <= max; k++) total += binom(n, k);
  if (total > 64) {
    const exact = countPicks(g, d);
    s.maxExact = Math.max(s.maxExact, exact);
    if (exact > legal.length) { s.truncated++; s.missingTotal += exact - legal.length; s.mattersDecisions++; }
  } else s.maxExact = Math.max(s.maxExact, legal.length);
}

// after: drive through the factored layer
const after = { decisions: 0, subChoices: 0, maxOptions: 0, maxSteps: 0, invalid: 0, stuck: 0, games: 0, finished: 0, byKind: {} as Record<string, { n: number; maxOpt: number; maxSteps: number }> };

function play(run: string, seed: number, a: number, b: number, mode: 'random' | 'search' | 'factored', manualPay: boolean) {
  const rng = makeRng(seed * 31 + 7);
  let g = createGame({ seed, cardDb: cardDb(), battlefieldSelection: 'random', firstPlayer: 0, enforceBanlist: false, manualPay: manualPay ? [true, true] : undefined,
    players: [{ name: 'A', deck: decks[a].deck as DeckList }, { name: 'B', deck: decks[b].deck as DeckList }] });
  const ais = mode === 'search' ? [new SearchAI({ seed: seed * 2 + 1, maxNodes: 150 }), new SearchAI({ seed: seed * 2 + 2, maxNodes: 150 })] : null;
  const pol = randomSubPolicy(rng);
  let steps = 0, mainThisTurn = 0, lastTurn = g.turn;
  if (mode === 'factored') after.games++;
  while (g.winner === null && steps < 3000 && g.turn <= 40) {
    const d = g.pending!;
    if (g.turn !== lastTurn) { lastTurn = g.turn; mainThisTurn = 0; }
    let act: Action | null = null;
    if (mode === 'factored') {
      after.decisions++;
      let n: FNode | Action | null = factor(g);
      let k = 0;
      try {
        while (n && !isAction(n)) {
          k++; after.subChoices++;
          after.maxOptions = Math.max(after.maxOptions, n.choice.options.length);
          const bk = (after.byKind[`${n.choice.decision}/${n.choice.kind}`] ??= { n: 0, maxOpt: 0, maxSteps: 0 });
          bk.n++; bk.maxOpt = Math.max(bk.maxOpt, n.choice.options.length); bk.maxSteps = Math.max(bk.maxSteps, n.choice.step + 1);
          let i = pol(n.choice);
          // keep random games moving: prefer non-pass at the top level
          if (n.choice.step === 0 && n.choice.kind === 'engine' && !d.inStep) {
            const non = n.choice.options.map((o, j) => [o, j] as const).filter(([o]) => !(o.action && (o.action.type === 'pass' || o.action.type === 'endTurn')));
            if (non.length && rng() < 0.8 && ++mainThisTurn < 60) i = non[Math.floor(rng() * non.length)][1];
          }
          n = n.pick(i);
        }
      } catch (e) { after.stuck++; console.error('stuck:', (e as Error).message); return; }
      after.maxSteps = Math.max(after.maxSteps, k);
      act = n as Action | null;
      if (act && validateAction(g, act) !== null) { after.invalid++; return; }
    } else {
      audit(run, g);
      if (ais) act = ais[d.player].choose(g, d.player);
      if (!act) {
        const legal = getLegalActions(g, d.player).filter(x => x.type !== 'cancel' && x.type !== 'concede');
        if (!legal.length) return;
        const non = legal.filter(x => x.type !== 'endTurn' && x.type !== 'pass');
        const pool = non.length && rng() < 0.8 && ++mainThisTurn < 60 ? non : legal;
        act = pool[Math.floor(rng() * pool.length)];
      }
    }
    if (!act) return;
    try { g = applyAction(g, act).state; } catch (e) { console.error(`${run} apply threw: ${(e as Error).message}`); return; }
    steps++;
  }
  if (mode === 'factored' && g.winner !== null) after.finished++;
}

const t0 = performance.now();
for (let i = 0; i < NR; i++) play('random', 5000 + i, i % decks.length, (i * 7 + 3) % decks.length, 'random', false);
for (let i = 0; i < NM; i++) play('random+manualPay', 7000 + i, i % decks.length, (i * 5 + 1) % decks.length, 'random', true);
for (let i = 0; i < NS; i++) play('searchAI', 9000 + i, i % decks.length, (i * 3 + 2) % decks.length, 'search', false);
for (let i = 0; i < NR; i++) play('factored', 5000 + i, i % decks.length, (i * 7 + 3) % decks.length, 'factored', i % 4 === 0);
console.log(JSON.stringify({ games: { random: NR, manualPay: NM, searchAI: NS, factored: NR }, sec: Math.round((performance.now() - t0) / 1000), before: stats, after }, null, 1));

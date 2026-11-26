// SELFPLAY: determinised information-set MCTS guided by the network.
//
// One search = one decision of `actor` in the real state. Each simulation:
//   1. determinises the real state from the actor's point of view (resample opponent hand/deck/facedown cards from
//      the known decklist, own deck order, RNG — src/ai/determinize.ts);
//   2. walks the shared tree, whose nodes are keyed by the sequence of non-forced choices from the root (single-
//      observer information-set MCTS: one tree aggregated over all determinisations; at each node only the options
//      legal in this determinisation compete, so it handles the hidden information without peeking);
//   3. forced moves (one option) are auto-advanced and never become tree levels;
//   4. a new node is expanded with one network evaluation (priors + value of the player to act), or the game result;
//   5. the value is backed up from each acting player's perspective (two-player zero sum: v for one is -v for the other).
//
// Root selection:
//   gumbel (default): Gumbel AlphaZero (Danihelka et al., "Policy improvement by planning with Gumbel", 2022):
//     Gumbel-top-k candidates + sequential halving over the simulation budget, choice = argmax g + logit + σ(q̂),
//     training target = softmax(logits + σ(completed Q)). Works well at 16–64 simulations.
//   puct: classic AlphaZero: Dirichlet noise at the root, target = visit distribution, temperature sampling.
// Below the root both use PUCT with the network priors.
import type { GameState, PlayerId } from '../../engine/types.ts';
import { encodeObservation, type EncodedActions, type Observation } from '../encode/index.ts';
import { RollbackError, type Choices, type SearchEnv } from './env.ts';
import type { Evaluator } from './evaluator.ts';
import { timeoutValues, type CapsConfig, type SearchConfig } from './config.ts';

export interface SearchOpts {
  sims: number;
  /** self-play exploration (Gumbel noise / Dirichlet noise + temperature). Off for eval and analysis. */
  noise: boolean;
  rng: () => number;
  /** model slot on the inference server (0 latest, 1 best) */
  slot?: number;
  /** how many decisions this actor has made so far (PUCT temperature schedule) */
  moveNumber?: number;
}

export interface SearchResult {
  choice: number;                // index into the root choices
  policy: Float32Array;          // training target over root choices
  value: number;                 // search value for the actor, [-1, 1]
  rootValue: number;             // raw network value of the root
  logits: Float32Array;          // raw network logits of the root options
  visits: Int32Array;            // per root option
  q: Float32Array;               // per root option, actor's perspective (NaN = unvisited)
  sims: number;                  // simulations that completed
  evals: number;                 // network evaluations used
  obs: Observation;              // root observation (what gets recorded as the training input)
  acts: EncodedActions;          // root option encodings
}

class Edge { N = 0; W = 0; child: Node | null = null; constructor(public prior: number) {} }
class Node {
  expanded = false;
  edges = new Map<string, Edge>();
  /** options that rolled back in some determinisation: masked out of this node */
  banned = new Set<string>();
  /** network value of this node for each player, from its expansion */
  v: number[] = [0, 0, 0, 0];
  N = 0;
  defaultPrior = 0;
  expand(keys: string[], priors: Float32Array, actor: PlayerId, value: number) {
    this.expanded = true;
    keys.forEach((k, i) => this.edges.set(k, new Edge(priors[i])));
    this.defaultPrior = 1 / Math.max(1, keys.length);
    this.v = valuesFor(actor, value);
  }
}

function valuesFor(actor: PlayerId, v: number): number[] { const out = [-v, -v, -v, -v]; out[actor] = v; return out; }

export function softmax(x: ArrayLike<number>): Float32Array {
  let m = -Infinity; for (let i = 0; i < x.length; i++) if (x[i] > m) m = x[i];
  const out = new Float32Array(x.length); let s = 0;
  for (let i = 0; i < x.length; i++) { out[i] = Math.exp(x[i] - m); s += out[i]; }
  for (let i = 0; i < x.length; i++) out[i] /= s;
  return out;
}

function gumbel(r: () => number): number { const u = Math.min(1 - 1e-12, Math.max(1e-12, r())); return -Math.log(-Math.log(u)); }
function gammaSample(alpha: number, r: () => number): number {
  if (alpha < 1) return gammaSample(alpha + 1, r) * Math.pow(Math.max(1e-12, r()), 1 / alpha);
  const d = alpha - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do { const u1 = Math.max(1e-12, r()), u2 = r(); x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); v = 1 + c * x; } while (v <= 0);
    v = v * v * v; const u = r();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
function dirichlet(n: number, alpha: number, r: () => number): Float32Array {
  const out = new Float32Array(n); let s = 0;
  for (let i = 0; i < n; i++) { out[i] = gammaSample(alpha, r); s += out[i]; }
  for (let i = 0; i < n; i++) out[i] /= s || 1;
  return out;
}

export class Mcts<S> {
  evals = 0;
  constructor(private env: SearchEnv<S>, private ev: Evaluator, private cfg: SearchConfig, private caps: CapsConfig) {}

  /** Game result for each player if the state is terminal (win/loss, or a cap draw), else null. */
  terminal(g: GameState): number[] | null {
    if (g.winner !== null) { const out = [-1, -1, -1, -1]; out[g.winner] = 1; return out; }
    if (g.turn > this.caps.maxTurns || g.actionCount >= this.caps.maxActions) return timeoutValues(g.players.map(p => p.points), g.victoryScore, this.caps.timeoutShaping);
    return null;
  }

  private async evaluate(s: S, actor: PlayerId, ch: Choices, slot: number) {
    const obs = encodeObservation(this.env.game(s), actor);
    const acts = ch.encode(obs);
    this.evals++;
    const r = await this.ev.evaluate({ obs, acts }, slot);
    return { value: Math.max(-1, Math.min(1, r.value)), logits: r.logits, obs, acts };
  }

  /** Advance forced moves. Returns the state, its actor and choices, or terminal values. */
  private settle(s: S): { s: S; actor?: PlayerId; ch?: Choices; values?: number[] } {
    for (let k = 0; ; k++) {
      const t = this.terminal(this.env.game(s));
      if (t) return { s, values: t };
      const actor = this.env.actor(s);
      if (actor === null) return { s, values: [0, 0, 0, 0] };
      const ch = this.env.choices(s, actor);
      if (ch.n === 0) return { s, values: [0, 0, 0, 0] };
      if (ch.n > 1 || k >= this.cfg.forcedStepCap) return { s, actor, ch };
      s = this.env.step(s, 0, ch);   // a rollback here propagates: the simulation is dropped
    }
  }

  private selectKey(node: Node, keys: string[], actor: PlayerId): string {
    let sumN = 0;
    for (const k of keys) sumN += node.edges.get(k)?.N ?? 0;
    const sq = Math.sqrt(Math.max(1, sumN));
    const fpu = node.v[actor] - 0.2;
    let best = keys[0], bestScore = -Infinity;
    for (const k of keys) {
      if (node.banned.has(k)) continue;
      const e = node.edges.get(k);
      const n = e?.N ?? 0, p = e?.prior ?? node.defaultPrior;
      const q = n ? e!.W / n : fpu;
      const sc = q + this.cfg.cPuct * p * sq / (1 + n);
      if (sc > bestScore) { bestScore = sc; best = k; }
    }
    return best;
  }

  /** One simulation from the real root state. `rootKey` forces the first move (Gumbel). Returns false if wasted. */
  private async simulate(root: Node, real: S, rootActor: PlayerId, rootKey: string | null, r: () => number, slot: number): Promise<boolean> {
    let s: S;
    try { s = this.env.determinize(real, rootActor, r); } catch { return false; }
    let node = root;
    const path: { node: Node; edge: Edge; actor: PlayerId }[] = [];
    let values: number[] | null = null;
    try {
      for (let depth = 0; ; depth++) {
        const st = this.settle(s);
        s = st.s;
        if (st.values) { values = st.values; break; }
        const actor = st.actor!, ch = st.ch!;
        if (!node.expanded) {
          const e = await this.evaluate(s, actor, ch, slot);
          node.expand(ch.keys, softmax(e.logits), actor, e.value);
          values = node.v;
          break;
        }
        let key: string;
        if (depth === 0 && rootKey !== null) { if (!ch.keys.includes(rootKey)) return false; key = rootKey; }
        else key = this.selectKey(node, ch.keys, actor);
        let edge = node.edges.get(key);
        if (!edge) { edge = new Edge(node.defaultPrior); node.edges.set(key, edge); }
        const edgeRef = edge;
        if (node.banned.has(key)) return false;
        try { s = this.env.step(s, ch.keys.indexOf(key), ch); }
        catch (e) { if (e instanceof RollbackError) { node.banned.add(key); node.edges.delete(key); return false; } throw e; }
        path.push({ node, edge, actor });
        node = edgeRef.child ??= new Node();
      }
    } catch {
      return false;   // an engine error inside a determinisation: drop this simulation
    }
    for (const { node: n, edge, actor } of path) { edge.N++; edge.W += values![actor]; n.N++; }
    return true;
  }

  /** Search one decision. `ch` must be the actor's choices in `real` (n >= 2). */
  async search(real: S, actor: PlayerId, ch: Choices, o: SearchOpts): Promise<SearchResult> {
    const slot = o.slot ?? 0;
    const evals0 = this.evals;
    const rootEval = await this.evaluate(real, actor, ch, slot);
    const n = ch.n, logits = rootEval.logits;
    const root = new Node();
    const priors = softmax(logits);
    root.expand(ch.keys, priors, actor, rootEval.value);
    let sims = 0;
    const qOf = (i: number) => { const e = root.edges.get(ch.keys[i]); return e && e.N ? e.W / e.N : NaN; };
    const visitsOf = (i: number) => root.edges.get(ch.keys[i])?.N ?? 0;
    const okRoot = (i: number) => !root.banned.has(ch.keys[i]);
    let choice = 0;
    let policy: Float32Array;
    let value: number;

    if (this.cfg.algorithm === 'gumbel') {
      const g = new Float32Array(n);
      if (o.noise) for (let i = 0; i < n; i++) g[i] = gumbel(o.rng);
      const m = Math.max(1, Math.min(n, this.cfg.maxConsidered, Math.max(2, o.sims)));
      let cand = [...Array(n).keys()].sort((a, b) => (g[b] + logits[b]) - (g[a] + logits[a])).slice(0, m);
      const sigma = (q01: number) => {
        let maxN = 0; for (let i = 0; i < n; i++) maxN = Math.max(maxN, visitsOf(i));
        return (this.cfg.cVisit + maxN) * this.cfg.cScale * q01;
      };
      const score = (i: number) => { const q = qOf(i); return g[i] + logits[i] + (Number.isNaN(q) ? 0 : sigma((q + 1) / 2)); };
      const phases = Math.max(1, Math.ceil(Math.log2(m)));
      let budget = o.sims;
      for (let ph = 0; ph < phases && budget > 0 && cand.length > 0; ph++) {
        const per = Math.max(1, Math.floor(o.sims / (phases * cand.length)));
        for (const i of cand) for (let k = 0; k < per && budget > 0; k++, budget--) {
          if (await this.simulate(root, real, actor, ch.keys[i], o.rng, slot)) sims++;
        }
        if (cand.length > 1) cand = cand.sort((a, b) => score(b) - score(a)).slice(0, Math.ceil(cand.length / 2));
      }
      const alive = cand.filter(okRoot);
      choice = (alive.length ? alive : cand).sort((a, b) => score(b) - score(a))[0];
      // completed Q (unvisited options get v_mix) → improved policy target
      let sumN = 0, pv = 0, pq = 0;
      for (let i = 0; i < n; i++) { const N = visitsOf(i); sumN += N; if (N > 0) { pv += priors[i]; pq += priors[i] * qOf(i); } }
      const vmix = sumN > 0 && pv > 0 ? (rootEval.value + (sumN / pv) * pq) / (1 + sumN) : rootEval.value;
      const completed = new Float32Array(n);
      for (let i = 0; i < n; i++) { const q = qOf(i); completed[i] = logits[i] + sigma(((Number.isNaN(q) ? vmix : q) + 1) / 2); }
      policy = softmax(completed);
      value = vmix;
    } else {
      if (o.noise) {
        const d = dirichlet(n, this.cfg.dirichletAlpha, o.rng), f = this.cfg.dirichletFrac;
        ch.keys.forEach((k, i) => { const e = root.edges.get(k); if (e) e.prior = (1 - f) * priors[i] + f * d[i]; });
      }
      for (let k = 0; k < o.sims; k++) if (await this.simulate(root, real, actor, null, o.rng, slot)) sims++;
      const visits = new Float32Array(n); let tot = 0;
      for (let i = 0; i < n; i++) { visits[i] = visitsOf(i); tot += visits[i]; }
      policy = tot > 0 ? visits.map(v => v / tot) : priors.slice();
      if (o.noise && (o.moveNumber ?? 0) < this.cfg.temperatureMoves) {
        let x = o.rng(); choice = n - 1;
        for (let i = 0; i < n; i++) { x -= policy[i]; if (x <= 0) { choice = i; break; } }
        if (!okRoot(choice)) choice = Math.max(0, [...Array(n).keys()].find(okRoot) ?? 0);
      } else {
        choice = Math.max(0, [...Array(n).keys()].find(okRoot) ?? 0);
        for (let i = 0; i < n; i++) {
          if (!okRoot(i) || i === choice) continue;
          if (policy[i] > policy[choice] || (policy[i] === policy[choice] && priors[i] > priors[choice])) choice = i;
        }
      }
      let W = 0, N = 0; for (const e of root.edges.values()) { W += e.W; N += e.N; }
      value = (rootEval.value + W) / (1 + N);
    }
    const visits = new Int32Array(n), q = new Float32Array(n);
    for (let i = 0; i < n; i++) { visits[i] = visitsOf(i); q[i] = qOf(i); }
    // banned (rolled-back) root options get no training mass
    let mass = 0; for (let i = 0; i < n; i++) { if (!okRoot(i)) policy[i] = 0; mass += policy[i]; }
    if (mass > 0) for (let i = 0; i < n; i++) policy[i] /= mass;
    return { choice, policy, value, rootValue: rootEval.value, logits: Float32Array.from(logits), visits, q, sims, evals: this.evals - evals0, obs: rootEval.obs, acts: rootEval.acts };
  }
}

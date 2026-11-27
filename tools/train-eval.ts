// TRAIN: evaluation matches for a run. Started by the launcher every eval.everyCheckpoints checkpoints:
//   node --import tsx tools/train-eval.ts --run runs/<name> --step 12000 [--port 47000] [--games 20] [--opponents best,searchai,bot]
// The network side plays the checkpoint the launcher pinned for this eval (server slot 2 = ckpt/eval.pt, so the trainer
// publishing newer latest.pt files during the eval changes nothing) with the eval search (no noise). A server without
// slot 2 (older protocol) falls back to slot 0.
// Opponents: best = the same search with the best checkpoint (slot 1); searchai = the hand-built SearchAI (src/ai);
// bot = the engine's rules bot. Games are played in pairs (src/ai/selfplay/decks.ts pairedDeals): both games of a pair
// use the same decks, seed and first player with the seats swapped, and every opponent gets the same deals. Timeouts
// are counted (they also score as draws) and results are broken down by matchup (net's deck vs opponent's deck).
// Writes runs/<name>/eval/step-<step>.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GameState } from '../src/engine/types.ts';
import { chooseAction } from '../src/engine/index.ts';
import { SearchAI, type SearchOptions } from '../src/ai/index.ts';
import { makeRng } from '../src/engine/rng.ts';
import { loadResolved, maxTurnsAt } from '../src/ai/selfplay/config.ts';
import { makeEnv, type SearchEnv } from '../src/ai/selfplay/env.ts';
import { evalSlot, InferenceClient, SLOT_BEST } from '../src/ai/selfplay/client.ts';
import { UniformEvaluator, type Evaluator } from '../src/ai/selfplay/evaluator.ts';
import { DeckPicker, pairedDeals } from '../src/ai/selfplay/decks.ts';
import { EngineBotAgent, playGame, SearchAgent, type Agent } from '../src/ai/selfplay/game.ts';

function arg(n: string, d?: string) { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; }

export interface MatchResult {
  opponent: string; games: number; wins: number; losses: number; draws: number; errors: number; score: number; avgTurns: number; sec: number;
  /** games that hit the turn/action cap (counted in draws too) */
  timeouts: number;
  /** "<net's deck> vs <opponent's deck>" → [wins, losses, draws] from the net's side */
  byMatchup: Record<string, [number, number, number]>;
}

async function main() {
  const runDir = arg('run'); if (!runDir) throw new Error('--run required');
  const cfg = loadResolved(runDir);
  const step = Number(arg('step', '0'));
  const games = Number(arg('games', String(cfg.eval.gamesPerOpponent)));
  const opponents = (arg('opponents') ?? cfg.eval.opponents.join(',')).split(',').filter(Boolean);
  const conc = Number(arg('concurrent', String((cfg.eval as { concurrentGames?: number }).concurrentGames ?? 4)));
  // Lanes in one process share one CPU core (the engine and SearchAI are synchronous). By default the games are split
  // over `procs` child processes (one per concurrent game), each playing its share of the deals; this parent merges.
  const shard = arg('shard') === undefined ? null : Number(arg('shard'));
  const shards = Number(arg('shards', '1'));
  const procs = Math.max(1, Math.min(Number(arg('procs', String(conc))), Math.ceil(games / 2)));
  if (shard === null && procs > 1) return runSharded(runDir, cfg, step, games, opponents, conc, procs);
  const ev: Evaluator = arg('backend') === 'inproc' ? new UniformEvaluator() : await InferenceClient.connect({ host: cfg.servers.host, port: Number(arg('port', String(cfg.servers.ports[0]))), clientId: 9999 });
  const picker = new DeckPicker(cfg.decks);
  const rng = makeRng(cfg.seed * 31 + step);
  const results: MatchResult[] = [];
  const mineSlot = evalSlot(ev);
  const caps = { ...cfg.caps, maxTurns: maxTurnsAt(cfg.caps, step) };
  // drawn before any agent uses rng, so the deals are the same for every opponent and reproducible per step
  const deals = pairedDeals(picker, rng, games, 1_000_000 + step * 1000);

  for (const opp of opponents) {
    const t0 = performance.now();
    const r: MatchResult = { opponent: opp, games: 0, wins: 0, losses: 0, draws: 0, errors: 0, score: 0, avgTurns: 0, sec: 0, timeouts: 0, byMatchup: {} };
    let next = 0, turns = 0;
    // a shard plays whole pairs (k, k^1): both seat orders of a deal stay together
    const todo = [...Array(games).keys()].filter(k => shard === null || Math.floor(k / 2) % shards === shard);
    const lane = async () => {
      while (next < todo.length) {
        const k = todo[next++];
        const deal = deals[k];
        const nnSeat = (k % 2) as 0 | 1;   // the pair partner (k ^ 1) has the net in the other seat
        // engine bots answer with whole engine actions, which every env accepts, so all matches use the training env
        const env: SearchEnv<any> = await makeEnv(cfg.env.kind);
        const mine = new SearchAgent('latest', env, ev, cfg.evalSearch, caps, { record: false, noise: false, slot: mineSlot, rng });
        let theirs: Agent<any>;
        if (opp === 'best') theirs = new SearchAgent('best', env, ev, cfg.evalSearch, caps, { record: false, noise: false, slot: SLOT_BEST, rng });
        else if (opp === 'searchai') {
          const ai = new SearchAI({ seed: k + 1, ...(cfg.eval.searchAiOptions as SearchOptions) });
          theirs = new EngineBotAgent('searchai', (g: GameState, p) => ai.choose(g, p));
        } else if (opp === 'bot') theirs = new EngineBotAgent('bot', (g: GameState, p) => chooseAction(g, p));
        else throw new Error(`unknown eval opponent ${opp}`);
        const agents: [Agent<any>, Agent<any>] = nnSeat === 0 ? [mine, theirs] : [theirs, mine];
        const g = await playGame({ env, agents, decks: deal.decks, seed: deal.seed, firstPlayer: deal.firstPlayer, caps });
        r.games++; turns += g.turns;
        if (g.status === 'error') { r.errors++; continue; }
        if (g.status === 'timeout') r.timeouts++;
        const key = `${deal.decks[nnSeat].name} vs ${deal.decks[1 - nnSeat].name}`;
        const m = (r.byMatchup[key] ??= [0, 0, 0]);
        if (g.winner === null) { r.draws++; m[2]++; } else if (g.winner === nnSeat) { r.wins++; m[0]++; } else { r.losses++; m[1]++; }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, conc) }, lane));
    const played = r.wins + r.losses + r.draws;
    r.score = played ? (r.wins + 0.5 * r.draws) / played : 0;
    r.avgTurns = r.games ? turns / r.games : 0;
    r.sec = (performance.now() - t0) / 1000;
    results.push(shard === null ? r : { ...r, turnsSum: turns } as MatchResult);
    console.log(`[eval${shard === null ? '' : ` shard ${shard}/${shards}`}] step ${step} vs ${opp}: ${r.wins}-${r.losses}-${r.draws} (timeouts ${r.timeouts}, errors ${r.errors}) score ${r.score.toFixed(3)} in ${r.sec.toFixed(0)}s`);
  }
  const out = arg('out') ?? join(runDir, 'eval', `step-${step}.json`);
  mkdirSync(join(runDir, 'eval'), { recursive: true });
  writeFileSync(out, JSON.stringify({ step, time: Date.now(), results }, null, 1));
  await ev.close?.();
  process.exit(0);
}

/** Parent of a sharded eval: start `procs` children (same deals, disjoint pairs), spread over the inference servers,
 *  then merge their results into the same step-<step>.json a single-process eval writes. */
async function runSharded(runDir: string, cfg: ReturnType<typeof loadResolved>, step: number, games: number, opponents: string[], conc: number, procs: number) {
  const { spawn } = await import('node:child_process');
  const { readFileSync, rmSync } = await import('node:fs');
  const lanes = Math.max(1, Math.ceil(conc / procs));
  const tmp = join(runDir, 'eval', `.step-${step}.shards`);
  mkdirSync(tmp, { recursive: true });
  const ports = cfg.servers.ports;
  const t0 = performance.now();
  const codes = await Promise.all(Array.from({ length: procs }, (_, i) => new Promise<number>(resolve => {
    const a = ['--run', runDir, '--step', String(step), '--games', String(games), '--opponents', opponents.join(','),
      '--concurrent', String(lanes), '--shard', String(i), '--shards', String(procs), '--port', String(ports[i % ports.length]),
      '--out', join(tmp, `${i}.json`), ...(arg('backend') ? ['--backend', arg('backend')!] : [])];
    const c = spawn(process.execPath, [...process.execArgv, process.argv[1], ...a], { stdio: 'inherit' });
    c.on('exit', code => resolve(code ?? 1));
    c.on('error', () => resolve(1));
  })));
  if (codes.some(c => c !== 0)) { console.error(`[eval] fatal: shard exit codes ${codes.join(',')}`); process.exit(2); }
  const parts = codes.map((_, i) => JSON.parse(readFileSync(join(tmp, `${i}.json`), 'utf8')) as { results: (MatchResult & { turnsSum: number })[] });
  const results: MatchResult[] = opponents.map(opp => {
    const rs = parts.map(p => p.results.find(x => x.opponent === opp)!);
    const r: MatchResult = { opponent: opp, games: 0, wins: 0, losses: 0, draws: 0, errors: 0, score: 0, avgTurns: 0, sec: 0, timeouts: 0, byMatchup: {} };
    let turns = 0;
    for (const x of rs) {
      r.games += x.games; r.wins += x.wins; r.losses += x.losses; r.draws += x.draws; r.errors += x.errors; r.timeouts += x.timeouts;
      turns += x.turnsSum; r.sec = Math.max(r.sec, x.sec);
      for (const [k, v] of Object.entries(x.byMatchup)) { const m = (r.byMatchup[k] ??= [0, 0, 0]); m[0] += v[0]; m[1] += v[1]; m[2] += v[2]; }
    }
    const played = r.wins + r.losses + r.draws;
    r.score = played ? (r.wins + 0.5 * r.draws) / played : 0;
    r.avgTurns = r.games ? turns / r.games : 0;
    console.log(`[eval] step ${step} vs ${opp}: ${r.wins}-${r.losses}-${r.draws} (timeouts ${r.timeouts}, errors ${r.errors}) score ${r.score.toFixed(3)} (${procs} processes)`);
    return r;
  });
  const out = arg('out') ?? join(runDir, 'eval', `step-${step}.json`);
  writeFileSync(out, JSON.stringify({ step, time: Date.now(), results }, null, 1));
  rmSync(tmp, { recursive: true, force: true });
  console.log(`[eval] step ${step}: ${procs} processes, ${((performance.now() - t0) / 1000).toFixed(0)}s`);
  process.exit(0);
}

main().catch(e => { console.error(`[eval] fatal: ${(e as Error).stack ?? e}`); process.exit(2); });

// SELFPLAY: one self-play worker process. Started by python/riftzero/run.py:
//   node --import tsx src/ai/selfplay/worker.ts --run runs/<name> --id 7 --port 47000 [--host 127.0.0.1] [--games N]
// Plays `workers.concurrentGames` games at once (so the inference server sees a steady stream of requests while
// this process computes), records positions, writes shards to runs/<name>/shards/, stats to runs/<name>/workers/.
// SIGTERM/SIGINT or a runs/<name>/STOP file: abandons in-progress games, publishes the open shard, exits 0.
import { mkdirSync, renameSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeRng, seedToState } from '../../engine/rng.ts';
import { loadResolved, maxTurnsAt } from './config.ts';
import { readFileSync } from 'node:fs';

/** The trainer's current step (runs/<name>/ckpt/step.txt, written by train.py) for cap annealing; 0 if unknown. */
let stepCache = { t: 0, step: 0 };
function trainerStep(runDir: string): number {
  if (Date.now() - stepCache.t < 30000) return stepCache.step;
  let step = 0; try { step = Number(readFileSync(join(runDir, 'ckpt', 'step.txt'), 'utf8').trim()) || 0; } catch { /* no trainer yet */ }
  stepCache = { t: Date.now(), step }; return step;
}
import { makeEnv } from './env.ts';
import { InferenceClient } from './client.ts';
import { UniformEvaluator, type Evaluator } from './evaluator.ts';
import { DeckPicker } from './decks.ts';
import { Aborted, assignOutcome, playGame, SearchAgent } from './game.ts';
import { ShardWriter } from './shards.ts';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

async function main() {
  const runDir = arg('run');
  if (!runDir) throw new Error('--run <dir> required');
  const id = Number(arg('id', '0'));
  const cfg = loadResolved(runDir);
  const maxGames = arg('games') ? Number(arg('games')) : Infinity;
  const port = Number(arg('port', String(cfg.servers.ports[id % cfg.servers.ports.length])));
  const host = arg('host', cfg.servers.host)!;
  const env = await makeEnv(cfg.env.kind);
  const ev: Evaluator = arg('backend') === 'inproc' ? new UniformEvaluator() : await InferenceClient.connect({ host, port, clientId: id });
  const picker = new DeckPicker(cfg.decks);
  const shards = new ShardWriter(join(runDir, 'shards'), id, cfg.workers.gamesPerShard);
  const statsDir = join(runDir, 'workers'); mkdirSync(statsDir, { recursive: true });
  const errDir = join(runDir, 'errors'); mkdirSync(errDir, { recursive: true });
  const rng = makeRng(seedToState(cfg.seed * 1000003 + id * 7919 + Date.now() % 100000));

  let stopping = false;
  const stop = () => { stopping = true; };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  // cross-platform graceful stop (Windows has no SIGTERM for child processes): the launcher creates runs/<name>/STOP
  const stopPoll = setInterval(() => { if (existsSync(join(runDir, 'STOP'))) stop(); }, 1000);

  const st = { id, pid: process.pid, started: Date.now(), games: 0, ok: 0, timeouts: 0, errors: 0, positions: 0, decisions: 0,
    sims: 0, evals: 0, turns: 0, rollbacks: 0, maxTurns: 0, seat0Wins: 0, seat1Wins: 0, draws: 0, lastGameMs: 0, updated: 0 };
  const writeStats = () => {
    st.updated = Date.now(); st.evals = ev.count; st.positions = shards.positions;
    const p = join(statsDir, `w${String(id).padStart(3, '0')}.json`);
    writeFileSync(p + '.tmp', JSON.stringify(st)); renameSync(p + '.tmp', p);
  };
  const timer = setInterval(writeStats, cfg.workers.statsEverySec * 1000);

  let started = 0;
  const loop = async (lane: number) => {
    while (!stopping && started < maxGames) {
      started++;
      const decks = picker.pick(rng);
      const seed = Math.floor(rng() * 2 ** 31);
      const caps = { ...cfg.caps, maxTurns: maxTurnsAt(cfg.caps, trainerStep(runDir)) };
      const agent = new SearchAgent('nn', env, ev, cfg.search, caps, { record: true, noise: true, rng });
      try {
        const r = await playGame({ env, agents: [agent, agent], decks, seed, firstPlayer: rng() < 0.5 ? 0 : 1, caps, shouldStop: () => stopping });
        st.rollbacks += r.rollbacks ?? 0; st.maxTurns = caps.maxTurns;
        st.games++; st.decisions += r.decisions; st.sims += agent.sims; st.turns += r.turns; st.lastGameMs = r.ms;
        if (r.status === 'error') {
          st.errors++;
          appendFileSync(join(errDir, `w${id}.jsonl`), JSON.stringify({ t: Date.now(), lane, ...r }) + '\n');
          continue;   // positions from a broken game are not trusted
        }
        if (r.status === 'timeout') st.timeouts++; else st.ok++;
        if (r.winner === 0) st.seat0Wins++; else if (r.winner === 1) st.seat1Wins++; else st.draws++;
        shards.addGame(assignOutcome(agent.positions, r, cfg.target.pointsShaping, caps.timeoutShaping));
      } catch (e) {
        if (e instanceof Aborted) return;
        st.errors++;
        appendFileSync(join(errDir, `w${id}.jsonl`), JSON.stringify({ t: Date.now(), lane, error: (e as Error).stack ?? String(e) }) + '\n');
        if (/inference (server|client)|connection closed|ECONNREFUSED|ECONNRESET/.test(String(e))) { stopping = true; process.exitCode = 3; }
      }
    }
  };
  await Promise.all(Array.from({ length: cfg.workers.concurrentGames }, (_, k) => loop(k)));
  clearInterval(timer); clearInterval(stopPoll);
  shards.flush();
  writeStats();
  await ev.close?.();
  process.exit(process.exitCode ?? 0);
}

main().catch(e => { console.error(`[worker] fatal: ${(e as Error).stack ?? e}`); process.exit(2); });

// TRAIN: evaluation matches for a run. Started by the launcher every eval.everyCheckpoints checkpoints:
//   node --import tsx tools/train-eval.ts --run runs/<name> --step 12000 [--port 47000] [--games 20] [--opponents best,searchai,bot]
// The network side plays the checkpoint the launcher pinned for this eval (server slot 2 = ckpt/eval.pt, so the trainer
// publishing newer latest.pt files during the eval changes nothing) with the eval search (no noise). A server without
// slot 2 (older protocol) falls back to slot 0.
// Opponents: best = the same search with the best checkpoint (slot 1); searchai = the hand-built SearchAI (src/ai);
// bot = the engine's rules bot. Seats and first player alternate. Writes runs/<name>/eval/step-<step>.json.
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
import { DeckPicker } from '../src/ai/selfplay/decks.ts';
import { EngineBotAgent, playGame, SearchAgent, type Agent } from '../src/ai/selfplay/game.ts';

function arg(n: string, d?: string) { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; }

export interface MatchResult { opponent: string; games: number; wins: number; losses: number; draws: number; errors: number; score: number; avgTurns: number; sec: number }

async function main() {
  const runDir = arg('run'); if (!runDir) throw new Error('--run required');
  const cfg = loadResolved(runDir);
  const step = Number(arg('step', '0'));
  const games = Number(arg('games', String(cfg.eval.gamesPerOpponent)));
  const opponents = (arg('opponents') ?? cfg.eval.opponents.join(',')).split(',').filter(Boolean);
  const conc = Number(arg('concurrent', String((cfg.eval as { concurrentGames?: number }).concurrentGames ?? 4)));
  const ev: Evaluator = arg('backend') === 'inproc' ? new UniformEvaluator() : await InferenceClient.connect({ host: cfg.servers.host, port: Number(arg('port', String(cfg.servers.ports[0]))), clientId: 9999 });
  const picker = new DeckPicker(cfg.decks);
  const rng = makeRng(cfg.seed * 31 + step);
  const results: MatchResult[] = [];
  const mineSlot = evalSlot(ev);
  const caps = { ...cfg.caps, maxTurns: maxTurnsAt(cfg.caps, step) };

  for (const opp of opponents) {
    const t0 = performance.now();
    const r: MatchResult = { opponent: opp, games: 0, wins: 0, losses: 0, draws: 0, errors: 0, score: 0, avgTurns: 0, sec: 0 };
    let next = 0, turns = 0;
    const lane = async () => {
      while (next < games) {
        const k = next++;
        const nnSeat = (k % 2) as 0 | 1;
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
        const decks = picker.pick(rng);
        const g = await playGame({ env, agents, decks, seed: 1_000_000 + step * 1000 + k, firstPlayer: ((k >> 1) % 2) as 0 | 1, caps });
        r.games++; turns += g.turns;
        if (g.status === 'error') { r.errors++; continue; }
        if (g.winner === null) r.draws++; else if (g.winner === nnSeat) r.wins++; else r.losses++;
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, conc) }, lane));
    const played = r.wins + r.losses + r.draws;
    r.score = played ? (r.wins + 0.5 * r.draws) / played : 0;
    r.avgTurns = r.games ? turns / r.games : 0;
    r.sec = (performance.now() - t0) / 1000;
    results.push(r);
    console.log(`[eval] step ${step} vs ${opp}: ${r.wins}-${r.losses}-${r.draws} (errors ${r.errors}) score ${r.score.toFixed(3)} in ${r.sec.toFixed(0)}s`);
  }
  const out = arg('out') ?? join(runDir, 'eval', `step-${step}.json`);
  mkdirSync(join(runDir, 'eval'), { recursive: true });
  writeFileSync(out, JSON.stringify({ step, time: Date.now(), results }, null, 1));
  await ev.close?.();
  process.exit(0);
}

main().catch(e => { console.error(`[eval] fatal: ${(e as Error).stack ?? e}`); process.exit(2); });

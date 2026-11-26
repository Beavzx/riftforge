// META-SIM worker: receives GameRun jobs, plays them (tools/sim-lib.ts playGame) and posts results back.
import { parentPort } from 'node:worker_threads';
import { playGame, type GameRun } from './sim-lib.ts';

parentPort!.on('message', (m: { id: number; run: GameRun } | 'stop') => {
  if (m === 'stop') { process.exit(0); }
  let out;
  try { out = playGame(m.run); }
  catch (e) { out = { winner: null, status: 'void', turns: 0, actions: 0, ms: 0, points: [0, 0], firstPlayer: 0, error: { kind: 'runner-throw', message: String((e as Error).stack ?? e).slice(0, 400), step: 0, turn: 0 } }; }
  parentPort!.postMessage({ id: m.id, out });
});

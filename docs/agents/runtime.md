# RUNTIME agent notes (task #5): self-play training framework

User workflow: `TRAINING.md`. This file covers the design, what was tested, and the merge points.

## Layout

```
src/ai/selfplay/
  config.ts        ResolvedConfig (runs/<name>/resolved.json, written by the Python launcher), caps helpers (maxTurnsAt, timeoutValues)
  env.ts           SearchEnv<S> interface, EngineEnv (raw legal list), RollbackError, sliceEncoded, makeEnv(kind)
  factored-env.ts  FactoredEnv over src/ai/env/factored.ts (DEFAULT): each sub-choice = one tree level, encodeSubChoices
  evaluator.ts     Evaluator interface + UniformEvaluator (in-process mock)
  client.ts        InferenceClient: TCP, HELLO/ACK schema handshake, pipelined RFO1 → RFR1, tag = slot<<24 | id
  mcts.ts          determinised IS-MCTS; Gumbel root (sequential halving, improved-policy target) or PUCT; PUCT below root
  game.ts          playGame loop (caps, forced moves, rollback masking), SearchAgent, EngineBotAgent, assignOutcome
  shards.ts        .rfs shard writer (atomic publish via rename)
  decks.ts         deck files + pool/matchup picking with random seats
  worker.ts        self-play worker process (N concurrent games, stats, STOP-file/SIGTERM graceful stop)
  nn-evaluator.ts  NNCoach: trained net as evaluator/analyser for the coach (INTEGRATION POINT)
tools/train-schema.ts   schema.json + card_static.f32 + card_index.json into a run dir
tools/train-eval.ts     eval matches (latest vs best / SearchAI / rules bot) → runs/<name>/eval/step-N.json
python/riftzero/   launch (orchestrator), infer_server (+mock_backend, torch_backend), train, model, dataset, wire,
                   schema, config, checkpoints, elo, status, stop, smoke, export
config/train.yaml (home PC), train-epyc.yaml, smoke.yaml;  scripts/*.sh + *.ps1 thin wrappers; TRAINING.md
tests/ai/selfplay/*.test.ts, python/tests/test_riftzero.py
```

## Design points

- **Value convention**: the network value is for the player whose observation it is (the actor), in [-1, 1]. The
  search backs up per-player values (zero-sum: v / -v). Training z is from the recorded actor's perspective.
- **Search**: one tree per decision, keyed by the sequence of non-forced option keys from the root. Each simulation
  re-determinises from the root actor's view (src/ai/determinize.ts) and only options legal in that determinisation
  compete. Forced moves (one option) are auto-advanced and never become tree levels. Simulations run one after
  another inside a game; concurrency comes from `workers.concurrentGames` games per process, and the server batches
  across all clients.
- **Playout-cap randomisation**: `fullProb` of decisions get `fullSims` and are recorded; the rest get `fastSims`
  and are played only.
- **Rollbacks** (lead / fuzz finding): `env.step` throws `RollbackError` when `applyAction` returns
  `events[0].type === 'rollback'`. MCTS bans that key at the node (no further visits, deleted edge; at the root never
  chosen and 0 policy mass). The game loop masks the option (`env.restrict`), asks the agent again and drops the
  recorded position (`agent.rolledBack()`).
- **Caps** (fuzz recommendation): maxTurns 60 → annealed to 40 over trainer steps (workers read `ckpt/step.txt`),
  maxActions 1500, maxMainPerTurn 40 (forces endTurn). A timeout's value is `timeoutShaping` (0.2) × the clipped
  point difference, in both the search and the training target. A win is 1.
- **Factored env** is the default (`env.kind: factored`). The state carries the partial sub-choice plus the picked
  option ids, so `determinize()` replays the same partial decision on the resampled state (it fails, dropping the
  simulation, if an id vanished). Engine bots (eval) answer with whole engine actions (`env.applyAction`), so every
  eval match uses the training env.
- **Hot reload**: the inference server watches `ckpt/latest.pt`, `ckpt/best.pt` and `ckpt/eval.pt` (slots 0 / 1 / 2);
  workers never restart for new weights. Evals play slot 2, a pinned copy of the evaluated step (the launcher waits
  until every server reports it loaded via `slotSteps` in its stats file).
- **Failure handling** (review fixes, docs/agents/review-torch.md): CUDA OOM → split-and-retry. Other batch failures →
  RFE1 error frames (only those requests fail, as `InferenceError`). 50 failed batches in a row → server exits →
  the launcher restarts it (`inference.maxServerRestarts`). Workers whose connection closed exit 3 and are restarted.
  No CPU fallback unless `allowCpu`. Non-finite steps are skipped; 10 in a row stop the trainer without publishing.
  If the prefetch thread dies, the trainer raises (no hang).
- **Graceful stop** works on every OS: `runs/<name>/STOP` is polled by the workers (1 s), the trainer and the
  launcher. Children run in their own process group (new session / CREATE_NEW_PROCESS_GROUP), so Ctrl-C reaches
  only the launcher, which stops them in order: workers, eval, trainer (final checkpoint), servers.
- **Transport**: TCP on 127.0.0.1 (Linux, WSL2, Windows). There's no unix-socket path in the launcher yet
  (`InferenceClient` supports `path`; `infer_server` would need `asyncio.start_unix_server`). Not needed for the
  measured loads.

## Tested here (no torch, no GPU, 2 shared vCPUs)

- `npx tsc -p .`: clean for all new TS.
- `tsx --test tests/ai/selfplay/mcts.test.ts selfplay.test.ts server.test.ts`: 15/15 pass:
  - gumbel/puct × engine/factored: valid choice, normalised policy, sims ≤ budget, value in range; determinism
  - rolled-back root option is never chosen and gets no policy mass; the game loop masks it and drops the position
  - full mock self-play game in the factored env; shard round-trip (TS writer → TS reader); bots through the
    factored env; factored determinisation replays a partial multi-step move
  - TS client ↔ Python mock server: handshake + 500 pipelined requests on 2 slots; schema mismatch rejected
    (fatal, loud)
- `pytest python/tests/test_riftzero.py`: 5/5 (wire round-trip; collate padding/masking; TS-written shard read by
  Python + batch dims from the schema + resume-aware window; config resolution of all 3 profiles; Elo + gating).
- End to end, `scripts/smoke.sh --backend mock` (launcher → mock server → 2 workers → shards → eval): ALL PASS, 27
  games, 1,432 positions, 0 errors, 0 rollbacks. `scripts/stop.sh` and Ctrl-C both stop cleanly in about 3 s with
  no leftover processes; restarting the same run name resumes.
- Measurements: about 13 ms engine time per simulation (bundled; 87% is getLegalActions + applyAction), about 160
  decisions per game, 30.3 KB per recorded position. Python mock server: about 8.6 k evals/s from one client.

**Not testable here (no torch)**: `model.py`, `train.py`, `torch_backend.py`, `export.py`. They were reviewed by hand and by
an independent reviewer (docs/agents/review-torch.md: 12 findings, all fixed on agent/fix). The numpy-side parts of those
fixes are tested in `python/tests/test_review_fixes.py`.
`scripts/smoke.sh` (torch backend) is the first thing to run on the GPU machine: it exercises every one of them
(trainer steps, checkpoints, hot reload, eval).

## Integration points for the lead (merge)

1. **Encoder**: built against agent/encoder head 8397049 (schema hash 2349895024; action dim 152). Dims are read from
   `schema.json` at runtime; nothing is hard-coded. My worktree has uncommitted copies of `src/ai/encode/*`,
   `python/riftnet/*`, `data/encode-card-index.json`. Take them from agent/encoder. `python/riftzero/wire.py` and
   `dataset.py` duplicate a little of `python/riftnet` (frame parsing, collate). They could be unified later; both
   follow wire.ts.
2. **Factored env**: `factored-env.ts` imports `src/ai/env/factored.ts` from agent/enum (d46bb97, also in
   agent/encoder). It uses `factor(g, opts)`, `node.pick`, `isAction`, and option `id`/`action`. It needs that file
   at merge.
3. **Coach**: `NNCoach` in `src/ai/selfplay/nn-evaluator.ts` provides `evaluate()` (value, winProb, priors) and
   `analyse()` (ranked candidates with prior/visits/q/winProb/improvedPolicy). Wire it into src/ai/coach's analyse/review
   as an optional evaluator (e.g. `review --nn-port 47000`).
4. **Caps**: fuzz values are the defaults (`config.ts` DEFAULT_CAPS, `config.py` DEFAULTS, `config/*.yaml`).
5. `.gitignore`: add `runs/`, `.venv/`, `__pycache__/`, `*.rfs.tmp`.
6. `package.json`: unchanged. The scripts call `node --import tsx` directly.

## Known limitations / next steps

- Engine speed dominates (about 87% of search time). The biggest wins: caching `getLegalActions` per state, cheaper
  `cloneState` (structural sharing), and fewer re-enumerations in the factored layer (it calls getLegalActions
  again for top-level nodes).
- Shard frames are float32 at about 30 KB per position. float16 or zstd would cut disk/RAM about 2–4×.
- The opponent model is uniform over unseen cards (determinize.ts). Belief-weighted determinisation would come later.
- Partial sub-choice picks reach the network only through the encoder's `picked`/`assigned` pointer roles (fine for
  now).

# Riftforge: notes for Claude Code

Owner: Jonathon. This repo is a fully automated Riftbound (League of Legends TCG) rules engine and online game, plus
the framework for training a high-level Riftbound AI on it. **The goal** is an extremely strong practice partner,
and a coach that explains its moves so Jonathon can talk through his decisions with Claude and learn faster.

## Where things stand (handover from the claude.ai session, 2026-11-26)

The work so far was done in one claude.ai session with five parallel agents, merged on `main`. Per-agent notes
are in `docs/agents/*.md`; read the relevant one before changing an area.

| Area | Status | Code | Notes |
|---|---|---|---|
| Rules engine | Done before this session; ~9,300 tests | `src/engine`, `src/cards` | `ARCHITECTURE.md`, `AI-STARTER.md` |
| Fuzz + bug fixes | 200-game fuzz clean; 150-game re-fuzz after all merges clean | `tools/fuzz.ts` | `docs/agents/fuzz.md` |
| Factored action layer | Every decision gets a complete, finite list of choices | `src/ai/env/factored.ts` | `docs/agents/enum.md` |
| NN encoders + wire format | Done, leak-tested, 0.4 ms per observation | `src/ai/encode`, `python/riftnet` | `docs/agents/encoder.md` |
| Coach / review | Done; uses the hand-tuned eval for now | `src/ai/coach`, `tools/review.ts` | `docs/agents/coach.md` |
| Self-play training runtime | Written; tested end to end here with a mock (numpy) backend only, **never run with torch/GPU** | `src/ai/selfplay`, `python/riftzero`, `scripts/`, `config/` | `TRAINING.md`, `docs/agents/runtime.md` |

**Next steps, in order:**
1. ~~`scripts/setup.sh`, then `scripts/smoke.sh` on Jonathon's PC.~~ Done 2026-11-26: both pass on the RTX 5070 Ti
   (torch 2.10.0+cu128). The model, trainer and CUDA inference needed no fixes; eval Elo maths and ONNX export did
   (see CHANGELOG). A rehearsal of `config/train.yaml` and an eval vs searchai/best/bot also ran clean.
2. First real run with `config/train.yaml`: a narrow deck pool, 1–3 days. The question to answer is whether Elo
   against SearchAI keeps climbing. If it does, move to the EPYC box (`config/train-epyc.yaml`).
   **Status:** `home-1` ran 2026-11-26 23:26 → 2026-11-27 14:12 on the home PC and is **stopped**. The summary is in
   `docs/runs/home-1/README.md`.
   - 14.2k games, 480k positions, 7,500 steps. Value loss 0.99 → 0.335.
   - Still below the rules bot (best 4–12), and 0 wins against SearchAI in 4 evals. The Elo question is still open.
   - 2 engine errors to fix (repro seeds in `docs/runs/home-1/errors.jsonl`).

   **Status:** `epyc-1` started 2026-11-27 14:26 on the EPYC ("simulation-server"), tmux session `train`
   (window `launcher`; window `dashboard` bound to the tailscale IP, http://simulation-server:8050 from any tailnet
   device). Resumed 15:17 with ckptEverySteps 250 / eval every 6 checkpoints (see CHANGELOG).
   - The box has **one RTX 3060 Ti 8 GB** (sm_86), not several 5070 Tis: `inference.gpus: [0]`, 2 servers, and the
     trainer shares the same card. ~3,700 games/h. More workers (192/240, using SMT) gave +1%; the GPU is not the
     limit either. Engine speed is now the throughput lever on this box.

   - **Thermal:** the box hard-crashed at 15:28 on 2026-11-27 (fatal memory-controller error; DIMMs have hit 85 °C
     before). Never run it at full load without `~/thermal-guard.sh` running (tmux window `guard`) and the DIMM
     fan in place. Sensors: `/var/log/hwtemps.log` (every minute). Details in CHANGELOG.

   How it was set up (redo these steps on a fresh box):
   - Clone, `scripts/setup.sh`, `scripts/smoke.sh`, set `inference.gpus` in `config/train-epyc.yaml` to the GPUs
     present (`nvidia-smi -L`), then `scripts/start.sh --config config/train-epyc.yaml` in a tmux session `train`,
     with `scripts/dashboard.sh` in a second window (view remotely with `ssh -L 8050:localhost:8050`).
   - Before starting, check `pgrep -af 'riftzero|selfplay'` is empty. An interrupted smoke run can orphan its
     trainer, server and workers; on the home PC they ran for all of home-1 and took about 2 cores.
   - Start epyc-1 fresh: it uses a `medium` model, so home-1's `small` checkpoint can't load. Home shards *could*
     seed its buffer (same schema), but the EPYC regenerates a day of home data in ~3 hours, so it isn't worth moving.
   - Watch vs-bot first: it should pass 50% by about 2–3M positions, then the first SearchAI wins should follow. If
     not, investigate before spending more compute (see the run README).
   - Before ever using `battlefieldSelection: 'choose'` in self-play, fix the leak noted in docs/CHANGELOG.md
     (the first player's private pick is visible to the second player's search via `ex.unit`).
3. Wire the trained net into the coach as the evaluator: the `NNEvaluator` adapter in `src/ai/selfplay/nn-evaluator.ts`
   goes into `src/ai/coach/analyse.ts`. That gives real win% in reviews instead of calibrated heuristic scores.
4. Later: ONNX export into the browser game as an opponent; opponent modelling for hand reads.

## Machines

- **Primary now:** Jonathon's home PC. Windows + **WSL2 (Ubuntu)**, Ryzen 7 9800X3D (8 cores / 16 threads), one RTX 5070 Ti 16 GB (Blackwell, needs CUDA 12.8+ PyTorch wheels).
  - Keep the repo inside the WSL filesystem (`~/riftforge`), never under `/mnt/c`.
  - The NVIDIA driver comes from Windows. Never install a Linux NVIDIA driver inside WSL.
- **Later:** "simulation-server", AMD EPYC 9754 (128 cores), 512 GB RAM, Ubuntu 24.04, several RTX 5070 Ti.

## Commands

```bash
npm install                      # node >= 22
npx tsc -p .                     # must be clean
npm test                         # full suite, ~9,300 tests (≈1–2 min with many cores; was 10+ min on 2 cores)
npx tsx --test <files>           # targeted tests
npx tsx tools/fuzz.ts            # random-policy fuzzer: run after any engine change
npx tsx tools/encode-schema.ts   # regenerate python/riftnet/schema.json + card table after ANY encoder feature change
PYTHONPATH=python .venv/bin/python -m pytest python/tests -q   # (unittest discover only finds 4 of the tests)
node --import tsx tools/review.ts game.json --player 0 --budget medium   # coach review → review.md
```

Training workflow (setup, smoke, start, status, dashboard, stop/pause, fine-tuning a matchup, export) is in `TRAINING.md`.

## Rules that matter

- **The engine is the spec.** Don't change Decision/Action semantics or the UI contract. ~9,300 tests and the online
  game depend on them. Engine bug fixes always come with a regression test, and the fuzzer runs afterwards.
- **Never train or act on hidden information.** Encode from what the player can see; `tests/ai/encode/leak.test.ts`
  must stay green. Decklists are treated as known (open-decklist), matching `src/ai/determinize.ts`.
- **Schema hash.** Any encoder feature change changes `schemaHash()`. Regenerate the schema; old checkpoints are then
  incompatible, and the inference server refuses mismatched workers on purpose.
- **Rollbacks.** Some enumerated targets lead to a payment failure that undoes the whole play: `applyAction` returns
  `events[0].type === 'rollback'` with the state unchanged. Search and self-play must mask these, not count them as moves.
- **Caps for RL self-play** (from the fuzz agent's study): maxTurns 60 while play is near random, then 40 (trained
  play ends by about turn 26); maxActions 1500; maxMainPerTurn 40. Score a timeout as a draw, well below a win.
- **Determinism.** Same seed and same actions give the same game. All randomness goes through `state.rng`.
- **Documentation.** Changes go in `docs/CHANGELOG.md`.

## Known limitations

- **Coach win%** comes from a logistic calibration of the hand-tuned eval (held-out AUC 0.80). It's overconfident
  in lost positions. The trained net replaces it.
- **Hand reads** are decklist priors only; there's no inference from how the opponent played yet.
- **The factored layer** knowingly skips outcome-irrelevant variants: overkill splits, which ready rune gives
  energy, and payments that overpay.
- **Engine todos:** 2v2 invite timing (RJ#906); ven-163's Empower-scope "[1] or [A] less" still takes the [1]
  (rules-decisions #79). Jonathon's ENGINE-10 update (merged from the second zip) fixed RJ#13152, RJ#13165 and RJ#13329,
  and its RJ#13328 fix replaced the fuzz agent's version. Jonathon keeps working on the engine himself, so merge his
  zips as a commit on a branch from the last upstream commit, then merge into `main` (the last upstream commit is branch `upstream/engine1`).
- **Self-play throughput:** measured on the mock backend at about 13 ms per search simulation, 87% of it in the rules
  engine (`getLegalActions` + `applyAction`). `TRAINING.md` estimates about 800–1,000 games/hour on the home PC and
  4,000–5,000 on the EPYC; **measured on the home PC with an untrained net: 553 games/hour** (GPU mostly idle).
- **Engine speed:** about 1.7 ms per `applyAction`. Profiling points at `computeChars` and its relatives, plus
  `structuredClone`. Optimise only if self-play throughput is the bottleneck; don't port to Rust yet.

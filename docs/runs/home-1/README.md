# Run home-1 (home PC, 2026-11-26 23:26 → 2026-11-27 14:12)

The first real training run: `config/train.yaml`, `small` model, one RTX 5070 Ti, 14 self-play workers on a
Ryzen 7 9800X3D. Pool: the four `decks/home-*.json` lists, `battlefieldSelection: random`. It was stopped cleanly
for the move to the EPYC. Its checkpoints stay on the home PC (`runs/home-1/ckpt`); they're `small` and can't load
into the EPYC's `medium` model.

Files here:
- `final-status.txt`: `scripts/status.sh --matchups` just before the stop
- `elo.csv`, `eval/step-*.json`: every eval
- `metrics.jsonl`: trainer metrics
- `config-resolved.json`: the run's resolved config
- `errors.jsonl`: the 2 failed games, with seeds to reproduce them

## Numbers

| | |
|---|---|
| Wall time | 14 h 46 m |
| Self-play games | 14,203 (about 1,000/h; peak 1,079/h) |
| Positions | 482,580 |
| Trainer steps | 7,500 (each sample used about 4 times: the reuse cap, so the trainer was waiting on data) |
| GPU utilisation | about 27% (the rules engine on the CPU is the bottleneck) |
| Timeouts / errors / rollbacks | 7 / 2 / 6 |

Throughput caveat: four processes left over from an interrupted smoke run (`runs/smoke`: trainer, inference
server, 2 workers) kept running for the whole run and took about 2 CPU cores. Clean throughput would have been
somewhat higher.

## Learning curves (step 50 → 7,500)

| | Start | End |
|---|---|---|
| Value loss (1.0 = no information) | 0.99 | 0.335 |
| Policy loss | 2.07 | 1.26 |
| Policy entropy | 2.10 | 1.27 |

Value loss fell fast (0.49 by step 600) and then slowly. Policy loss was still falling at the stop.

## Evals (16 games per opponent, paired deals)

| Step | vs SearchAI | vs rules bot | vs previous eval checkpoint |
|---|---|---|---|
| 1,500 | 0–16 | 1–15 | 16–0 (vs step 0) |
| 3,000 | 0–16 | 2–14 | 11–5 (+128 Elo) |
| 4,500 | 0–16 | 4–12 | 13–3 (+235) |
| 6,000 | 0–16 | 1–15 | 8–8 (+0) |

The step-7,500 eval was cut off by the stop.

**What it tells us:**
- The pipeline works. Each checkpoint beat the previous one up to step 4,500.
- After 480k positions the net is still weaker than the rules bot, and it never won a game against SearchAI. The
  −607 against SearchAI is the formula's floor for 0 wins, not a measurement.
- The step-6,000 results (8–8 against the previous checkpoint, 1–15 against the bot) may be noise, since a 16-game
  eval has a ±164 Elo interval. They may also be an early plateau.

**The question for epyc-1 is still open:** does the net start beating the rules bot, and then take games off
SearchAI? Rough checkpoints:
- the net beats the bot more than 50% of the time by about 2–3M positions;
- its first wins against SearchAI come soon after.

If neither happens, investigate before burning more compute: the eval search budget, the value target, and
sims/decision (26.7 average in self-play).

## Deck balance (self-play, net against itself, non-mirror games)

Mordekaiser 57%, Rek'Sai 51%, Vex 48%, Azir 44% (n ≈ 5,300 each, so the gaps are real at this skill level). Worst
pairing: Azir vs Mordekaiser, 41%. This was a weak net, so it says more about which decks are easy to play badly
than about the lists. Re-check once the net beats SearchAI.

## Engine errors (2 games, discarded)

Both are `no legal options for chooseTargets (all rolled back)` in Mordekaiser vs Rek'Sai games. The engine offered
a target decision where every target leads to a payment-failure rollback. Repro seeds are in `errors.jsonl`:
- seed 1616262330, firstPlayer 0
- seed 417184040, firstPlayer 1

Replaying the game needs the same policy, so the quickest route is to fuzz the pairing with the factored env until
it recurs. Fix in the engine with a regression test, then run `tools/fuzz.ts`.

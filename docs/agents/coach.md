# COACH agent notes (task #3: explainable search + game review)

Goal: the "practice partner you can talk through moves with" output. Nothing here changes how SearchAI plays.

## What was added

| Path | What |
|---|---|
| `src/ai/coach/analyse.ts` | `analyse(state, p, opts)`: ranked candidates with score, win%, spread and effort; expected line; hand reads |
| `src/ai/coach/labels.ts` | `labelAction(g, a, d?)` (every Action type) and `describeSituation(g, p)` (only what p can see) |
| `src/ai/coach/handreads.ts` | `handReads(g, p, samples)`, per card and per category (removal, combat trick, reaction, counter, draw); `categoriesOf(card)` |
| `src/ai/coach/winprob.ts` | `winProb(eval)` from `data/coach-calibration.json` |
| `src/ai/coach/index.ts` | Barrel |
| `src/net/record.ts` | `GameRecord` format `riftforge-game/1`: setup minus cardDb, plus every applied action |
| `src/net/session.ts`, `src/net/online.ts` | LocalSession and HostSession record every applied action (the host save carries the record too). `GameSession.gameRecord?()` |
| `src/ui/board.ts` | Menu item **Export game record (for review)**: downloads the JSON and shows it in a dialog with a Copy button (for hosts where downloads are blocked) |
| `tools/review.ts` | Replays a record and writes `<out>.json` + `<out>.md`. `--sim` plays and reviews a fresh game |
| `tools/coach-calibrate.ts` | SearchAI self-play, then fits a logistic eval→win%, with held-out metrics, and writes `data/coach-calibration.json` |
| `tests/ai/coach/coach.test.ts` | 11 tests (below) |
| `tests/ui/export-record.test.ts` | Playwright: menu export, then the record replays in Node to the same turn and points |

## API

```ts
import { analyse, labelAction, describeSituation, handReads, winProb } from './src/ai/coach/index.ts';
const an = analyse(state, player, {
  determinizations: 2,   // sampled worlds per candidate (same worlds for every candidate)
  contNodes: 50,         // planTurn budget for the continuation after each candidate
  maxCandidates: 8,      // plus every action in `include`
  include: [playedMove], // always scored, flagged `included`
  handSamples: 200,      // 0 = no hand read
  seed: 1,
});
// an.candidates: [{ action, label, score, winProb, spread, worlds[], nodes, included?, invalid? }] best first
// an.best, an.expectedLine: [{ by: 'you'|'opponent', label, turn }], an.handReads, an.situation, an.evalNow, an.winProbNow
```

How a candidate is scored. It's applied in K determinized worlds, then settled (the bot answers both sides' response
windows). If it's still the player's own main phase, `planTurn` finds the best continuation. The score is the
planner's "end the turn here" evaluation, the same number SearchAI maximises. "End turn" is scored as the planner's
root (the state before ending). Response windows and in-step choices are scored like `SearchAI.searchSimple`. Candidates
come from the AI's own generators (`mainCandidates`/`topMain`, `inStepCandidates`, pass plus plays), so the ranking is the
AI's view. The analysis ranks more of them, adds the played move, and keeps every score.

## Calibration (data/coach-calibration.json)

- 110 SearchAI vs SearchAI games (default options), 20 meta decks, seats alternated: 14,293 rows (one per turn, player
  and decision kind). 0 draws or errors. About 19 minutes on the shared 2-core box.
- Model: `p = sigmoid(a + b * f(eval))`, `f(x) = sign(x) * ln(1 + |x|/20)`, `a = -0.133`, `b = 1.285`.
- Held out (33 games, 4,071 rows): **log-loss 0.550** (constant baseline 0.693; plain linear logistic 0.565),
  Brier 0.184, accuracy 72.7%, **AUC 0.80**.
- Reliability, held out, predicted → observed: 0.06→0.13, 0.15→0.18, 0.25→0.23, 0.35→0.42, 0.45→0.42, 0.55→0.55,
  0.65→0.57, 0.75→0.77, 0.85→0.85, 0.92→0.91. Reasonable through the middle. Still somewhat overconfident at the losing
  extreme, and noisy in the 0.3–0.7 bins.
- A turn-player-dependent model (separate slope when the decider is the turn player) improved held-out log-loss by only
  0.001, so it isn't used.
- Honest caveats: rows within a game are correlated, so the effective sample is closer to 110 games. It's calibrated on
  SearchAI-vs-SearchAI play, and a human-vs-SearchAI game may sit elsewhere on the curve. It calibrates the position
  evaluation, not search quality: a move's win% is "the bot's evaluation after the bot's best continuation", mapped
  through this curve.
- Refit: `node --import tsx tools/coach-calibrate.ts --games 110 --dump rows.json`, or `--from rows.json`.

## Review tool

```
node --import tsx tools/review.ts game.json [--player 0|1] [--budget low|medium|high] [--top 5] [--out review]
node --import tsx tools/review.ts --sim 25 --decks 02-vex.json,06-kai-sa.json [--you bot|ai] [--opp ai|bot] [--save-record g.json]
```

- Input: a `riftforge-game/1` record (game menu → Export), a `tools/fuzz` repro (`{ spec, actions }`), or
  `{ seed, decks, actions }` where decks are DeckLists or meta-deck file names. `--player` defaults to the exporting
  seat (`you`), else 0.
- It analyses every decision of that player with more than one real option. It skips mana-ability clicks, payment
  decisions and forced moves. Cost = best win% − played win%.
- Output: JSON (every decision, every candidate) and markdown: overview, win% at the start of each of your turns, top
  mistakes (situation, played vs preferred, all options, expected line, opponent hand read), a table of all decisions,
  and a "talking it through" prompt for a chat with Claude. Sample: `docs/agents/coach-sample.md`.
- Speed on this box (2 cores shared with 3 other agents): low ≈ 15–25 s per game, medium ≈ 20–80 s, high is several
  minutes. That's fine on a laptop.

## Tests run (all green)

- `tests/ai/coach/coach.test.ts`: 11/11. Covers labels over every legal action of many positions and synthetic actions
  of every type; the situation summary doesn't name the opponent's hidden hand; analyse() ranks, includes the played
  move, doesn't mutate, is deterministic, and handles main, response and in-step decisions plus trivial ones; hand-read
  consistency and public-information-only behaviour; category heuristics; winProb monotone and bounded; record replay
  round trip plus review end to end; fuzz-repro input; **SearchAI golden hash** (seed 31, meta decks 03-evelynn vs 06-kai-sa, 5
  turns: `69813931cc06dc26`, recorded on the baseline commit e553a1f), plus the same hash with analyse() calls
  interleaved.
- `tests/ai/search-ai.test.ts`, `tests/ai/core/core.test.ts`, `tests/ai/plans/*.test.ts`: 91/91.
- `tests/rules/cancel-play.test.ts` (uses the sessions): 12/12. `tests/ui/export-record.test.ts`: 1/1.
- `npx tsc -p .` clean.

## Limitations / next steps

- **The evaluation is hand-tuned.** Large single-move costs can come from blind spots in it. For example, the sample's
  "41%" on turn 7 is real according to the eval (playing a 7-cost unit gives up Empower on Steel Paws), but the size of
  the gap is the heuristic's opinion. Real win% arrives with the trained value network. `winProb()` is the place to
  swap it in.
- **Hand reads are priors.** They're uniform over the opponent's unseen cards given the known decklist. They don't infer
  from how the opponent played (passing with mana up, not blocking). That needs a learned model, or a Bayesian
  reweighting of determinizations by the opponent policy's likelihood.
- **Opponent moves in the expected line are sampled.** So is any card "you" draw in it (marked "card drawn in this
  sample"). It's one illustrative world, not a forecast.
- **Spread is often 0.** On your own turn the opponent's hidden cards rarely change the evaluation (it uses the
  opponent's hand size, not identities). Spread is informative mainly for response windows and draw-dependent lines.
- **Only seats with the full state can export.** That means local games (hotseat, vs bot) and the online host. An
  online guest can't export, because it only has a redacted view. A host game restored from a save made before this
  change has no record.
- **Big decisions use the AI's candidate generators.** The engine's "choose any number" lists are capped (see the ENUM
  agent's work). A human pick outside the generated set is still scored via `include`.

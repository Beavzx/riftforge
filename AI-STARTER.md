# Building an AI on the Riftforge engine

Riftforge is a complete Riftbound rules engine: pure, deterministic TypeScript with no I/O, every player choice
exposed as a Decision, and every legal answer enumerable. That makes it a ready-made environment for search
or learning agents.

## Quick start

```bash
npm install              # needs: typescript, tsx (node >= 22)
npm test                 # ~9,000 tests (rules, cards, Rift Judge rulings, everyday-play matrix, AI)
node --import tsx tools/gym-server.ts      # JSON-lines bridge for any language (see below)
python3 examples/random_agent.py           # plays bot-vs-random through the bridge
```

## The engine API (src/engine/index.ts)

| Call | What it does |
|---|---|
| `createGame(setup)` | New game from a `GameSetup` (seed, two `DeckList`s, `cardDb` from `data/cards.json`) |
| `state.pending` / `getPending(state)` | The current `Decision`: whose choice, what kind (mainAction, chainResponse, chooseTargets, payment, …), options |
| `getLegalActions(state, player)` | Every legal `Action` for that player right now |
| `validateAction(state, action)` | `null` if legal, else the reason |
| `applyAction(state, action)` | `{ state, events }`; the input state isn't mutated in place by callers' contract, but clone (`structuredClone`) before branching in a search to be safe |
| `getView(state, player)` | What that player is allowed to see: hidden cards become opaque ids, the seed is removed, an opponent's hand and the decks are anonymised |
| `chooseAction(state, player)` | The simple built-in rules bot (a baseline opponent) |

Facts that matter for AI work:
- **Deterministic:** the same seed and the same action sequence always give the same game, so replays are free.
- **Hidden information is real:** train and act on `getView`, never on the raw state. Search agents determinise
  hidden zones from public information (see `src/ai/determinize.ts`).
- **Speed:** about 1.3–1.8 ms per `applyAction` and about 3 ms per `getView` pair on one core. A full bot-vs-bot game
  is about 1–3 s. Search depth is the bottleneck, not rules.
- **Action space:** variable and structured (play a card with a destination, targets, modes and payment; move units;
  answer a decision). `getLegalActions` flattens each decision into a list, which suits a policy that scores
  candidates (pointer-network / action-embedding style) better than a fixed action head.
- **Enumeration gaps:** a few rare decisions with huge option spaces (big "choose any number" sets) aren't fully
  enumerated. `tools/sim-lib.ts` (`fallbackAnswer`) shows how to search a decision's own option space for an answer
  `validateAction` accepts.

## What already exists

- `src/ai/`: a working search AI (turn-level planner, determinised lookahead, hand-tuned evaluation in `eval.ts`)
  plus per-legend deck plans in `src/ai/plans/` (Azir, Kai'Sa, Rek'Sai, Sett, Vex, Evelynn, Irelia, Kennen, Ezreal).
  It beats the older search AI about 70% of the time and the rules bot about 80%. It's a decent baseline and
  sparring partner, not a strong player. `src/ai/legacy/` is the older version.
- `docs/ai-plans.md`, `docs/ai-pilots/*.md`: the plan interface, and written game plans per legend with sources.
- `data/meta-decks/*.json`: the top 20 lists from the Demacia League Bologna post-ban tournament.
- `tools/sim-lib.ts`, `tools/ai-bench.ts`, `tools/meta-sim.ts`: game runners with invariant checks, seat
  swapping and Wilson confidence intervals.
- `tools/fuzz.ts`: random-policy fuzzer with invariant and hidden-info leak checks. Run it after engine changes.
- `tests/fixtures/invariants.ts`: state invariants you can assert during self-play.

## The JSON-lines bridge (tools/gym-server.ts)

For Python, or any other language, run the server and talk to it over stdin/stdout, one JSON object per line:

```
{"cmd":"decks"}                                     list the 20 meta decks
{"cmd":"reset","seed":1,"decks":["01-azir.json","02-vex.json"]}
{"cmd":"step","index":3}                             take legal[3] for the player to act
{"cmd":"step","action":{...}}                        take an explicit Action (validated)
{"cmd":"bot"}                                        let the built-in bot act
{"cmd":"save"} / {"cmd":"load","id":"s1"}            snapshot/restore for tree search
```

Each reply is an observation: `toAct`, the decision `kind` and `prompt`, `legal` (the action list), `view` (the
redacted `PlayerView` for the player to act), `done`, `winner`, `points`, `turn`, and the event types from the last
step. Pass `"view": false` to skip the view when you only need the action list. Rewards: `winner` at the end, and
`points` (first to 8) as a shaping signal.

## Suggested path to a learned AI

1. **Baseline:** pit your agent against `{"cmd":"bot"}` and against `src/ai` (SearchAI) using `tools/ai-bench.ts`.
2. **Observation encoder:** turn `getView` into tensors: your hand and board, the opponent's board, battlefields,
   the chain, the showdown, runes and the pool, points, and the turn. Encode cards from `data/cards.json`
   (cost, might, domains, keywords, text embeddings) so new sets need no retraining from scratch.
3. **Policy over candidate actions:** score each entry of `legal` with the state encoding, then softmax over the list.
4. **Self-play:** PPO or AlphaZero-style with determinised search (`src/ai/determinize.ts` + MCTS). The engine is
   deterministic and cheap to clone, so search-based self-play is practical. Parallelise across processes; the
   engine is single-threaded.
5. **Port for speed (optional):** if Node becomes the bottleneck, the rules live in `src/engine` (about 20 files)
   and the card scripts in `src/cards`. The ~9,000 tests are the spec for any port.

## Rules confidence

- Rules decisions and their official sources: `docs/rules-decisions.md`, `docs/riftjudge/DECISIONS.md`.
- Rift Judge verification: about 13,100 judge questions checked against the engine. Every disagreement was
  decided against the official Core Rules 1.5 / FAQs / errata and made into a test.
- Known gaps: the 2v2 "invite" timing (RJ#906) isn't implemented. The open list is at the end of `docs/CHANGELOG.md`.

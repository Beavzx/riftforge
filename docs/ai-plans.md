# Deck plans for the search AI (interface for PILOT agents)

Owner: AI-CORE. Interface: `src/ai/plans/types.ts` (the source of truth; this page explains it). Questions / missing
features: one line in `docs/ai-requests.md`, tagged with your agent name, e.g.
`- [PILOT-AZIR] combo step that targets "the unit I just played" (needed for Weaponmaster attach)`.

## Where your code goes

| What | File | Owner |
|---|---|---|
| Your plan | `src/ai/plans/<key>.ts` exporting `export const plan: DeckPlan` | pilot |
| Competence puzzles | `tests/ai/plans/<key>.test.ts` | pilot |
| Written game plan + sources | `docs/ai-pilots/<key>.md` | pilot |
| Interface, registry, core search | `src/ai/plans/{types,registry,index}.ts`, `src/ai/core/**`, `src/ai/*.ts` | AI-CORE |

`<key>` is fixed: the legend's champion tag in lowercase letters only — `azir`, `vex`, `evelynn`, `reksai`, `kaisa`,
`irelia`, `kennen`, `ezreal`, `sett`. Stub files already exist for all nine and are registered by
`src/ai/plans/index.ts`; just fill in your stub (keep the export name `plan`). The plan applies to every list of that
legend (e.g. 01/08/10/14-azir). If lists differ, branch inside your hooks on `ctx.count(...)` / card names.

## How the core uses a plan

The AI (`src/ai/core`, used by `SearchAI`) plays each main-phase turn by **turn-level search**: from the current quiet
state it expands move sequences (single legal actions, each settled until the next main-phase decision, plus your
**combo lines** as macro-moves), keeps the best few states per depth (beam), merges transpositions, and plays the first
action of the best sequence (re-planning after each action, so the plan adapts to what the opponent does in response).
Leaves are scored by the core evaluation plus your **eval adjustments**, with a determinized light opponent reply.
Your plan is consulted at every decision of the player whose legend matches:

| Hook | When it is called | Effect |
|---|---|---|
| `mulligan(hand, ctx)` | mulligan decision | per-card keep score (>0 keep, <0 send back, most negative first); `undefined` = core default |
| `prior(a, card, d, ctx)` | every candidate action, any decision | orders/prunes candidates (only the top-K are searched) and is added x `priorWeight` (default 0.25) to the searched score |
| `combos[]` | main phase, my turn | each line whose `when` holds is tried as one macro-move inside the turn search |
| `resources` | leaf evaluation | `runeValue`, per-recycle cost (`recycleCost`), end-of-turn energy `reserve` for reactions |
| `hide` | hide candidates + leaf evaluation | `hideValue` of a facedown card, `never` list, `defense` (Might it adds to its battlefield in the threat projection) |
| `eval` | leaf evaluation | weight overrides, per-card values (`cardValue`), free bonus feature |
| `target(opt, id, d, ctx)` | in-step choices (targets, cards, attach, ...) | per-option preference added to the core prior; also used inside combos. For yes/no (`optional`), `confirm` and `chooseMode` decisions it is called with `opt = null` and the option id (`'yes'`/`'no'`/mode id); with `prior` on `{type:'choose', optionIds:[id]}` it decides them (no opinion = `undefined` from both: the planner tries both answers) |
| `respond(a, card, d, ctx)` | chain / showdown response windows (also on the opponent's turn) | > 0: search this response; < 0: never consider it |

All numbers are **evaluation units**: 10 = one point of score lead, ~1.3 = one Might on the board, ~1.2 = one card in
hand, ~1.4 = one rune. Use 1-3 for a nudge, up to ~10 for "strongly prefer". The search still checks consequences —
a prior only decides what gets looked at and breaks ties; an eval adjustment changes what the AI *wants*.

`ctx` (`PlanCtx`) gives you derived, read-only views: `hand`, `board`, `oppBoard` (facedown enemy cards show as
`name: 'facedown'`), `legend`, `runes`, `readyRunes`, `myPoints`/`oppPoints`/`victory`, `playedThisTurn` (names),
`count(name|pred, where)`, `unitsAt(loc, who)`, `mightAt(bf, who)`, `controllerOf(bf)`, `battlefields` (names), `info(obj)`.
Each card is a `CardInfo` (`name`, `type`, `tags`, `keywords`, `energy`, `power`, `might`, `zone`, `battlefield`,
`exhausted`, `isToken`, `attachedTo`, `attachments`, `champion`, `text`). Hooks must be pure and cheap (they run at
every leaf); never mutate `ctx.g`. Only read public information + your own hand (the state you get may be a
determinization: the opponent's hidden cards are resampled from their public decklist).

## Combo lines

A `ComboLine` is an ordered list of `StepMatch`es the search tries as one move:

```ts
combos: [{
  name: 'equipment -> legend soldier -> attack with Azir',
  when: ctx => ctx.myTurn && !ctx.legend.exhausted && ctx.count(c => c.tags.includes('Equipment'), 'hand') > 0,
  steps: [
    { do: 'play', card: c => c.tags.includes('Equipment'), to: 'base' },          // exactly one Equipment
    { do: 'activate', card: 'legend' },                                             // [1],[T]: Sand Soldier
    { do: 'move', card: 'Azir', to: 'battlefield', units: 'ready', optional: true },// attack; core picks the battlefield
  ],
  choices: [
    { prompt: /Weaponmaster/i, pick: (opt, id, d, ctx) => opt && !opt.attachedTo ? opt.might + opt.energy : -5 },
  ],
}]
```

- Step matching: `do` is the action type (`play` = playCard, `activate`, `move`, `hide`, `pass`, `endTurn`); `card` is a
  name, list of names, predicate, or `'legend'`; `to` = `'base'` / `'battlefield'` (any; the core tries the best) / an index;
  `ability` = ability index for `activate`; `units` for moves (`'ready'` = all ready units that can go, or a predicate,
  default = just the matched unit). When several legal actions match, `score` (or the core prior) picks.
- Everything that comes up *while a step resolves* (targets, "choose an Equipment", optional "may", payment) is answered by
  `choices` (first rule whose `prompt`/`kind` matches), then your `target` hook, then the core.
- A non-optional step that matches nothing aborts the line; a line is only played if its end state evaluates better than
  the alternatives (add `bonus` only to break near-ties). Keep lines short (2-5 steps) and guard them with `when`.

## Resource / hide / eval policies

```ts
resources: {
  runeValue: 1.6,                                         // a rune in play is worth this much to my deck
  recycleCost: (forCard, ctx) => forCard?.tags.includes('Equipment') && ctx.turn > 6 ? 0 : 1.5,  // [C] spends
  reserve: ctx => ({ energy: 2, value: 2.5, forCards: ['Guards!', 'Defy'] }),  // keep 2 open if holding these
},
hide: { hideValue: (c, bf, ctx) => c.name === 'Guards!' ? 3 : 0, never: ['Arise!'],
        defense: (c, bf, ctx) => c.name === 'Guards!' ? 3 : undefined },   // Might it adds to bf's defence
eval: {
  weights: { unitBase: 0.6 },                             // see EvalWeights in src/ai/eval.ts
  cardValue: (c, ctx) => c.name === 'Sand Soldier' && c.attachments.length ? 1.5 : undefined,
  bonus: ctx => ctx.count('Azir') && ctx.legend.exhausted ? 0.5 : 0,
},
target: (opt, id, d, ctx) => /Weaponmaster/.test(d.prompt) && opt?.attachedTo ? -10 : undefined,
respond: (a, card, d, ctx) => card?.name === 'Defy' ? 4 : undefined,
```

### What `recycleCost(forCard, ctx)` is called with

The planner counts runes recycled while a main-phase move resolves (including everything that resolves as its
consequence) and charges `n x recycleCost(forCard)` to the line. `forCard` is the acting card of that move: the played
card, the activated object (legend, Equipment for Equip, ...), or the hidden card. So: Weaponmaster's [C] after the
legend's Sand Soldier -> the legend; Weaponmaster after playing a unit -> that unit; Equip [C] -> the Equipment;
Accelerate -> the unit; hide [A] -> the hidden card. A combo line is charged once for all its recycles with
`forCard = null`. (The rune itself is already valued by the evaluation: `recycleCost` is an extra, deck-specific cost.)

### Payments

The core gives every candidate card play an explicit payment plan that uses free exhaust-only Add abilities (Kai'Sa's
legend, Gold tokens, ...) before recycling runes (the engine's auto-pay recycles first). Nothing to do in plans.

## Testing your plan (competence puzzles)

`tests/ai/core/puzzle.ts` (AI-CORE) builds positions with the real meta decks and asks the AI what it would do:

```ts
import { puzzle, aiAction, aiTurn, names } from '../core/puzzle.ts';
const z = puzzle({ me: '01-azir.json', opp: '02-vex.json', turn: 5 });
z.runes(0, { Calm: 3, Order: 2 });        // my ready runes (replaces existing)
z.hand(0, ['Doran\'s Shield', 'Guards!']); // cards to my hand (by name; "Name, Subtitle" for champions)
z.base(0, 'Azir, Sovereign');              // a unit at my base (ready); z.at(0, 'Sand Soldier', 1) at battlefield 1
z.points(0, 5); z.control(1, 1);           // scores / battlefield control (control(bf, player))
z.token(0, 'Sand Soldier', 'base');        // tokens by name; puzzle({ ..., noChampion: true }) empties champion zones
const a = aiAction(z.g, 0);                // the AI's next action (default AI options)
const t = aiTurn(z.g, 0);                  // play out my whole turn: t.actions, t.names (readable), t.state
assert.ok(t.names.some(s => /activate .*Emperor/.test(s)));
```

The AI under test uses the registered plans, so your plan file is exercised as-is. Puzzles are deterministic for a
fixed seed. Keep each puzzle under ~1 s CPU.

## Core knobs (SearchOptions, src/ai/search.ts)

| Option | Default | Meaning |
|---|---|---|
| `turnNodes` / `replanNodes` / `turnBudget` | 130 / 60 / 340 | engine-step budget of the first turn plan / a re-plan / the whole turn (then cheap depth-2 re-plans) |
| `planner.beam`, `depth`, `k0`, `k` | 4, 6, 7, 5 | beam width (half reserved for distinct openings), max moves per line, candidates at the root / deeper |
| `planner.branchOptional` | true | search both answers of an optional cost and the two best single targets right after a move |
| `planner.resample` | true | re-score the 3 best lines in a second determinization when the best one draws/reveals |
| `planner.replyTop` | 0 | re-rank the N best lines by simulating the opponent's next turn with the bot (off: costs ~30 steps/line) |
| `respondInSettle` | true | the opponent's bot answers chain/showdown windows inside the lookahead |
| `maxNodes`, `responseCandidates`, `inStepCandidates` | 30, 3, 3 | budget/candidates of response windows and unplanned in-step choices |
| `usePlans` | true | consult deck plans (A/B: `--noplans` in the tools) |

Debugging: `AI_DEBUG=1` prints the root candidates, every beam level and the re-scoring; `ai.trace = t => ...` gets each
turn plan's line (`t.line`) and score.

## Measuring

- `node --import tsx tools/ai-bench.ts --only 01-azir --games 60 --vs legacy` — new AI (with plans) vs the legacy AI
  snapshot (`src/ai/legacy`), both seats, random opponents (`--opp 02-vex` to fix the opponent).
  `--vs bot` = engine heuristic bot; `--noplans` = core without plans (A/B your plan).
  ALWAYS run through the snapshot wrapper: `sh tools/meta-sim-snapshot.sh tools/ai-bench.ts ...` (`SNAP=/tmp/<you>-snap`).
- Mechanic metrics: `tools/ai-metrics.ts --only 01-azir --games 40 [--vs ai|legacy|bot] [--json f]` prints per-game counts
  (cards played by name, legend activations, hides and plays from hiding, attachments, tokens made, cards drawn, runes in
  play on own turns 1..10, points) for the piloted deck against random meta opponents.

## Changelog of this interface

- 2026-11-26 v1 (AI-CORE): initial interface.
- 2026-11-26 v1.1: `hide.defense`; yes/no decisions consult `target(null, id)` / `prior`; planner branches on optional costs; settle cap 40 (cap no longer drops lines); explicit payments with free Add sources; `z.token` finds token cards.

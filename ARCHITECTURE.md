# Riftforge — fully automated Riftbound client

Goal: a Hearthstone-style digital Riftbound. The engine enforces every rule and resolves every card
automatically. Players only ever make the decisions the rules actually give them, and the engine
asks for each one explicitly. Nothing is moved by hand. Original branding (not a RiftAtlas copy).

Target: one hosted web page (Claude artifact). Constraints of that host:
- No network fetches to other hosts, no remote images. All card data is bundled (data/cards.json).
- Online play uses the page's `room` capability (realtime messages between people with the page open,
  messages can drop, nothing persists) plus optional `db` doc to resume a game.
- No shell internet in this workspace. Research is via WebSearch/WebFetch only.

Tooling available (no installs possible): node 22, `npx tsc`, `npx tsx`, `esbuild`, `node --test`,
playwright (headless Chromium) for UI smoke tests. Global modules live in /opt/npm-tools/node_modules.

## Layout

```
docs/rules-spec.md        Structured, implementation-ready rules (rules agent). Cite CR rule numbers.
docs/keywords.md          Every keyword, every set, exact behaviour + CR numbers.
docs/rules-tests.md       Independent list of rules scenarios with expected outcomes.
data/cards.raw.json       Upstream dump (user-supplied). Never hand-edited.
data/cards.json           Normalised card DB (tools/build-cards.ts).
src/engine/               Pure, deterministic, DOM-free rules engine.
  types.ts                The contract below. Change it only by coordinating via the lead.
  rng.ts                  Seeded RNG (state lives in GameState).
  game.ts                 createGame / getView / applyAction / pending decision loop.
  ...                     zones, turn structure, chain, showdown, combat, scoring, layers, triggers.
src/cards/dsl.ts          Helpers card scripts use (effects, targets, triggers, statics).
src/cards/scripts/<set>/  One file per set (or chunk) registering card scripts by card id.
src/ui/                   Board, hand, chain, prompts for every Decision kind, log, deck builder/import.
src/net/                  Room/lobby, host-authoritative sync.
tests/rules/*.test.ts     node:test scenario tests for rules.
tests/cards/*.test.ts     At least one scenario test per scripted card.
tools/                    Build scripts (cards, bundle, coverage report).
dist/                     Built page: index.html + app.js + cards.json.
```

## Engine contract (src/engine/types.ts is the source of truth)

- `createGame(setup: GameSetup): GameState` — seeded, includes both decks, legends, champions, battlefields.
- `getPending(state): Decision | null` — the single decision the game is waiting on, and for whom.
  The engine never stalls without a Decision. If only one legal option exists AND the rules don't
  make it optional, the engine resolves it automatically (but logs it).
- `getLegalActions(state, player): Action[]` — enumerates every legal response to the pending decision
  (for decisions with huge option spaces, e.g. damage assignment, a validator is used instead:
  `validateAction`).
- `applyAction(state, action): { state, events }` — validates, then advances the game until the next
  Decision. Pure: never mutates input (structuredClone or immutable updates).
- `getView(state, player): PlayerView` — redacted state for one player (hidden hand, deck order,
  facedown cards) — used by UI and networking.
- All randomness through `state.rng`. Same setup + same action list ⇒ same game (replays, desync checks).

Every rules choice is a `Decision` kind: mulligan, choose action in main phase / showdown (play card,
activate ability, move units, hide, pass), choose targets, choose mode, choose X, "may" optional
effects, payment (auto-pay suggested, manual rune choice allowed), order simultaneous triggers,
assign combat damage, choose battlefield, choose cards from zone (reveal/look/search), conquer/hold
rewards that offer a choice, concede. Agents add kinds as rules require them.

## Card scripts

Each card id maps to a script `{ id, text, abilities: [...] }` built with `src/cards/dsl.ts`.
`text` is the exact effective (post-errata) rules text the script implements; tools/coverage.ts
compares it with data/cards.json and flags cards that are unscripted or whose text changed.
Vanilla units need no script. Alternate-art printings share the base card's script.

## Networking

Host-authoritative. Host browser runs the engine; guest sends `Action` intents with a seq number;
host validates, applies, broadcasts the redacted `PlayerView` + action log index to each player.
Every message is absolute state (drops are harmless); guest re-requests on gaps. Room code = room name
for `room.join(code)`. Optional db doc snapshot for reconnect.

## Definition of done for any change

`npx tsc -p .` clean, `node --import tsx --test tests/**/*.test.ts` green, and the change is listed in
docs/CHANGELOG.md with the agent name.

# Changelog
- [CARD-ANALYSIS] Added tools/analyze-cards.ts (card-text tokeniser/classifier), data/card-analysis.json (per-card parsed abilities, pattern ids, intrinsicKeywords, keywordCosts), data/card-patterns.json, data/card-batches.json, docs/card-patterns.md (symbol legend, pattern catalogue, prioritised DSL primitives, weird cards, rules-relevant parentheticals), docs/card-batches.md (8 mechanic batches + keyword-only B0). Note: CardDef.keywords over-reports keywords on 189 cards; use intrinsicKeywords.
- 2026-11-25 rules-research agent: added docs/rules-spec.md (CR 1.5 Radiance restatement with DECISION markers and open questions §23), docs/keywords.md (all keywords/keyword actions OGN–RAD), docs/rules-tests.md (221 scenario tests incl. official FAQ rulings), docs/deck-formats.md (Piltover Archive deck codes V1–V6 with verified test vectors, sectioned/plain/TTS text formats).
- [UI/NET] Built the web client (src/ui, src/net) and bundler (tools/bundle.ts -> dist/index.html + dist/app.js + dist/cards.json).
  - tools/bundle.ts auto-selects the real engine when src/engine/game.ts exports the contract (else src/ui/mock.ts), regenerating src/ui/engine-impl.gen.ts; picks up src/engine/bot.ts and src/engine/deck.ts when present. `--mock` forces the mock.
  - src/ui/engine.ts facade: normalises applyAction/validateDeck return shapes; botAction() tries bot.chooseAction/botAction/default with (state, player) or (view), falling back to the UI's view-based bot.
  - Screens: home (vs bot / hotseat / bot-vs-bot / online create+join), deck builder (import text lists, TTS strings and Piltover Archive deck codes V1-V6 per docs/deck-formats.md; export list + V3/V4/V5 code; search/add/remove; engine validation; localStorage with try/catch), online lobby, game board.
  - Board: bases, battlefields (control/contested/showdown), legend + champion zone, runes (ready/exhausted) + rune deck + pool, fanned hand with hover/long-press preview, deck/trash/banish counts (trash & banishment viewable), score track, XP, chain stack, phase/turn bar, log, Pass/End-turn button; only legal actions highlighted (from getLegalActions); click or drag to play/move; popovers for multi-destination plays and abilities; prompt panel for every DecisionKind (incl. chooseOrder/chooseShowdown/chooseOpponent, generic fallback); payment panel (auto-pay + manual rune exhaust/recycle -> {type:'choose', optionIds:['manual'], data: PaymentPlan}); damage assignment steppers (engine AssignTarget[] + suggested). View-diff animations (FLIP moves, draw, play, death, damage numbers, conquer, score, turn banner), prefers-reduced-motion respected; light/dark via :root[data-theme]; 390px/720px/desktop layouts.
  - Net: host-authoritative protocol (src/net/protocol.ts, online.ts): guest intents carry seq + state version; host validates via the engine, rejects stale/illegal intents, broadcasts redacted packed PlayerViews (state.ex and card defs stripped, log trimmed); resend until ack, gap re-sync via heartbeat versions, disconnect banners, host-left handling, guest reload rejoins its seat, host reload resumes from sessionStorage. Every received message is schema-validated.
  - Contract: added optional `GameObject.derived?: { might, keywords, tags? }` (types.ts) — getView may fill it with post-layer characteristics; the UI prefers it over re-deriving from modifiers.
  - Tests: tests/ui/decks.test.ts (deck codes incl. doc test vectors + exact V3 round trip, text formats, starter-deck legality, protocol validation, redaction over the wire); tests/smoke/ui.test.ts (playwright: full game vs bot played through UI clicks, bot-vs-bot at 390px, every Decision kind renders, online host+guest full game over a fake room with 15% message loss, reload/rejoin/resume). Fixtures: tests/fixtures/{serve.ts,fake-room.js,ui-driver.ts}; screenshots via tests/ui/shots.ts.

## 2026-11-25 — ENGINE agent
- M1–M4 (in progress, functional): `src/engine/` rules engine — setup (battlefield pick, first player, opening hand, mulligan),
  turn structure, runes/pool/payment with auto-payer + manual plans, playing cards (timing, destinations, Hidden, Ambush, Accelerate,
  Repeat, Flow, Deflect, additional costs), chain with priority, showdowns with focus, standard moves (Ganking), combat with
  damage assignment validation (Tank/Backline/lethal-first), conquer/hold + final-point rule, burn out, cleanup steps, triggers
  (player-ordered), replacement effects, layers (copy/traits/abilities/arithmetic, timestamps), control change, tokens, gear/equip,
  buffs, stun, XP, Empower, concede. Replay-based suspension for in-step decisions (`ex.unit`).
- M5: `src/cards/dsl.ts` + `src/cards/registry.ts` + `src/cards/tokens.ts` (synthetic Mech/Bomb/Sand Soldier/Shadow Clone/Tentacle),
  rule hooks (`engine/rules.ts`), docs/dsl-guide.md. DSL considered stable for scripting agents.
- tsconfig: added `allowImportingTsExtensions` (imports use `.ts` extensions; noEmit build).
- [UI/NET] Match options + best-of-3 (src/net/match.ts): battlefieldSelection 'choose'|'random' (default choose), enforceBanlist (default off), bestOf 1|3. Set on the home screen (local) or by the host in the lobby (broadcast to the guest). GameSetup gets `battlefieldChoice` + `battlefieldSelection` + `enforceBanlist` (+ `firstPlayer` for games 2-3). After each game the loser picks go first/second (bots always go first); online the guest's choice is a validated `next` message. Match score is shown in the top bar and game-over panel. Deck-format import/export follows docs/deck-formats.md (V1-V6 codes, sectioned text incl. "MainDeck:" / "Rune Pool:", unsectioned, TTS, "(SET-NNN)" suffixes); exact V3 round trip uses the printings remembered at import. DeckList.main excludes the champion copy throughout.

## 2026-11-25 — CONFORMANCE agent
- Added the rules conformance suite: tests/conformance/{A-setup,B-turn,C-play,D-chain,E-move,F-combat,G-scoring,H-cleanup,I-triggers,J-keywords,K-faq,L-misc}.test.ts. It has one node:test per scenario in docs/rules-tests.md (221: T001–T220 + T110b), named with the scenario id.
- tests/conformance/harness.ts: S0 standard-state builder, board setup helpers (put/control/setRunes/fundAll/mod/addPrevent), action drivers with answer scripts, EventLog, attackSetup, toMainOf/nextTurn, and a real-card loader (data/cards.json + src/cards/scripts/index.ts, needsScripts()).
- tests/fixtures/conformance/cards.ts: generic test cards (V(n), Tank/Backline/Ganker/Accel/Temp/Ambusher/HidU/DK/Vision/Weaponmaster(n), Assault/Shield/Deflect(n,x), ZapM/ZapA/ZapR, DrawR, CounterR, PumpA/PumpR, StunA, MoveR, KillA, HidZap, Sword, Gold, Recruit) plus scenario fixtures ("...Like" cards), all scripted with src/cards/dsl.ts.
- docs/conformance-report.md: final run 221 tests, 208 pass, 2 fail (T181 engine bug: hand-zone rule abilities ignored; T031 spec error about auto-pay preference), 11 todo. Also lists 17 engine bugs found and fixed during the session, plus rules-decisions.md conflicts.
- docs/conformance-needs.md: API requests N1–N10 (N1, N5, N8, N9, N10 done; N2 test state builder, N3 public cost query, N4 Might-reduction replacement event, N6 granted additional cost/destination, N7 other-player-base destination open).
- 2026-11-25 [SCRIPT B6] Scripted all 135 B6-pump-ready-buff cards in src/cards/scripts/batch-B6.ts (helpers: src/cards/helpers/B6.ts — buff incl. multi-buff, spend-any-number-of-buffs, spend-a-buff-to-ignore-cost, ready-up-to-N-runes, effect moves, batch detection, per-turn trackers, cant-move-this-turn delayed rule); 151 scenario tests in tests/cards/B6/*.test.ts (148 pass, 3 todo pending engine support); 13 DSL/engine requests in docs/dsl-requests.md.
- 2026-11-25 [SCRIPT B3] Scripted the 130 B3-tokens-go-wide cards in src/cards/scripts/batch-B3.ts (+ the Gold token unl-t05 mana ability). Helpers in src/cards/helpers/B3.ts: token plays by id (Recruit/Gold/Sprite/Bird/Reflection/Mech/Bomb/Sand Soldier/Shadow Clone/Tentacle) with per-token location choice, Gold/Bomb helpers, token-free Legion, asPlayer (another player chooses/pays), bonus damage, excess-combat-damage and dead-gear recorders. 148 tests in tests/cards/B3/*.test.ts (145 pass, 3 todo: Rek'Sai, Syndra, Baron Nashor "enter there"). 13 requests (B3-1..B3-13) in docs/dsl-requests.md.
- 2026-11-25 [B1 scripting] src/cards/scripts/batch-B1.ts: all 125 B1 cards (empower/XP/level/costs) scripted; helpers in src/cards/helpers/B1.ts (optionalCostDiscount, selfCostB1 with scope/min, addPlayExtra, payB1.*, paidB1, empowerB1, per-turn facts); tests tests/cards/B1/*.test.ts (140 tests, 5 todo); DSL/engine requests B1-1..B1-15 in docs/dsl-requests.md.
- 2026-11-25 [SCRIPT B7] Scripted all 135 B7-cards-zones cards in src/cards/scripts/batch-B7.ts (helpers: src/cards/helpers/B7.ts — playIt with full/free/ignore-Energy/reduce/alternative costs, forced/extra destinations and then-recycle/banish; look/reveal with Void Hatchling + Nocturne hooks (topCards, revealUntil, lookPick); drawSpecific, deckToTrash, chosenSoFar, asPlayer, delayed prevent-next / hide-free). Tests: tests/cards/B7/*.test.ts (127 pass, 6 todo for engine gaps). Requests B7-1..B7-14 in docs/dsl-requests.md.
- 2026-11-25 [CARDS B8] Scripted all 135 batch-B8 cards (legends, battlefields, rules-modifying statics, replacements, resource abilities, weird cards) in src/cards/scripts/batch-B8.ts with helpers in src/cards/helpers/B8.ts (asP "act as player", battlefield conquer/hold/defend/score-here triggers for any player, per-turn memory, silent event trackers, Reckoner's Arena conquer-effect activation, zone helpers). 174 scenario tests in tests/cards/B8/ (170 pass, 4 todo: Swift Scout hide cost, Songstress legality, Dragon Roost for non-controllers, Gold-token activation engine bug). Added tools/coverage.ts (per-batch scripted / keyword-only / unscripted, script-text mismatches, untested ids; writes docs/coverage.md). DSL requests B8-1..B8-22 appended to docs/dsl-requests.md.

## 2026-11-25 (later) — ENGINE agent
- Reconciled with docs/rules-spec.md (CR 1.5) and lead decisions:
  - priority goes to the newest item's controller;
  - spell `play` triggers fire on resolution;
  - split damage is divided on resolution;
  - no FEPR between combat damage and the combat cleanup;
  - cleanup 8a, and showdowns before combats;
  - setup battlefield choice (default `choose`, hidden) and the first/second decision;
  - burn-out sequences, and the immediate win only from the 2nd point;
  - ban list (`data/banlist.json`, `enforceBanlist`), sideboard ≤ 10;
  - Deploy = "when an opponent holds here, kill this";
  - Vision instances, Empower/Disempower counts.
- New: `src/engine/bot.ts` (`chooseAction` heuristic bot, `randomAction`), `src/engine/testkit.ts`, `playCostOf`.
- getView: reveals the viewer's own decision objects and fills `GameObject.derived`. `GameSetup.manualPay`.
- Rune Add abilities as actions (950/951). `orderTriggers` decision kind for trigger ordering. Trigger batches.
- Served dsl-requests (see the ENGINE responses table there) and conformance-needs N1–N4.
- Tests: tests/rules/* (110 engine tests incl. a fuzz suite: 60+30 games per run; 900 games verified with FUZZ_GAMES=600) and
  tests/cards/dsl-examples.test.ts. docs/rules-decisions.md records all interpretations.
- [UI-POLISH] Playmat board + real card images.
  - Layout (src/ui/board.ts, styles.css): conventional 1v1 table — battlefields in the shared centre row (landscape battlefield card, opponent's units above it, yours below, grouped by controller, might totals per side, facedown card beside it, control/contested/showdown ribbons); each player's mat: Legend + Champion zone | Base | Main deck + Trash, and a rune row (player plate with score/XP, channelled runes stacked by domain, rune deck, banishment). The opponent's mat is the same mat turned 180° (rune row at the far edge, legend on their left). Cards are shown as card images at table sizes; exhausted cards are turned 90° (badges stay upright); attached gear is tucked under its unit; Might (top right, over the printed value; green/red when modified) and damage badges overlay the image. Hand: Hearthstone-style fan along the bottom (~60% visible, hover/focus raises a card fully); phones (≤600px) get a horizontally scrollable strip. 720px/390px: board scales via --mat-h/--rune-h/--bfc-h/--hand-cw. Light/dark mat colours via :root[data-theme]. Original Riftforge styling (own card back, colours); no RiftAtlas branding.
  - Fixes from real-mid-1280: chain-response/showdown/waiting/optional prompts now dock beside the end-turn button (side panel on desktop, a dock bar above the hand ≤980px) instead of covering the opponent's mat; big decisions (mulligan, payment, damage, card lists) float over the battlefield row only. The end button carries data-testid="pass"/"end-turn". Turn banner is smaller and lasts 850ms. Hand no longer cut off (fixed peek + raise). `.game`/`.g-main` use overflow: clip so focusing/hovering a hand card can't scroll the board.
  - Zoom (overlay.ts showPreview): hover / long-press / right-click shows the full-size image (300px; battlefields 440px landscape) plus a panel with name, cost/might, type line, the parsed rules text with icons, live state (damage, exhausted, current might) and keyword reminders. Phones show it centred.
  - Images (src/ui/art.ts): images/<printedCode>.webp beside the page. Per object: the printing its owner imported (deck printings, resolved to a printings.json key) -> canonical id -> another base printing -> text frame (on error, walking candidates; failures cached). dist/images-manifest.json (when present) says which codes exist, so no 404s. Board cards load eagerly with decoding=async; modal/gallery cards lazily; decoded images re-render without flashing. Printed codes are sanitised (^[a-z0-9][a-z0-9-]{0,47}$) before becoming paths.
  - Printings tracked end to end without engine changes: text imports now remember a code named on a line (e.g. "OGN-030a-298", "(OGN-030a)", TTS tokens) and deck-code imports store the full printed key (still round-trips through encodeDeckCode); SavedDeck.printings -> LocalSession({printings}) / Lobby.setDeck(..., printings) -> 'ready'.printings -> host -> 'start'.printings (validated with protocol.isPrintMap) -> GameSession.printings?() (optional). Host saves include them.
  - tools/bundle.ts: copies data/images/*.webp to dist/images/ (skips unchanged files), writes dist/images-manifest.json {format, dir, count, totalBytes, codes, files[{path, bytes}], batches[[path...]] with <=250 files and <=60 MiB each}. --dev-images copies placeholder art from data/images-dev/ (tools/fake-images.ts, clearly marked DEV PLACEHOLDER; removed again on the next normal bundle).
  - Tests: tests/ui/art.test.ts (candidate order, manifest filtering, path sanitising, alt-art printing shown in the browser, 404 -> text frame); tests/fixtures/ui-driver.ts board selector -> `.g-main :is(.table, .hand)`; tests/fixtures/serve.ts serves image/webp. Screenshots: tests/ui/mid.ts (bot game stopped mid-game on the human's decision, WIDTHS/THEME env) -> tests/ui/shots/mid-*.png.
- 2026-11-25 [B2 scripting agent] Scripted batch B2-equipment-gear-activated (124 cards: 91 with behaviour, 33 keyword-only Equipment registered with no abilities) in src/cards/scripts/batch-B2.ts, helpers in src/cards/helpers/B2.ts (enters-exhausted stand-in, per-object memo, variable Add abilities, "[A] or exhaust" cost, draw/death/battlefield-control trackers). Tests: tests/cards/B2/*.test.ts (163 passing + 4 todo: Shady Spectacles copied Might, Svellsongur copied statics, Gravity Field move legality, Gold direct activation engine crash). DSL/engine requests B2-1..B2-15 appended to docs/dsl-requests.md.
- 2026-11-25 [SCRIPT B4] Scripted all 132 B4-combat-board cards in src/cards/scripts/batch-B4.ts (helpers: src/cards/helpers/B4.ts — effect-move destinations, open / occupied-enemy battlefields, alone / one-on-one / won-combat tests, excess combat damage observer, per-turn move counter, move-batch detection, battlefield-ability controller + asPlayer choices, Mighty-from-own-static, Hidden 'here' override for Evelynn/Tideturner); 168 scenario tests in tests/cards/B4/*.test.ts (167 pass, 1 todo: Rengar, Trophy Hunter's Ambush timing); 15 DSL/engine requests in docs/dsl-requests.md (B4 #1, #3–#6 already landed).
- 2026-11-25 [SCRIPT B5] Scripted all 135 B5-removal-spells cards in src/cards/scripts/batch-B5.ts (helpers: src/cards/helpers/B5.ts — earlier-target-group filters via this play's `targeted` events, total-Might multi-pick groups, chain-item filters/costs, "chooses" sets, spell control, move destinations, act-as-another-player ctx). Delayed abilities: spell/ability damage prevention, Imperial Decree, Noxian Guillotine, Smite banish replacement, Siphoning Strike, no-spells lock, Decree of Rage uncounterable rule, reflexive "play this again for [A]", Stalking Wolf destination. Tests: tests/cards/B5/*.test.ts (199 scenario tests, every card + coverage check of ids/text, engine keywords Deflect/Ganking/Accelerate/Assault/Shield/Tank/Hidden/Ambush/Flow/Repeat/Show Off exercised). DSL requests B5-1..B5-15 appended to docs/dsl-requests.md.
- 2026-11-25 [RULINGS] Researched all 32 queued items (docs/rulings.md: 14 CONFIRMED, 12 FIXED, 5 NEEDS-ENGINE, 1 AMBIGUOUS). Fixes: B1 Grim Resolve (unit must be at the battlefield, CR 468.3.c), Heart of the Tempest (tokens aren't cards), Bard (destination + units chosen on the chain), Conscription (XP cost forced when declining leaves no legal target), Alpha Strike (recipients capped at Might, controller drops extras, ≥1 each), Gangplank (-[M] replacement via `chosen`); B3 Encore (real draw), Jayce, Brilliant Inventor (target on the chain); B6 Ekko, Recurrent (recycle = base cost), rune readying as targets (Battle Preparations, Sona, Gentle Gemdragon, Acceleration Gate), Pirate's Haven (triggers on Awaken), Convergent Mutation (second unit targeted), Piltovan Guidebot (sees its own play). Tests: tests/cards/B1/rulings.test.ts, tests/cards/B6/rulings.test.ts, tests/rules/rulings.test.ts + updated B1/B3/B6 tests. Engine requests R-1..R-9 in docs/dsl-requests.md "From RULINGS".
- [UI-POLISH] Image packs, bundled-scripts guard, online latency.
  - Images ship as one pack per set: dist/images/<set>.pack (ogn, ogs, rad, sfd, unl, ven; 0.5–7.1 MB each, a set over 30 MiB would split into <set>-2.pack). Format: "RFPK" + uint32 LE header length + UTF-8 JSON {v:1, set, type:'image/webp', codes:{printedCode:[offset,length]}} + concatenated webp bytes (offsets from the end of the header). dist/images-manifest.json = {format:'rfpack', v, count, totalBytes, dev, packs:[{path, set, bytes, count, codes}]}. Individual webp files are no longer copied (stale ones, old manifests and old packs are removed on every bundle).
  - src/ui/art.ts fetches packs by relative path, parses them (parsePack), and hands out blob: URLs per image (Blob.slice + URL.createObjectURL). The board warms the packs of the cards in the game first (visible cards + imported printings), then loads the rest via requestIdleCallback. Cards keep their text frame until their pack is ready, and permanently if it is missing or broken.
  - tools/bundle.ts keeps the coordinator's `import '../engine/index'` (card scripts bundled) and also re-exports `registry` from the generated engine-impl; the page publishes `__riftforgeInfo = {engine, scripts}` and the home footer shows the script count. tests/ui/art.test.ts asserts the bundled app registers >1000 card scripts, and checks every pack byte-for-byte against data/images.
  - Online latency (tests/ui/profile-online.ts, tests/ui/profile-engine.ts): host engine work per action is ~2.6 ms (applyAction 1.5 ms mean / 4 ms p95, getView×2 1.0 ms, pack+JSON 0.1 ms, view ≈36 KB). The slow lossy smoke test was the harness, not the engine: 21 guest steps were rune abilities (activate 950/951 "Exhaust/Recycle: Add") the board had no way to trigger, each burning the driver's advance timeout. Runes with a legal ability are now clickable (ability menu). Protocol: guest resend after 350 ms (was 1200), checked every 100 ms; the guest acks each new view with a tiny hb and the host repeats its latest view at 250/700/1500 ms until acked (previously a lost host view waited for the 2 s heartbeat); the host's sessionStorage save is deferred 30 ms (flushed on pagehide) so it isn't on the action path. 15% loss game: 260 s → 58 s wall, guest action round trip mean 793 → 232 ms (p90 2092 → 440 ms); with no loss the round trip is ~90 ms in the test (both pages share one renderer thread, so it includes both boards' ~25 ms renders).
- 2026-11-25 [RULINGS] Round 2 (63 items: 36 CONFIRMED, 16 FIXED, 7 NEEDS-ENGINE, 3 AMBIGUOUS, 1 NEEDS-DATA; + Deathgrip addendum) and Round 3 (chain/trigger timing: 1 NEEDS-ENGINE, 2 CONFIRMED) in docs/rulings.md, plus a timing-rule sweep table of all scripts. Fixes: B2 Zero Point Inflection, Titanic Shrine, Bottled Constellation, Detonation Amplifier, Dockside Lock-Up (base costs at finalization), Unlicensed Armory, Sumpworks Map (scoring ≠ points), Relentless Pursuit / Strike Down (Equipment targets); B4 Atakhan (kill after Energy/Power); B5 Sivir (assigned excess), Falling Star / Icathian Rain (2 / 6 instructions after the DATA fix), Deathgrip test (unplayable without another friendly unit); B6 Revna, B7 Jhin / Forgotten Library, B8 Virtuoso (actual Energy spent); B7 The Harrowing, Soulgorger, Spectral Matron, Glasc Mixologist, Remember the Fallen, Bedeviling Stranger (targets when played); B8 Firelights' Hideout (tokens count), Lady of Clockwork (cost + target on the chain). Tests: tests/rules/rulings-chain.test.ts (R-16 todo, APNAP, CR 403.4) + updated B2/B5/B6/B7/B8 tests. Engine requests R-10..R-16 in docs/dsl-requests.md.
- 2026-11-25 [CARD DATA] Audited data/cards.json against the official errata articles (Origins/Spiritforged/Unleashed/Vendetta/Radiance), the Riftcodex API (bulk name/type/Energy/Might/Power/domain/tag check of OGN/OGS/SFD/UNL/VEN) and the official card images (all RAD cards, all 43 Equipment, every flagged card). 141 cards corrected via new data/overrides.json (each entry has a source; applied by tools/build-cards.ts after the keyword pass): Falling Star / Icathian Rain repeated lines, LeBlanc, Deceiver errata, Rousing Display "disa", Illaoi token Might, Risen Altar has no Empower keyword, Disintegrate/Windsinger/Laurent Bladekeeper/Jagged Cutlass/Nazuman Ntofo keyword brackets, newest wording for Sett, Brawler / Lux, Crownguard / Viktor, Innovator, wrong Radiance domains (24 cards) and tags (~80; bogus "Device" tag removed). New CardDef fields: `additionalTypes` (Patched Porobot is a Unit and a Gear) and `attachedText`/`attachedReminderText` (the Equipment bottom band, missing from the scrape on 34 Equipment, e.g. The Zero Drive's "[Deathknell] — Banish me"). data/banlist.json rebuilt from the Rules Hub list of 2026-11-23 (standard + constructed2v2). Details, scripts and tests needing updates: docs/data-audit.md.
- [UI-POLISH] Image packs are now standard ZIPs for artifact assets (the host refuses .pack). tools/bundle.ts writes dist/images/<set>.zip: STORED (method 0) entries `<printedCode>.webp` with valid CRC-32s, sorted entries and a fixed 1980-01-01 timestamp, so identical images give byte-identical zips (opens with any zip tool; sha256 recorded). No .pack or loose webp files are written (stale ones removed). dist/images-manifest.json v2 = {format:'zip', v:2, count, totalBytes, dev, packs:[{path:'images/<set>.zip', url, set, bytes, sha256, count, codes}]}; `url` comes from data/asset-urls.json {"<set>": "/_blob/..."} when present (entries not starting with /_blob/ are ignored with a warning), else the relative path. src/ui/art.ts parseZip reads end-of-central-directory -> central directory -> local headers and slices the stored data into blob: URLs; the page fetches only URLs that start with "/_blob/" or match images/<set>.zip (safePackUrl), others are ignored. Without a manifest it tries images/<set>.zip. Text-frame fallback unchanged. Tests: zips checked entry-by-entry against data/images plus Python zipfile.testzip; a browser test serves the zips only at /_blob/ URLs from a rewritten manifest (and an off-origin URL is never requested); tests/fixtures/serve.ts serves .zip.

## 2026-11-25 — ENGINE agent, PHASE 2 (unification)
- Milestone A (looks/history/events): one look/reveal path (`lookDeck` → `ctx.lookTop/revealTop/revealUntil`), `ctx.drawCard`
  (draw a specific card), `ctx.history/movesThisTurn/batchOf/memo`, event batch ids (now part of the state, replay-safe),
  `combat.excess` + conquer `excess/prevController`, `ctx.as(player)`, `ctx.reflexive` (R-7), `ctx.activateTriggers`,
  `ctx.addLegend`, R-1 trigger modes chosen when placed (+ `modesOncePerTurn`), R-3 Awaken readies by the turn player,
  R-6 `pick` specs in triggers, R-8 `whenYouPlay({ self })`, whileSource expiry for modifiers/delayed abilities, multi-domain [C] mana.
- Milestone B (playing): `playProcess` rewritten around one cost pipeline — `canPlay` enumerates payable cost variants
  (either-discounts, optional discounted additional costs, target-dependent discounts, Deflect) instead of cheapest-then-undo;
  optional / either cost reductions are asked (B8-6/B8-10); `additionalCosts` gain `beforeTargets`, `discount`, `keepsDestination`;
  play-rule additional costs (optionally destination-bound: N6 Dragon Roost / B8-11 / B8-19); multiple Repeat costs and granted
  Repeat/keywords via play grants (consumed on finalize); R-5 required target groups that empty after `canPlay` roll back.
  Effect plays: `ctx.play(id, { cost: 'free'|'full'|'noEnergy'|{reduce}|{pay}, destinations, then: 'banish'|'recycle', noAdditional })`
  + `ctx.canPlayByEffect`; a failed effect-play leaves the card where it was. Chain items honour `leaveTo` on resolution/counter.
- Standard-move applied costs: `rule('moveCost', applies, …, { cost })` — legality checks affordability, the mover may decline
  (cancels the move). Gravity Field (B2-2) and Mageseeker Investigator (B1-8) migrated; todo tests enabled.
- Hide costs: `hideCosts()` = [A] + play-rule `hideCost` alternatives, all with `costMod({ scope: 'hide' })` (B8-8, B7-7).
  Swift Scout migrated; Guerilla Warfare's delayed hide discount now works; todo tests enabled.
- R-4: `ctx.split` lets the controller choose which targets stay when there is less damage than targets.
- R-16 (HIGH): triggers are ordered when met, the cleanup runs, then pending items are finalized oldest first (targets, "you may",
  costs see the cleaned-up board; cleanup-time triggers still end up on top; the state is closed while items are pending, so the
  cleanup can't start a showdown/combat). tests/rules/rulings-chain.test.ts R-16 un-todo'd; Arcane Shift test updated.
- Determinism: chain item ids no longer use a module counter (replays reproduced different ids).

## 2026-11-25 — SCRIPT-FIX agent
- Equipment bands (data `attachedText`, 34 cards): implemented as `section: 'effect'` abilities in batch-B2.ts `BAND` (keywords, triggers,
  statics, Guardian Angel replacement, Jagged Cutlass `cantMove`, Skyfall of Areion hold⇄conquer via `alsoTriggerAs`, The Zero Drive
  "[Deathknell] — Banish me" linked to the Zero Drive, Brutalizer, Blighted Battleaxe, Rabadon's, Shurelya's, ...). Tests: tests/cards/B2/bands.test.ts.
- Patched Porobot (Unit + additionalTypes Gear): own "3 or more other gear" check and Ornn's gear count read `additionalTypes`
  (helpers B7 `isGearAny`/`gearControlled`, B2 `friendlyGearCount`); engine part filed as SF-1 (todo test).
- Text strings synced with the corrected data: LeBlanc/Deceiver, Disintegrate, Rousing Display, Illaoi, Viktor, Sett, Lux, Nazuman Ntofo,
  Jagged Cutlass, Windsinger; the 9 multi-domain [C]→[A] cards from the latest DATA rebuild (Spinning Axe, Forgefire Cape, Rabadon's,
  Shurelya's, Danger Zone, Daughter of the Void, Swift Scout, Bullet Time and The Boss now pay/add [A]). Radiance-domain test fixes.
- Rulings timing sweep: base costs paid as the trigger goes on the chain (Ziggs, Rumble, Emperor's Dais, Wildclaw Shaman, Dusk Rose Lab,
  Monastery of Hirana, Shadow Order Disciple, Gust Monk, Profiteer; Deceiver already did); objects chosen on play / on the chain (Pack of
  Wonders, Azir, Cursed Sarcophagus, Forge of the Future, Edge of Night, Fortified Position, Navori Fighting Pit, Durand Memorial,
  Hexplosive Minefield, Chronobreak, Heedless Resurrection, Shuriken Flip, Profiteer). Tests: tests/cards/timing-sweep.test.ts + batch tests.
- tests/puzzles/elder-soraka.scenario.ts → asserted tests/puzzles/elder-soraka.test.ts (scenario deleted).
- Filed SF-1..SF-5 in docs/dsl-requests.md. Fixed a syntax break in batch-B5.ts (Volibear, comment swallowed the closing paren).
- 2026-11-26 [CARD DATA follow-up] Read the card images of every non-Radiance gear (66), legend (49) and battlefield (66), plus 59 short-text units/spells, and compared them with data. Fixed [C] → [A] (the printed rainbow "any power" icon) on all 9 multi-domain cards that used [C] (Daughter of the Void, Swift Scout, Bullet Time, The Boss, Danger Zone, Spinning Axe, Forgefire Cape, Rabadon's Deathcrown, Shurelya's Requiem); data/overrides.json now covers 147 cards. Wraith of Echoes / Symbol of the Solari / Unyielding Spirit "text updates" from riftboundfaq.com are unsourced and only FAQ rulings officially, so their text is unchanged; the required behaviour is listed in docs/data-audit.md. "Surprise Defense" is a rules scenario, not a card. "Violent Impulses" is an unofficial translation (likely Blind Fury). "Jayce, Defender of Tomorrow" is legend ven-149-166. See "Follow-up audit" in docs/data-audit.md.
- Milestone C (rulings / Rift Judge engine fixes):
  - R-10 Weaponmaster: the Equipment is an optional choice made as the trigger goes on the chain; its cost is the shared
    `equipCostFor()` (Equip cost + 'equip' cost modifiers as if Equip chose the unit) minus one [A] only if it has [A] (CR 821.1.c).
  - R-11 `trackMighty` (every cleanup pass): "becomes Mighty" for any Might change (statics, expiring minuses, "here" bonuses);
    units entering with 5+ don't become Mighty (CR 711).
  - R-13 "can't be played" (cantPlay rules, playIf) also blocks plays by effects; Ol' Poro migrated to `rule('cantPlay')`.
  - R-14 later target groups see earlier ones in triggers, at resolution re-validation and when choices are remade; one shared
    `rechooseTargets` for Repeat and copies/control changes. R-15: optional triggers with no legal first target don't ask.
  - Elder Dragon: `damageSrc[unit].by` tallies damage per dealing player this turn; `anyDamageLethal` checks every dealer.
  - CR 383.2.a.1: trigger conditions (`if`) are checked only when the event happens (no re-check on resolution);
    new DSL `ifOnResolve` for conditions printed in the effect (Loose Cannon). Audit of all triggered `if` uses: only Loose
    Cannon and The Grand Plaza needed changes.
  - CR 383.2.c.2: a source leaving its zone in the same event only sees its own leaving (Viktor, Leader; Wraith of Echoes).
  - CR 466.2.d.1: combat role events form one batch ordered attacker first, defender last; same-controller unit + battlefield
    triggers are ordered together; "when you attack/defend here" needs the battlefield's controller (CR 190.6.d).
  - CR 816 Temporary is a builtin triggered ability on the chain at the start of the Beginning Phase (respondable).
  - CR 405.2: a trigger's Deflect cost may be declined (trigger removed). CR 811.1.b hide from the Champion Zone;
    CR 811.1.d hidden "here" target restriction re-checked on resolution (`legalTarget`).
  - "When you play a spell" fires for the spell's controller at resolution (Rebuttal takeovers); token returns count as returns.
  - isGear/isUnit/F.gear read `CardDef.additionalTypes` (Patched Porobot); getView `derived.mightSources`; createGame uses
    data/banlist.json (src/engine/banlist.ts, standard / constructed2v2) when `enforceBanlist` is set without a `banlist`.
  - ~45 Rift Judge todo tests now pass and were un-todo'd; conformance T172/T175/T180/T204 and 12 card todo tests enabled.
- [UI-POLISH] Playtest fixes.
  - Multi-unit moves: click units to toggle them (blue ring + ✓), or "Select all N" on a location (base / your side of a battlefield) with 2+ movable units; a move bar explains the next step; click a glowing destination or drag any selected unit — one `move` action with every selected unit (dragging an unselected unit while others are selected adds it if they share a destination). Help text says to select everything before moving into a showdown.
  - Contextual prompts: the chain is a card stack in the middle of the board (top item enlarged, "Resolves next"), with the response controls attached; the chain left the side panel. Pass buttons say what happens: "Pass — let <top item> resolve" whenever the chain is non-empty, "Pass focus" only in a showdown with an empty chain, else "Pass". The stack explains that a spell waits until both players pass in a row (yours: "Your Stacked Deck is on the chain. It resolves once both players pass in a row."). The showdown focus prompt is anchored at the showdown battlefield's inner edge with a pointer (bottom of the battlefield on narrow screens).
  - One-click abilities: a card or rune with exactly one legal ability performs it on click; a menu only when there are several. Runes: click = exhaust for 1 Energy, right-click / long-press / hover ↺ button = recycle for Power.
  - Sizes: desktop top bar moved into the side column (board uses the full height); board font 15px, buttons ≥44px (end button 58px), bigger mats (15.5vh), battlefield cards, units, badges, counts, chain/prompt text; checked at 1280×800, 1440×900, 1920×1080, 720, 390.
  - Hand: hovering scales the card in place (~2×, origin shifted for edge cards so it stays on screen); no zoom panel for hand cards with a mouse (long-press on touch still zooms).
  - Battlefield control: no text over the art. Control = colour + position: blue band on your side / red band on their side / grey outline uncontrolled / blue-red stripes contested; ◎/⚔ badge for showdown/combat; legend in Help and in the zoom.
  - Runes sit on the base row (to its side), one stacked row per domain with ready/total counts, bigger; rune deck / banishment counts and the rune pool moved to a strip along each mat's edge with name, score track and XP.
  - Might breakdown in the zoom (beside the card): "Might 5 (printed 3)" then each source — uses getView's `derived.mightSources` (source card name + label + duration; the base value is the header), else modifiers / buff counters / Assault / Shield / equipment remainder.
  - Legend and Champion slots keep their size when empty (dashed outline), so nothing shifts when the champion is played.
  - Images: art.ts tries the manifest's /_blob/ asset URL, then the relative images/<set>.zip (tests/dev). tests/fixtures/serve.ts maps /_blob/<id> to the zip via data/asset-urls.json.
  - Tests: tests/ui/interactions.test.ts (multi-unit move through clicks, chain stack + pass label, showdown prompt location + label, one-click rune exhaust + right-click recycle, in-place hand zoom on screen without zoom panel, no battlefield labels + fixed champion slot + runes beside base + minimum sizes, Might breakdown beside the card); ui-driver activates single abilities with one click and recycles with right-click. Screenshots: tests/ui/scenes.ts (move, chain, showdown, hand, might) and tests/ui/mid.ts.

## 2026-11-26 — SCRIPT-FIX agent (Rift Judge findings round)
- Fixed the SCRIPT findings in docs/riftjudge/FINDINGS.md (and script-side ENGINE ones), each RJ test un-todo'd:
  Wraith of Echoes (own / simultaneous deaths, RJ#3911/#2674), Unyielding Spirit vs fights (unit-sourced, RJ#2602), Svellsongur copies
  activated abilities (RJ#1325), Noxian Drummer / Corina Veraza / Eye of the Herald "here" = current location (RJ#7840/#6592),
  Reckoner's Arena activates Equipment bands + Skyfall hold effects (RJ#1341), Mel's extra -1 via giveMight replacement (RJ#11737/40/41;
  B1 todo enabled), Hwei per-type branches incl. additionalTypes (RJ#11749), Spirit's Refuge doesn't stack (RJ#3971), Dragon's Rage,
  Deceiver and Disintegrate "do this" as reflexive items (RJ#3961/#10484/#8002), Startipped Peak optional at finalization (RJ#1451),
  Immortal Phoenix sees kills performed for "each player kills" (RJ#4019), "When you defend here" needs the defender to control the
  battlefield (RJ#7862), Ravenborn Tome bonus only for its controller's spell (RJ#1393), Bellows Breath split-location choice (RJ#9125),
  Shady Spectacles re-attach = new instance (RJ#11747), Scuttle Crab seeFacedown delayed rule (RJ#10488).
- Symbol of the Solari: tie recall limited to that battlefield made explicit + test. Wraith of Echoes card tests.
- tests/conformance/harness.ts: `realCard` resolves legends by "<champion>, <title>"; `S0` adds real token defs (as createGame does).
- RJ test setup fixes (noted in the range logs): RJ#2606, RJ#11737/40, RJ#11749, RJ#7862. Filed SF-6 (Heisho / ignoreDeflect).
- Later the same day: Rek'Sai, Breacher (Accelerate for non-hand plays, RJ#6734/#10570), Battle Mistress optional+cost at finalization
  (RJ#8067), Kraken Hunter's extra buffs reduce the Accelerate [C] (RJ#5340), tokens from cards played from facedown go to that
  battlefield (helpers/B3, RJ#1553), Mageseeker Warden blocks opponents' unit tokens at battlefields (RJ#3977), Dark Child readies any
  player's runes as chain-time targets (RJ#239), Prodigal Explorer counts each chosen enemy (RJ#2744 DECIDED). Reverted to the lead's
  DECIDED rulings: Ravenborn Tome keeps its bonus after a steal (RJ#1393), Immortal Phoenix needs a spell you control (RJ#4019).
  More RJ setup fixes: RJ#5340, RJ#9228, RJ#152.

## 2026-11-26 — FUZZ agent (interaction fuzzer)
- tools/fuzz-lib.ts + tools/fuzz.ts (CLI: `--games N --seed S --workers K --minutes M [--dense R] [--heavy]`, `--report`, `--recheck`,
  `--triage`), tools/fuzz-snapshot.sh (fuzzes a frozen copy of src/ so concurrent edits don't show up as failures). Random legal
  whole-pool decks (engine validateDeck; dense decks weighted by data/card-analysis.json patterns), random / chaos (answers from the
  full decision space incl. manual payment plans and damage assignments) / heuristic-bot policies, invariants after every action,
  ddmin minimisation of action log and decks, repros in tests/fuzz-repros/<hash>.json, report docs/fuzz-report.md.
- ~2760 games (≈410k actions) fuzzed. Script fixes: Starry-Eyed Songstress / askOnItem (Suspend escaping getLegalActions,
  queries mutating state, impossible discount assumed for targeted spells) and Lady of Clockwork (detach before becoming a unit) in
  batch-B8; Blood Rose infinite recursion (batch-B1); Zhonya's Hourglass self-replacement stack overflow (batch-B4); Forgotten
  Signpost target that made its cost unpayable (batch-B2).
- Engine bugs filed in docs/dsl-requests.md "From FUZZ" (F-1 … F-6).
- Tests: tests/fuzz/smoke.test.ts (40 fixed-seed whole-pool games), tests/fuzz/regressions.test.ts (fixed repros must pass; filed
  engine repros run as todo).
- 2026-11-26 [META-SIM] Meta decks + search AI + round-robin harness. data/meta-decks/<placing>-<legend>.json: the top 20 published
  lists of "Demacia League Bologna - [Post-Ban Meta]" (riftdecks.com, 406 players, 2026-11-22; placings 1-18, 20, 23 - 19/21/22 have
  no published list), scraped from the deck pages' printed card codes through a browser (riftdecks blocks the fetch tools; every list
  checksummed against the page), mapped via data/printings.json and validated with validateDeck (tournament, standard ban list):
  all 20 legal, no unmapped cards; table + lists in docs/meta-decks.md (tools/meta-decks.ts rebuilds from data/meta-decks/_raw.txt).
  src/ai/ (new): SearchAI = per-decision search (determinized for hidden info: opponents' hands/decks/facedown cards re-dealt from
  their unseen cards, own deck and rune decks reshuffled, RNG reseeded), candidates per decision kind (balanced plays/moves/
  activations, kill-maximising damage assignments, hint-pruned targets, response windows), each applied and settled to the next
  main-phase decision with the baseline bot, then scored by src/ai/eval.ts (points with urgency, a two half-turn hold/conquer
  projection, unit Might/cost/keywords, gear, cards, runes, champion, lethal-in-projection); node budgets (deterministic per seed).
  tools/sim-lib.ts (game runner: random battlefields, seat 0 first, turn/action caps, invariant checks every 25 actions, rollback
  guard, void + repro on any engine failure, per-thread CPU timing, worker_threads pool), tools/ai-bench.ts (AI vs bot with seat
  swaps + Wilson CI), tools/meta-sim.ts (round robin, N games/pair, both seat orders per seed, --resume, writes
  data/meta-sim/<tag>.json + docs/meta-sim.md: overall winrates with CIs, by legend, matchup matrix, length, first-player advantage,
  void list with repros in data/meta-sim/repros/), tools/meta-sim-snapshot.sh (runs any of them on a frozen copy of the sources).
  Empty legal-action lists are recovered by a validated brute-force answer ("enumeration gaps"), else the game is voided.
  Strength: search AI vs baseline bot 166-74 over 240 games (random meta pairs, every pair with both seat orders) = 69.2%
  (95% CI 63.1-74.7). Pilot (4 decks x 20 games/pair, AI vs AI) in data/meta-sim/pilot.json + docs/meta-sim.md; 20-deck timing
  sample data/meta-sim/timing.json (2.9 s CPU per AI-vs-AI game). Engine findings MS-1..MS-5 in docs/dsl-requests.md.
  Tests: tests/ai/search-ai.test.ts.
- Milestone D (migration + FUZZ):
  - Stand-ins migrated and deleted: 5 `asPlayer`/`asP` (42 call sites -> `ctx.as`), B7 `drawSpecific`, `nocturneHook`,
    `hatchlingBeforeReveal` (Nocturne = `lookedAt` trigger + reflexive play for [A], RJ#3918; Void Hatchling = `revealDeck`
    replacement), B2 `memoSet/memoGet`, B6 `MULTI_BUFF`/`buff`, B6 `spendBuffToIgnoreCost`, B1 `optionalCostDiscount`/`addPlayExtra`,
    B3/B4 excess-damage recorders (+ Piltover Enforcer listener), Hungry Wolf tracker (`history('choseEnemyUnit')`).
    Scripts moved to engine primitives: Gravity Field, Mageseeker Investigator, Swift Scout, Rengar, Dragon Roost, Starry-Eyed
    Songstress, Syndra, Baron Nashor, Ol' Poro, Lee Sin, Reaver's Row, Charm, Siren's Song, Blast Cone, Void Assault, Atakhan,
    Commander Ledros, Loose Cannon, The Grand Plaza, Rhasa. Helper lines 1735 -> 1552.
  - R-2 engine primitive `T.destination` (+ `F.moveDestFor`, `ctx.destination`, `ctx.canMoveTo`, `E.moveToChosen`), asked as
    `chooseDestination`; `chooseGroup` shared by plays, triggers and remade choices.
  - FUZZ F-1 (validate('activate') = enumerated set, controller check in canActivate), F-2 (no module counters), F-3a joint
    target feasibility in legality and per pick, F-3b Deflect-aware affordability, F-3c required optional costs not offered
    (+ `ctx.playAffordableWith` for asPlay choices), F-3d bots skip undone actions (`ex.memo.__rolledBack`), F-4 bot answers
    validated, F-5 ids assigned after the shuffle + view.cards limited to known cards + hashed hidden deck order, F-6 units are
    detached in the cleanup. 5 filed repros flipped to fixed; one new repro triaged wontfix (Scuttle Crab seeFacedown).
  - Combat role designations are per object epoch and role (RJ#149 re-entered units, RJ#6727 stolen attackers).
  - tests/rules/interactions.test.ts (10 cross-batch tests), docs/unification-plan.md, dsl-guide §12.
- 2026-11-26 [SCRIPT-FIX-2] Reflexive "do this" items (CR 387-389; VEN-FAQ Hwei; rules-spec §8.3): every remaining card whose text has "(Then) do this:" / "Do one of the following" now puts that part on the chain as its own `ctx.reflexive` item (choices — targets, "you may", leading costs — made as it goes on the chain; opponents get a response window): Guards!, Arise!, Keeper of Masks, Mirror Image (copies of a unit that left meanwhile use its last known card) (B3); Ivern, Twisted Fate (per-domain branch), Bone Skewer, Kharox, Wild Claw, Forgotten Relic (B7); Death from Below (B5, replaces the delayed spellResolved trigger); Alpha Strike (one item per kill, B1); Rell (B2); Hwei (one item per type branch, Gear branch's runes as targets, B6). R-1 timing sweep: trigger modes chosen as the trigger goes on the chain (`modes`/`modesOncePerTurn`) for Reckless Innovator (both modes offered, [C] paid on resolution), Riven, Broken Blade (all unchosen modes offered; spend-buff paid on resolution), Jayce, Hammer in Hand, The Ball, Aphelios, Exalted (runes / unit as targets), Minah Swiftfoot. R-2 sweep: no resolution-time move destinations remain (all remaining ones were migrated by ENGINE-2). Tests: tests/cards/reflexive.test.ts (14 window tests) + updated B2/B3/B4/B6/B7/meta-audit tests. Filed SF2-1, SF2-2 in docs/dsl-requests.md.

## 2026-11-26 — META-AUDIT agent
- [META-AUDIT] Audited every card of the 20 Bologna meta lists (159 distinct; data/meta-decks) against its text, Azir lists first. All 158 scripts match the card text; every card has a test (Inferna, keyword-only, got one). New tests: tests/cards/meta-audit/azir.test.ts (18 real-card scenarios of the Azir plan: legend + Weaponmaster, Guards!/Arise!, Azir's attack, Equipment bands, Fluft/Hall/Seat/War Camp, every spell), ms5-switcheroo.test.ts, meta-cards.test.ts. Fixes: MS-5 engine (sameLocation feasibility in `targets.ts candidatesFor`, per-location enumeration in `legal.ts inStepActions`); Azir, Sovereign token-move hint `help` (bots moved no tokens). src/ai: Weaponmaster never moves attached Equipment, optional in-step choices keep "none", Equipment/rune-deck eval terms. tools/meta-sim.ts keeps a hand-written "## AI notes" section in docs/meta-sim.md. Filed MA-1..MA-6 (docs/dsl-requests.md "From META-AUDIT", incl. the Weaponmaster-vs-Equip-[C] ruling to re-check). Azir pilot before/after in docs/meta-sim.md AI notes.

## 2026-11-26 — ENGINE-2 agent (milestone 1: performance, R-2 remainder, Rift Judge engine items)
- MS-2 performance (`applyAction` mean on bot-vs-bot meta games, 15 replays / 2366 actions incl. 9 Azir games: 3.4 ms -> 1.4 ms,
  max 24 -> 12 ms): `chars.attachedTo` uses a per-state reverse index (keyed by timestamp/attachCount/nextObj); `allAbilities`
  computes only the ability-granting statics (`grantsOf`) instead of full characteristics; `collectStatics` reads each script's
  static list once (`scriptStatics`); read-only scans are memoised with `withCharsMemo` (trigger matching `scanTriggers`, rule
  checks `ruleApplies`/`ruleSum`, the cleanup's lethal scan, `trackMighty`); `withCharsMemo` nests (reuses an outer scope of the
  same state). MS-1 / MS-3 / MS-5 no longer reproduce (already fixed by F-3a/F-4/META-AUDIT; checked with targeted probes).
- R-2 (CR 355.4) completed: every "move X" spell/ability chooses its destination as it is played/activated/put on the chain —
  Ride the Wind, ogn-270 (buff then move to a battlefield), Skyward Strike, Relentless Pursuit, rad-096, Cataclysm, Demon Shade,
  Temptation, Tricksy Tentacles (single location chosen in its asPlay), Call to Battle, Imposing Challenger, Shadow Dash,
  Dragon's Rage, Shuriken Flip, Command: Attack, Twilight Step, Unforgiven, Maduli. Resolution-time helpers deleted (B1/B5
  `moveDestinations`, B4 `chooseDest`/`moveChosen`, B5 `moveChosen`, B6 `moveAnywhere`). New `ctx.validMoveDest` (CR 355.4 /
  449.2 / 451.2: another location, entry limits) used by `F.moveDestFor`; "can't move" rules negate the move but don't make the
  destination invalid (VEN-FAQ #33 Vilemaw's Lair, RJ#181/#279). `F.dest(pred)` destination filter.
- RJ#1317/#1560: staged showdowns begin in the Ending Phase (Neutral Open, CR 323.11) before Expiration; an open showdown runs
  before the remaining turn tasks (game.ts advance, play.ts currentWindow).
- RJ#9237/#2734/#9301 (CR 356): the play cost is base + all additional costs (Deflect, script/rule additional costs, Accelerate,
  Repeat) with increases then discounts applied to that total (`playProcess` total(), `costVariants`/`affordablePlay` take the
  additional part, target-choice affordability includes Deflect before discounts); "to a minimum of N" never raises a cost and
  applies to the total. Effect plays with a cost mode pay through the engine (B7 `playIt` -> `ctx.play({ cost })`), so
  "reducing its cost by [2]" also covers Repeat.
- RJ#117/#6683/#9227/#2869 (CR 354.4/158.3): a permanent played while a spell/ability resolves waits (on the chain) until that
  resolution has finished (after a spell's play completed), then enters and its play event fires (`beginResolving`/
  `endResolving`); `ctx.playedObj(id)` gives the object it becomes, for "if you do … it" reflexive items (Bone Skewer, Wild Claw,
  Rell). Viktor, Innovator sees himself played (RJ#231 decision).
- RJ#2736/#7983 (CR 468.1.a): the combat cleanup kills lethal units once (`killLethal`), then heals all units, then recalls.
- RJ#1374/#8072/#10615/#5370 (CR 373): when replacements could apply to several simultaneous deaths of one player's units, that
  player chooses which death is handled first (`kill`, decision `chooseOrder`); replacement-order options are labelled with their
  source.
- RJ#1592 (CR 383.3.d.1): pending triggers are placed by player in turn order from the turn player, a player's batches stay
  chronological (T209), and combat-designation batches (466.2.d.1) form their own segment after earlier triggers (RJ#11703).
- RJ#10525 (CR 422.4): facedown cards are revealed in every view once the game is over (fuzz view checker updated).
- Tests: un-todo'd RJ#1317, #1560 (setup: Miss Fortune), #1516, #6669, #2809, #2734, #2736, #7983, #10525, #1592, #1374, #8072,
  #5370b, #117, #6683, #9227, #2869, #10615, #9301; card/RJ tests updated for destinations chosen at play and the one-payment
  effect plays (RJ#2822). Fuzz: 200 games on a snapshot, no new signatures.

## 2026-11-26 — ENGINE-2 agent (milestone 2: Repeat choices, Heisho, Svellsongur, tokens, gaps)
- RJ#92a/#193 (CR 820.2): a Repeat execution's choices (targets, destinations; same mode) are made as the spell is played, right
  after its Repeat cost is chosen, with Deflect added per choice; stored in `choices.repeatTargets:<k>` and re-validated on
  resolution (resolution-time re-choice kept only for items without stored choices). docs/keywords.md Repeat updated. Card/RJ
  tests updated (Square Up, Temptation, RJ#9, #88, #4047, #9197, #9223, #9252, #9341).
- SF-6 / RJ#11769, #11783: `ignoreDeflect` rules get every object chosen by the spell/ability; Heisho waives the whole tax.
- B2-10: Svellsongur also copies the equipped unit's statics (`StaticAbility.refs`: statics named by grantRefs are applied by
  `collectStatics`, one level), rule hooks, replacement effects and cost modifications; `StaticAbility.idempotent` for "gives
  double" texts (Gearhead, RJ#79). RJ#128b (two "while Mighty, Shield" instances stack) now passes.
- RJ#9271 (Rek'Sai, Breacher): unit tokens that are played may pay Accelerate ([1][C]) when they have it, printed or granted by
  play rules.
- N4: T173 (real Charm; destination at play) and T174 pass; N7: Temporal Breach on a unit in another player's base leaves it
  banished (T187). T182 (Dragon Roost vs Perched Grimwyrm) stays todo: no lead decision, and the test setup lacks a conquest.

## 2026-11-26 — ENGINE-3 agent (Rift Judge engine items, Hidden per CR 811.1.d, doc reconciliation)
- Hidden (CR 811.1.d.2-.4, DECISIONS #2696/#11828, principle 12; reverses rules-decisions #29/#34): a permanent's play effect
  played from facedown chooses at the battlefield it was played to, read from its source (`data.hiddenSrc`/`hiddenAt`, targets.ts
  `hiddenLoc`) — source gone → no legal choice / mistarget; `TargetSpec.anyLocation` (T opts) for groups whose text makes "here"
  impossible (Resonating Strike's unit, Smoke and Mirrors' second unit, Tideturner). RJ#2696, #11865, #10647, #11828 un-todo'd;
  Elnuk Herd card test now targets a unit at its battlefield.
- RJ#8175 (CR 340 step 1): permanents played by a resolution (CR 354.4) wait in an enter queue until the triggers met before them are
  placed (play.ts `endResolving`/`enterWaitingPlays`, chain.ts `finalizeTriggers`; the state stays Closed meanwhile).
- RJ#6775b / principle 11: a leading "you may choose/move X" (up-to first group) declined by choosing nothing removes the trigger
  (chain.ts `leadingMay`, `TriggeredAbility.mayChoose`; once-per-turn use refunded). RJ#2678 test now uses Reaver's Row.
- RJ#6584 / principle 7: each Repeat execution starts a new event batch (`events.ts newBatch`); Radiant Dawn uses `oncePerBatch`.
- RJ#39 / principle 8 (CR 478.4): Fiora, Victorious's own "while Mighty" keywords never keep her Mighty (helpers/B4
  `mightyFromOwnStatic` no longer double-counts other statics).
- RJ#326b: each instance of a triggered ability keeps its own "chosen this turn" list (`QueuedTrigger.inst`; extra triggers from
  Svellsongur are separate instances).
- RJ#358 (CR 317.2.f): the Expiration step runs `trackMighty` before its FEPR loop-back, so "becomes Mighty" triggers repeat the step.
- RJ#8247 (house): choices made while an item resolves can't select that item (Mystic Reversal remaking Wind Wall's target).
- RJ#11842 (CR 178.3): the `gear` target kind includes printed Gear Units (Patched Porobot).
- SF-2: `abilitySource` carried on queued triggers / chain items and set in finalization, resolution, statics, replacements and rule
  hooks. SF-3: `ctx.banish(ids, { linkTo })` (The Zero Drive). SF-5: trigger base costs are paid with the item's data (Rumble).
  SF2-1: `TriggeredAbility.offerIf` (Guards!, Death from Below). SF2-2: reflexive items join the latest event batch, so their
  controller orders them with that batch's triggers (azir audit tests answer the order).
- Costs (CR 203.2): `pay.killFriendly` counts as paid when the kill is replaced (RJ#10651 Sacrifice + The Boss, #374, #1747);
  `{ includeSelf }` option (RJ#6900 Malzahar can kill himself; mana card tests updated). Rumble's token recycle counts (RJ#3009).
- Scripts: Mystic Vortex sees Ambush's Reaction via new `ctx.playTiming` (RJ#11862); Blitzcrank pulls to his current location
  (RJ#8283); Veiled Temple's gear is a finalization-time target (RJ#9387); Rockfall Path blocks played unit tokens via new rule
  `cantPlayToken` (RJ#10713); Volibear, Imposing needs to be at a battlefield (RJ#8279b); Prize of Progress counts a gear killed as
  its own cost (RJ#11964; Add-ability `activated` events carry cardId/cardType); Divine Judgment chooses among every player's
  units/gear/runes (RJ#4173 house); Irelia, Graceful sees Repeat choices — choice-dependent cost mods are re-evaluated after the
  Repeat executions' choices (RJ#5435b); Hall of Legends / Sunken Temple pay at finalization (MA-6); Forgotten Signpost's exhaust
  cost excludes itself (FUZZ e917bb53e0, fixed). Effect channels are logged.
- Bot (MA-4a): Weaponmaster attaches an unattached Equipment, else none.
- Tests un-todo'd: RJ#53 (engine already ordered; answers fixed), #39, #326b, #358, #2696, #3009, #4173, #5435b, #5540b (test
  setup), #6584, #6775b, #6900, #8175, #8247, #8279b, #8283, #9387, #10647, #10651, #10713, #11828, #11842, #11862, #11865, #11964,
  #1747, #1760 (destination auto-chosen at play). Already passing: #239, #8067.
- Docs: rules-decisions.md "Source of truth" note + #29/#34 rewritten + #51-#54; rulings.md Mighty reason (principle 9) and
  B8 Radiant Dawn/Prodigal Explorer row (principles 6-7); keywords.md Hidden + Repeat; dsl-guide.md new options; dsl-requests.md
  SF-2/SF-3/SF-5/SF2-1/SF2-2/MA-* statuses; FINDINGS lines marked FIXED.
- Suite green (3928 pass, 7 todo: 2v2 RJ#6609, RJ#5474, new RJ#11989, conformance todoReal). Fuzz: 2 × 250 games on snapshots,
  one new script repro (fixed), no engine signatures.

## 2026-11-26 — ENGINE-4 agent (standing fixer: Rift Judge findings)
- Batch 1:
  - RJ#5474 (CR 715.3): Bonus Damage raises the split pool. `ReplacementAbility.bonus` (set by dsl `bonusDamage`, Void Gate,
    Ravenborn Tome) + replace.ts `bonusDamageFor`; `ctx.split` adds the bonus common to all recipients to the pool (a
    recipient-only remainder — Void Gate for some recipients — goes to that recipient's part), new `ctx.dealSplit` /
    `dealEach(..., { noBonus })` deal the parts without re-applying bonus replacements; split target max = amount + bonus
    (play.ts). Volibear, Furious / Scorched Earth / Alpha Strike use it (rules-decisions #55).
  - RJ#8373 (CR 418.6.b.3): `ctx.fight` marks its damage events `unitDealt`; Void Gate, Annie, Rabadon's Deathcrown skip them
    (Annie also skips combat damage); helpers/B5 `unitSourcedDamage` reads the event too.
  - RJ#11989: Astral Heron counts its own play. RJ#11999: helpers/B7 `canAffordPlay(…, 'full')` uses the real effect-play cost
    (`ctx.canPlayByEffect`); Shadowblade Lurker no longer counts itself (as Rhasa, RJ#11711).
  - RJ#2839/#8377 (DECISIONS revised, principle 17): Stealthy Pursuer follows the friend's location on resolution; nothing if gone.
  - RJ#10771/#12050 (principle 4): Fizz / Kai'Sa (ogn-112) choose their trash spell as the trigger is chained. Tests that
    answered the old resolution-time prompt updated (RJ#10401, #92c, #5447, B7 Kai'Sa card test).
  - Type-only test fixes (tsc): r10401 (m0!), r7801 (readyRunes is a number — now a real assertion, passes), r6501, r9101.
  - Suite green (4171 pass, 10 todo).
- Batch 2:
  - RJ#6949 (rules-spec 467.2.c.10, dsl-requests R-12): `ReplacementAbility.noDamage` + replace.ts `takesNoDamage`; a unit that
    takes no damage is exempt from the lethal-first/Tank assignment ordering. Kayn uses the engine move counter;
    `GameObject.movesThisTurn` now resets at turn start and on a zone change (it never reset before).
  - RJ#9448 (CR 355.16, 809): trigger finalization (chain.ts) doesn't offer an enemy Deflect target whose cost (with the base
    cost) can't be paid; Amateur Recital's unit is a trigger target.
  - RJ#10797: Reckoner's Arena activates keyword conquer effects too (Hunt; builtin.ts `keywordConquerTriggers`).
  - RJ#9537: Skyfall of Areion's activated triggers get `extraTriggers` (Red Brambleback) and carry `fromType`.
  - RJ#12065: Bottled Constellation (B2 friendlyPermanents) counts a Gear Unit once.
  - New tests/rules/bonus-split.test.ts (Annie + Volibear 6 recipients, Scorched Earth pool, Alpha Strike at Void Gate + elsewhere,
    Challenge at Void Gate). Suite green (4249 pass, 6 todo: 2v2 RJ#6609 + 5 conformance todoReal).
- Batch 3:
  - Split recipients for triggers (chain.ts finalization): capped at the split amount + Bonus Damage (CR 355.14.c, 715.3) as for
    spells — Volibear's group is `split: 5` with `max: 99`. New test (no bonus → at most 5).
  - Fuzz (seed 696140, 200 games): 0 engine signatures; one soft `bot-loop` (4cd09eb45b, seed 696329) was a fuzzer false positive —
    a chaos-policy random manual payment rolled back Factory Recall after its target answer, which was then black-listed.
    tools/fuzz-lib.ts no longer records noRepeat entries for units rolled back by a random manual payment.
  - Not done: RJ#6609 (2v2 `GameState.teams`) needs a types.ts contract change (lead); teams already work by seat parity.
- Batch 4: RJ#4262 Ava, Achiever — leading "you may pay [C]" at finalization (principle 11, `offerIf` a playable Hidden card);
  "here" read on resolution, so with Ava gone a Hidden unit can't be played (principle 17). B7 Ava card test answers the
  finalization prompt. Suite green (4314 pass, 6 todo).
- Batch 5:
  - RJ#519 WONTFIX: the official UNL-FAQ (Yone, Blademaster and Reckoner's Arena) says activating checks the condition — Yone
    doesn't trigger; engine already right (= conformance T193). r0001 test rewritten to the official ruling.
  - RJ#3123 (OGN-FAQ tie = neither OR both sides have units left): new rule `tieRecallAll(attacker, bf)` in the combat cleanup
    (showdown.ts); Symbol of the Solari recalls all units in a both-survive tie.
  - RJ#523 (CR 737-738): additional turns don't change the turn order — the queue resumes after the last regular turn
    (turn.ts nextTurn). r6501 RJ#6580 only passed under the old rule (P1 couldn't pay its Time Warp): setup fixed.
  - Type-only fixes: r0001 RJ#500 (m0!), RJ#504 (`{ ready: false }` for the nonexistent `exhausted` put option).
- Batch 6: RJ#552 (CR 337.2 + 339.1, official — no lead decision needed): an Add ability activated while the chain is non-empty
  restarts the pass sequence (play.ts); its user keeps priority (430.2.a). rules-decisions #55-#58 added.
- Fuzz 2 (seed from run log, 200 games): new repro 2022100893 (invariant: Shadow Clone token in zone base but not in the base
  array while Rek'Sai, Breacher's Accelerate decision was suspended) — fixed in actions.ts createTokenRaw (the token stays set
  aside until the decision is answered); triaged engine/fixed, report regenerated. Other signature: soft long-game only.
- Batch 7:
  - RJ#10879 (principle 11): Star Spring's optional move + unit chosen as the trigger is chained (up-to-one target, mayChoose);
    B8 card test answers at the new point.
  - RJ#572 / RJ#6609 (CR 491.8.b, 491.8.b.1; DECISIONS #572): 2v2 `GameState.teams` (seat parity, extra-key slot — types.ts
    untouched); scoring once per team per turn; the turn player's teammate's Scoring-Step battlefields are disqualified for that
    team that turn. New tests/rules/team-2v2.test.ts. Still missing for 2v2: shared points (491.8.d), "friendly" incl. teammates
    (491.8.e), hide/standard-move restrictions (491.8.c.1-2).
- Batch 8: RJ#7080 Hallowed Tomb returns any copy with the Chosen Champion's name (CR 103.3.a.3; helpers/B8
  `chosenChampionsInTrash`), its "you may" decided at finalization; RJ#12166 Swain, Visionary counts a Gear Unit as unit and gear.
  Type-only: r7801 RJ#8535-area `dests` cast. Suite green (4559 pass, 6 todo: 5 conformance todoReal + new RJ#12173).
- Batch 9: RJ#12173 (VEN-FAQ competing locations): an effect play with a fixed location (Temporal Breach "the same location")
  also offers play-rule destination costs (Dragon Roost [A][A]) as a destination choice (play.ts playProcess).
- Batch 10: RJ#8556 — no engine bug (trackMighty runs in every cleanup); harness `put()` didn't record placed units, so the next
  cleanup treated them as entering. tests/conformance/harness.ts put() now seeds their Mighty status; test un-todo'd.
- Batch 11: RJ#9655 — helpers/B5 `chosenBy` includes Repeat executions' choices (Repulse). RJ#10941 (CR 811.1.d.5) — `Ctx.play`
  plays a unit at the battlefield of the hidden spell / hidden permanent's play effect that plays it (new
  `ctx.hiddenPlayBattlefield()`); Here to Help offers only that battlefield. Type-only: r9101 zone 'gone' cast.
- Fuzz 3: repro 76397dd349 (view-leak: opponent sees a facedown Temporal Breach) was a fuzzer false positive — Scuttle Crab's
  Deathknell legitimately lets its controller look at facedown cards this turn (seeFacedown rule); tools/fuzz-lib.ts hiddenFor
  now honours it (triaged fuzzer/fixed). Re-run: 200 games, 0 engine signatures (soft long-game only).
- Batch 12: RJ#1999 Last Breath's damage is unit-dealt (`dealEach(..., { unitDealt })`, CR 418.6.b.3); RJ#5744 a hidden
  permanent's destinations honour only one-off rules for that object or rules flagged `PlayRuleAbility.hiddenToo` (Last Caress
  "even from face down") — not Miss Fortune, Buccaneer's general permission (CR 811); RJ#640 Dragon's Rage's reflexive target is
  checked at the destination fixed at play (CR 355.4). Type-only: r1301 `showdown.isCombat`, r5201 `m0!`.
  Then (once DECIDED): RJ#3312 Fox-Fire — caster picks a subgroup (total Might ≤ 4, one battlefield) when the targets no longer
  fit; RJ#650 Renata's battlefield restriction applies only to Renata (Heimerdinger's copy usable from base). Suite green.
  Left open for the adjudicator (proposed, no DECISIONS row yet): RJ#5791 (Bullet Time for 0 + Bonus Damage vs CR 715.4), RJ#3319b.

## 2026-11-26 — ENGINE-5 agent (standing fixer, after ENGINE-4)
- Batch 1:
  - RJ#5791 (official, no engine change): CR 715.4 "If no damage was Dealt, then Bonus Damage will not apply" (riftlens
    /rules/bonus-damage/, Teemo + Rabadon's Deathcrown example). Bullet Time paying 0 [A] at Void Gate deals 0 — the engine
    (bonus only for amount > 0, context.ts `deal`) is right; RJ#5791 → MISMATCH-RJ. r5201 test rewritten, un-todo'd
    (rules-decisions #59).
  - RJ#3319b: batch-B7 `recycleLeft` recycles the rest in one `ctx.recycle` (one event — Karma, Channeler triggers once; all six
    call sites are single "recycle the rest" instructions). actions.ts `recycle` randomizes per owner's deck (CR 416.4), so a
    multi-owner recycle (rad-111) no longer splices the wrong deck. Test un-todo'd (rules-decisions #60).
  - RJ#3319 already decided (DECISIONS #3319, house: Karma's trigger finalizes first) and passing — nothing to flag.
  - r1301 tsc errors: none present (tsc clean; `put(..., { buff: true })` is a valid PutOpts option).
  - 2v2 (CR 491.8, rules-decisions #61): shared team points (gainPoints / losePoints / burn out, `util.teamOf`); win check compares
    only opponents; a concession ends the team's game (491.6.a); final point by conquer counts battlefields scored by the team and
    excepts those an ally occupied in that turn's Scoring Step (491.8.g.1, turn.ts holdStep `allyOcc2v2:*`); testkit `setPoints`
    sets the team. Hide / Standard Move (491.8.c.1-2) and "friendly" (491.8.e) were already right — now tested.
    tests/rules/team-2v2.test.ts +6 tests.
  - Suite green (4949 pass, 5 todo: conformance todoReal).
- Batch 2 (conformance todos, CR 203.2 costs):
  - Atakhan (B4), Heedless Resurrection (B5) and dsl `pay.killSelf`: a kill paid as a cost counts as paid when the death is
    replaced (CR 203.2, DECISIONS principle 22) — Atakhan killing Mordekaiser, Twice Slain (who saves himself) no longer
    rolls back "could not pay Kill Mordekaiser".
  - tests/conformance/K-faq.test.ts: T207 (payment before the kill; discount kept; Mordekaiser saved), T194 (Atakhan played from
    banishment with Rek'Sai, Breacher's granted Accelerate, Rek'Sai killed for the cost → enters ready; not paid → exhausted),
    T205 (real Hunker Down in response to Angler Wyrm — the old setup used a modifier the engine never reads), T192 (Flash moves
    one of two Alpha Strike recipients → Repulse unusable; killed instead → usable), T182 (VEN-FAQ #25 is Temporal Breach +
    Elder Dragon + Dragon Roost, not Perched Grimwyrm = T181) — all un-todo'd. conformance-needs N6 marked DONE.
  - Suite green (5272 pass, 0 todo).
- Batch 3:
  - Fox-Fire (CR 355.11.b / 355.11.b.1, DECISIONS "9125 / 3312 re-check"): when its targets no longer fit, the caster must keep
    choosing while another original target still fits (a maximal legal subset — the CR example's {2,2} or {1,1,2}, never
    {1,2}); only targets still at a battlefield qualify, also for the "all still fit" path. New tests/rules/group-targets.test.ts.
  - RJ#9731: helpers/B7 `canAffordPlay` asks the engine (`ctx.canPlayByEffect`) for every effect-cost mode, so the card's own
    cost modifications count (Void Rush finds Noxus Hopeful: [2] reduction + Legion → free).
  - RJ#11052 (CR 337.2, 339.1, 346.1, 347.2.a): a unit/gear played (not by an effect) into an empty chain during an open
    showdown restarts the passes in succession and passes focus, as after any played card's chain (play.ts).
  - RJ#11054: events.ts `abilityKey` keys a copy's own abilities by the copied card (`effectiveDef`), so a Reflection copying
    Glasc Mixologist still gets its Deathknell when it dies (Temporary); helpers/B2 `ownAbilityKeyPrefix` likewise.
  - Type-only: tests/conformance/harness.ts `mightOf` typed `number` (null only for objects without Might) — clears the
    recurring "possibly null" tsc errors in new r6501/r7801/r11701 tests.
  - Suite green (5483 pass, 0 todo); tsc clean.
- Batch 4: RJ#7205 (DECISIONS #7205, ADJUDICATOR-4; CR 383.3, 383.3.d.1, 383.4.a.2): pending triggers met by separate events are
  placed chronologically, batch by batch — turn order (TP first) only among simultaneous triggers (chain.ts orderTriggers; each
  batch is its own segment). Promising Future: the opponent's Snapvine (played first) is below my Riptide Rex. rules-decisions #47
  amended, #62 added. Suite green (0 todo).

## 2026-11-26 — AI-CORE agent (deck-plan interface, turn-level search)

- Deck-plan interface published: `src/ai/plans/types.ts` + `docs/ai-plans.md`; registry `src/ai/plans/registry.ts`,
  `src/ai/plans/index.ts` registers the nine pilot files (stubs created: azir, vex, evelynn, reksai, kaisa, irelia,
  kennen, ezreal, sett). `src/ai/core/ctx.ts` builds the lazy `PlanCtx`/`CardInfo` views. Requests: `docs/ai-requests.md`.
- Old AI frozen as `src/ai/legacy/` (baseline for benches).

## 2026-11-26 — ART-ATLAS agent (card images as reviewable sprite atlases)
- Card images no longer ship as zip archives uploaded as artifact assets (archives can't be reviewed for public sharing).
  tools/bundle.ts packs data/images/*.webp into plain WebP sprite atlases dist/atlas/<n>.webp, published as the artifact's
  own files: portrait cards 320x447 in 6x6 grids (1920x2682 px), battlefields 447x320 in their own 6x6 atlases; quality 80,
  max 3 MB each (quality steps down if over). Codes packed set by set, base printings before alt arts. 1407 images ->
  40 atlases, ~32.7 MB. dist/images-manifest.json v3 = {format:'atlas', v:3, count, totalBytes, dev, key, atlases:[{path,
  w, h, cell:[cw,ch], bytes, count, codes:{printedCode:[col,row]}}]}. `key` hashes the sources + layout; an unchanged key
  reuses the atlas files (first build ~50 s with sharp, then ~2 s). dist/images/ (zips) is removed on bundle.
- src/ui/art.ts: zip parsing, /_blob/ asset urls and the images/<set>.zip fallback are gone (data/asset-urls.json is no
  longer read). Atlases are fetched by relative path only (safeAtlasPath: ^atlas/\d{1,4}\.webp$), cells validated against
  the atlas size. A card's cell is drawn to a canvas (OffscreenCanvas or <canvas>) and encoded to a blob: URL cached per
  code, so components keep plain <img> elements; decoded atlas pixels are released after ~4 s idle (compressed files kept).
  warmArt (was warmPacks): the board fetches the atlases of this game's cards first and cuts their cells, then fetches
  the other atlas files when idle. Fallbacks unchanged: printed code -> canonical -> other base printing -> text frame.
  Without a manifest there are no images. renderCard marks already-decoded codes img-ok up front (no fade on re-render).
- Tests (tests/ui/art.test.ts): every atlas is a webp of the declared size <= 3 MB, every data/images code is in exactly
  one in-bounds cell, and each cell matches its own source image (16x22 thumbnails) better than any other source; dist
  holds only index.html, app.js, cards.json, images-manifest.json and atlas/*.webp, with no /_blob/ or .zip in app.js;
  on the board images are 320x447 / 447x320 cut-outs matching their sources; only atlas/<n>.webp is requested (hostile
  manifest entries ignored) and the first atlas fetched holds a card of the game; 404 atlases or no manifest -> text
  frames. tests/fixtures/serve.ts serves dist/ statically (no /_blob/ mapping).
- Fuzz 1 (07:55, seed 515151, 200 games): 0 new repros (soft long-game only). Fuzz 2 (08:58, seed 626262, 200 games): new
  0a6ca849a3 "token in setAside" was a false positive — the Shadow Clone token is set aside by design while its own Accelerate
  decision (Rek'Sai, Breacher) is pending (ENGINE-4, 2022100893). tests/fixtures/invariants.ts allows a set-aside token that is
  the pending decision's source; triaged fuzzer/fixed, report regenerated. No engine signatures.

## 2026-11-26 — UI-LAYOUT agent (full-bleed board, reference geometry)
- [UI-LAYOUT] Board layout rebuilt to the user's reference screenshot (geometry only; Riftforge colours, card back and
  styling — no RiftAtlas artwork, card back, logos or names). src/ui/board.ts + src/ui/styles.css:
  - Full-bleed board, no side panel; opponent across the top half, you across the bottom, subtle split at mid-height.
    Every piece is placed in viewport percentages with vh/vw-clamped card sizes (`--zh/--zw` zone cards, `--bfc-h`
    battlefield card, `--hand-cw` hand, `--pw` piles, `--sc` score circles, `--cb` centre button), so 1280x800 ... 1920x1080
    look alike. `.mat`, `.m-bar`, `.m-row` are `display: contents` on desktop (DOM order unchanged for tests / a11y).
  - Centre: two battlefield boxes (x 8.8-91%, y 33-66%) spanning the midline, battlefield card small and centred on the
    midline, their units in the upper half, yours in the lower; Might totals + unit counts small in the box corners.
    Round button dead centre: End turn in the open main phase, Pass when nothing else carries the pass, else a waiting /
    "Respond" indicator (`.center-btn.end-btn`, data-testid end-turn / pass-end).
  - Opponent top row: legend + champion far left, base (x 14-56%), runes (56-91%, ready/total); main deck top-left with count,
    trash top-left corner; rune deck + floating pool ("Floating · Energy N · Power N") + banishment eye top-right; score track
    (zig-zag of numbered circles 0..victory score, current ringed) top-right; name plate top-right corner; card backs fanned
    along the top centre. Yours mirrored: runes left (x 9-43%, card-size images, overlap as the row fills), base right,
    legend + champion far right; rune deck + pool + eye bottom-left, main deck + trash bottom-right, score track and plate
    bottom-left; hand fanned along the bottom centre (cards ~8.6vh wide, hover zooms in place as before).
  - HUD (menu, turn, phase chips, showdown pill, hotseat seat switch, theme, Log, status / waiting line) along the top edge
    between the opponent's deck and hand; the game log is a drawer from the right edge (Log button).
  - Chain = "now resolving" display on the right edge (vertically centred between the battlefields and the score track):
    the top item's card at ~1.6x hand size with the "Pass — let X resolve" button ON the card, the respond hint and any
    options beneath, earlier items as thumbnails below. An on-board source of the top item gets a dashed gold outline.
  - Showdown focus prompt ("Pass focus") sits inside the showdown's battlefield box beside its card (bottom of the box on
    portrait tablets / phones).
  - Prompts are placed next to what they are about (Board.placePrompt / promptAnchor): payment above your runes, damage
    assignment beside the combat battlefield, source-card prompts next to the source (or left of the chain display), and
    always off the highlighted targets; with no anchor they stay over the battlefields. No controls in the corners.
  - < 720px: stacked, scrollable column (HUD bar, opponent counters + zones, battlefields, chain display, your zones +
    counters, dock bar with prompt/status + End-turn button, scrollable hand strip).
- Tests: tests/ui/interactions.test.ts — chain pass button is on the top chain card, the card is larger than hand cards, the
  display is right of the battlefields and vertically centred, no pass/end button in a side panel; showdown prompt inside its
  battlefield; layout test checks the reference geometry (zones, battlefields, centre button, decks, score tracks, 0..8
  circles) and that the centre button is End turn in the open main phase. tests/fixtures/ui-driver.ts clicks `.end-btn`
  wherever it is. Screenshots: tests/ui/shots/mid-*.png and scene-{chain,showdown}-*.png at 1280/1440/1920/390.
- Batch 5:
  - RJ#11158 (CR 391.3.a, 373): play.ts `counterItem` — a spell's leave-the-chain replacement (Fizz's "then recycle it", Flow /
    "then banish it", the helpers/B7 `afterChain` delayed replacement) wins over Abandon's "return it to hand instead of the
    trash", so a Fizz-played spell countered by Abandon is recycled. (Other "instead of the trash" replacements, e.g. ven-022,
    still leave the choice to Abandon.)
  - RJ#2103 WONTFIX: official VEN-FAQ (Ride the Wind at Vilemaw's Lair "attempt to move them to base" → "They will be readied"):
    base may be chosen, the move is negated (DECISIONS #5811, rules-decisions #48, T185). r1301 RJ#2103b rewritten to that.
  - Type-only: r0001 (a redundant `kind !== 'assignDamage'` after the narrowing `continue`).
  - Suite green (5317 pass, 0 todo); tsc clean for src/tools/engine-owned tests (tests/ai has another agent's in-progress error).
- Core rewrite (src/ai/search.ts, src/ai/eval.ts, src/ai/core/{planner,policy,hash,ctx}.ts):
  - Turn-level planning: beam search over sequences of own main-phase moves (single actions settled to the next quiet
    point, plan combo lines as macro-moves, group moves the engine does not enumerate, one hide per card), transpositions
    merged by a visible-state signature; the best line (with in-step answers) is cached and replayed while the real game
    matches it, re-planned on any deviation (per-turn engine-step budget). A line that stops at the search horizon is not
    ended with endTurn (re-planned instead). Optional costs right after a move (Accelerate, "pay [C] to ...") and single
    removal/buff targets branch (both answers / two best targets searched). Draw/reveal lines are re-scored in a second
    determinization. Light opponent-reply re-ranking available (`planner.replyTop`, off by default).
  - Evaluation: final-point rule in the threat projection, distinct units per projected conquer, "this turn" buffs
    excluded (lasting Might/Assault), rune value by runes available next turn (+ small now-term), own hand cards valued by
    cost/castability, facedown cards (card + reaction premium, discounted if the battlefield falls; count as defence),
    reactions held up at end of turn, extra turns, plan hooks (weights, card values, bonus, rune value, reserve).
  - Payments: explicit plans that use free exhaust-only Add sources before recycling runes (plays, responses, hides).
  - Tools: tools/ai-bench.ts (--vs legacy|bot|ai, --only/--opp decks, --noplans, planner/budget flags, per-deck table),
    tools/ai-tune.ts (SPSA self-play weight tuning, one iteration per call), tools/sim-lib.ts policy kind `legacy`.
  - Tests: tests/ai/core/core.test.ts (payments, two-step lethal, final point rule, replay, signatures, Defy response,
    horizon, projection); tests/ai/core/puzzle.ts (puzzle builder for pilot tests).
  - Pilot requests processed: see docs/ai-requests.md (all DONE so far).
- Batch 6:
  - RJ#3472 (one Ezreal; two-Ezreal stacking still AMBIGUOUS — flagged, test kept todo): Temporal Portal's granted Repeat is an
    optional additional cost, priced with Repeat-cost modifications via new `ctx.grantedRepeatCost` (context.ts; Ezreal's
    repeat-scope mod reads `item.choices.grantedRepeat`).
  - RJ#3495: an additional trigger instance (Svellsongur's copy, `extraTriggers`, inst ≥ 5000) has its own once-per-turn use
    (events.ts `useKeyOf`, used by the scan and chain.ts placement) — Draven, Audacious + Svellsongur scores 1 + 1 + conquer.
  - RJ#2194 (CR 491.8.h-i, DECISIONS #2194): createGame rejects 2v2 teammates sharing a Champion Legend or a Battlefield. Fixture
    `cf-legend-2`; the 2v2 setups in r0001/r1301/r6501/team-2v2 give teammates distinct legends and disjoint battlefields
    (P0 a,b,c / P1 b,c,d / P2 d,e,f / P3 e,f,a). New team-2v2 validation test.
  - Suite green (5369 pass, 1 todo = RJ#3472 two-Ezreal AMBIGUOUS).
- Later fixes: beam keeps half its slots for distinct openings (a single strong combo no longer crowds out the plain
  move with the same first action); a budget reserve for re-scoring draw/reveal lines; rollback-loop guard (actions in
  `__rolledBack` are filtered, no explicit payment again for that object, lines never replay into an undone action;
  repro seed 1100008 and PILOT-B's Kennen/Irelia repro now finish); explicit payments skipped for Repeat/Flow/Empower/
  "additional cost" cards and for spells while a [Deflect] unit is on board; battlefield knowledge in the evaluation
  (Frozen Fortress kills 1-Might units at the Beginning Phase, Forbidding Waste's lone defender -2).
- tools/ai-metrics.ts (per-game mechanic usage for one deck; sim-lib `GameRun.metrics` / `GameOutcome.metrics`).
- Core budgets: turn plan 130 engine steps, re-plan 60, 340 per turn.
- Fuzz 3 (10:00, seed 737373, 159 games in 8 min): soft legal-rollback d2d4803d9e recurred (seed 737526, Mesmerize with all runes
  exhausted, payable only via Starry-Eyed Songstress's optional "exhaust me and three units: [2] less", offered after targets).
  play.ts chooseTargetsFor's CR 355.16 affordability filter priced targets without that later discount and dropped every
  target. Now, when the play isn't affordable even before the choice, only choices that raise the cost are dropped. Seed replays
  clean; no engine signatures otherwise.
- Batch 7:
  - RJ#9887: Alpha Strike's "for each unit this kills" XP is a one-shot delayed "when it dies" per lethally damaged recipient, so
    a replaced death (Guardian Angel) gives no XP.
  - RJ#9356 / #9853 (DECISIONS #9356, UNL-FAQ "Brush a Brush"): Green Father loses its trigger-time "not a Brush" condition;
    context.ts `replaceBattlefield` — a replaced battlefield token ceases to exist and the new token inherits what it replaced, so
    the swap back can still return the original. tests/cards/B8 Brush test declines the (now offered) Green Father.
  - RJ#8921b: helpers/B7 PREVENT_NEXT (Counter Strike) matches only damage still > 0 — each prevention takes one damage event.
  - RJ#7374: Kato the Arm's move trigger gives nothing once Kato left the board (principle 17).
  - RJ#9917 (official UNL-FAQ, CR 375): actions.ts `createTokens` returns every token a replacement-modified play made (Zilean's
    additional copy); `ctx.createToken` uses it; Deceiver's reflexive copy + Temporary applies to each token.
  - Suite green (5519 pass, 1 todo = RJ#3472 two-Ezreal, AMBIGUOUS — needs a DECISIONS row).
  - RJ#7364 WONTFIX (DECISIONS #7364 adopts RJ; engine already right, test passes).

### AI-CORE results (2026-11-26, tools/ai-bench.ts, random meta pairs, both seats, snapshot 09:55 incl. pilot plans)
- New AI vs legacy (src/ai/legacy): **139-61 = 69.5%** (95% Wilson CI 62.8-75.5), 200 games (5 x 40, seeds 101-105).
  Per deck (new AI's deck): Azir lists 20/44 (45%) are the weak spot; Vex 22/24, Evelynn 20/26, Kennen 9/10.
- New AI vs engine bot: **163-37 = 81.5%** (CI 75.5-86.3), 200 games (seeds 201-205). Legacy vs bot on the first 80 of
  those deals: 51-29 (63.8%); the new AI went 64-16 (80%) on the same deals.
- Core-only A/B (no plans, vs legacy, seed 11, 40 games): first planner version 49% (equal to legacy) -> after the horizon
  fix (a line cut by the search horizon is re-planned instead of ending the turn) and opponent responses in the lookahead
  67.5-69%.
- CPU: 2.3-2.9 s per new-vs-legacy game, 2.6 s per new-vs-new game (thread CPU), ~1.4 s vs bot.
- SPSA self-play tuning (tools/ai-tune.ts, 5 iterations x 40 games): weights moved < 10%; tuned vs default on held-out
  seeds 401-402: 39-41 (48.8%) — no gain, defaults kept. Hold-race term `race`: 57.5% (46-34) vs off, not significant,
  breaks two Vex puzzles -> opt-in (default 0).
- tests/ai: 89/89 pass (core 9 + legacy smoke 2 + pilots 78).

## 2026-11-26 — ENGINE-6 agent (standing fixer, after ENGINE-5)
- Batch 1:
  - RJ#3472 two Ezreals (DECISIONS #3472 decided: each Ezreal reduces every optional additional cost, the Portal-granted Repeat
    included → [2]+[0]+[0]): engine already stacked them; r2601 test un-todo'd and renamed (MISMATCH-RJ).
  - RJ#12403 (principle 11): Valley of Idols' "they may pay [1] to buff it" is decided and paid as the trigger is chained.
    New `TriggeredAbility.payer` (+ TrigOpts): the player who makes a trigger's finalize-time choices (leading `optional`, modes,
    targets, `cost`, Deflect) when the text gives them to another player ("they", "that player"); the trigger stays the
    controller's (chain.ts placeTrigger, events.ts immediate path).
  - RJ#12419 (CR 124.1): builtin Temporary / Deploy "kill this" record the source's epoch when they trigger and do nothing once it
    became a new object (Temporal Breach banish + replay in response).
  - RJ#9917 basis-upgrade lines: no change needed (ENGINE-5 fix stands).
  - Type fix in r11701 RJ#12403 test (`counters.buff`, not a non-existent `buffed` field).
  - Suite green (5596 pass, 0 fail).
- Batch 2:
  - RJ#12439: Star Spring's choice goes to the player who played the unit (`payer: evPlayer`).
  - Principle 11 sweep (same shape as RJ#12403; leading "you may [pay X] to …" asked on resolution before): Mistfall, Fiora, Worthy,
    Power Nexus, Protective Sands (rune count stays a trigger-time condition, rules-decisions #36), Ripper's Bay (payer = the
    returned unit's owner), Treasure Hoard (payer = conqueror), Chemtech Cask, Ruined Monastery, Brush token swap-back. Card tests
    in B8/battlefields-more resolve the chain after the "yes". (Super Mega Death Rocket!'s "you may discard 1 to return
    this" left on resolution: principle 11 would pay the discard at finalization, but verified RJ#6533 (MATCH) has Vayne bounced
    by her trigger and then discarded for the Rocket — needs a DECISIONS call.)
  - RJ#2323 (principle 17): helpers/B3 playUnitTokens `at: 'here'` no longer falls back to base — a source off the board plays no
    token.
  - RJ#12433 (CR 356.5.a): helpers/B7 playIt `allCosts` → engine `noAdditional`; Bone Skewer's forced play pays no additional
    cost (Cruel Patron kills nothing).
  - RJ#12474: rules.ts activeRules also scans unscripted objects that are copies (LeBlanc copied by Shady Spectacles keeps her
    noTemporary rule).
  - RJ#2332: Spirit's Refuge's "if they didn't already" sees Deflect from the unit's own conditional static (Fiora, Victorious
    while Mighty) → Deflect 1.
  - Suite green (5675 pass, 0 fail, 1 todo = RJ#906 2v2 invite — needs a types.ts Action, flagged for the lead); tsc clean.
- Batch 3:
  - RJ#5998: Zenith Blade can't be played without a friendly unit (playIf). The move stays an up-to choice made when played. Whether
    a friendly unit must be chosen when one exists, with the move optional on resolution, needs a DECISIONS row (6 RJ tests assume
    the up-to prompt).
  - RJ#3497: engine `canPlayByEffect` checks the destinations it is given (cantPlay rules, entry limits), as playProcess does;
    Here to Help offers only units playable to one of your battlefields, and only those battlefields (Perched Grimwyrm).
  - RJ#6045 (DECISIONS #6045, principle 23): events.ts `emit` stamps each non-token `play` event with `completedIndex` (the
    player's Nth completed card play this turn, `usage` counter). Darius, Trifarian triggers on completedIndex 2. (Its test's
    drive loop stopped one step late — fixed.) Astral Heron ("your first card") and the B3 "first gear" trigger still count
    finalizations; flagged.
  - RJ#3319: WONTFIX (DECISIONS #3319 keeps the engine result).
  - Suite green (5777 pass, 0 fail, 2 todo: RJ#906, RJ#3600b).
- Batch 4 (lead request + findings):
  - Auto-pay (rules-decisions #65, lead): payment.ts planWith exhausts any READY rune it recycles before recycling it, so its [1]
    floats in the pool (CR 316.1). Covers play, ability, Hide and trigger costs through autoPay. Manual plans unchanged. No script
    counts rune exhausts. T031 unaffected. New conformance T031b (Seal of Rage first: rune recycled, pool 1, other runes ready; then
    V(1) uses the floating [1]). Tests that counted only ready runes now also count the floating pool: B2 Hextech Gauntlets (one
    rune stays ready) and Hextech Anomaly (pool 4), B8 Butcher of the Sands (floating 2 pays a [2] spell; b8-s5 still can't),
    K-faq T203, r1301 RJ#2105, ai/plans/vex T4 (any Hidden card hidden at the held battlefield).
  - RJ#7564: passes through the change above; un-todo'd. No separate Add-ability window was added.
  - RJ#3600b: Herald of Scales is a -2 mod with engine `minEnergy` 1 per copy (8 → 6 → 4 → 2 → 1).
  - RJ#3618 B (DECISIONS #3618, principle 3): actions.ts `kill(…, performers)` / `ctx.kill(targets, performers)`. helpers/B5
    `eachPlayerKillsOne` (Cull the Weak and the other "each player kills" cards) attributes each kill to the player who performs it.
    Immortal Phoenix also requires the killing spell to be yours (RJ#4019 kept).

## 2026-11-26 — AUTO-AUDIT agent (decisions the engine/UI make for a player)
- docs/auto-decisions.md: inventory of every auto-decision (auto-pay, ask() auto-answers, trigger ordering, damage
  assignment defaults, optional costs, destinations, X/numbers, replacements, UI one-click actions). 22 SAFE, 6 FIX, 4 ASK,
  each with where / what / can-it-differ / verdict.
- tests/rules/auto-decisions.test.ts:
  - Auto-pay property test: random states (runes by domain, ready or exhausted; pool incl. universal and restricted
    power/energy; Seals, Energy Conduit, Gold, Lux) × energy / [C] / multi-domain / [A] costs × purposes. Every legal
    payment is enumerated and compared with the engine's executed result under a Pareto order (runes in play per domain,
    Add objects kept, unit readiness, everything still payable now and once the pool empties). Passing part: complete,
    sound and model-exact. It found 22/400 dominated results in 3 classes, handed to ENGINE-6 (owner of payment.ts) with
    minimal repros: AP-1 (a same-domain Seal left ready while a rune is recycled), AP-2 (Add sources activated for
    nothing), AP-3 (universal pool power spent before matching domain power). ENGINE-6 fixed all three; the tests now pass.
  - ask(): exhaustive check that every auto-answer is the only answer validateAnswer accepts.
  - #65 (user report) pinned; manualPay payment Decision accepts Seal-based and exhaust+recycle manual plans.
- ASK A-1, the manual payment override, made reachable in normal play (no engine change): a "Choose runes when paying"
  preference on home and in the lobby (src/ui/main.ts). Local games set GameSetup.manualPay for the human seats; online,
  the guest sends it in `ready` (src/net/protocol.ts, online.ts `setManualPay`) and the host fills setup.manualPay. The
  payment panel (src/ui/prompt.ts) starts pre-filled with the auto-pay suggestion (Auto-pay stays the primary one-click
  button), lists Add sources as checkboxes (reads `data.adds` when the engine provides it), and exhausts a ready rune
  chosen for recycling (#65). tests/ui/payment.test.ts (playwright) covers the preference, the pre-filled highlight, Auto-pay
  and Pay with selected.
- Still open for the next engine agent (src/engine): E1 (`data.adds` in the payment Decision), E2 (trigger / resolution costs
  bypass manualPay), F-4 (orderTriggers dedupes triggers of different events), F-5 (Repeat `either` reduction defaults to
  [1] less), F-6 (validatePlan multi-domain Add check). Rules call needed: A-3 (combat damage onto exempt recipients).

## 2026-11-26 — META-AUDIT (second pass, from KAISA-AUDIT)
- [META-AUDIT] Re-audited the 159 distinct cards of the 20 Bologna lists (Kai'Sa lists first) against their scripts and the
  DECISIONS rows: no script or engine bug found (details and the doubtful points checked: docs/meta-audit.md). New focused
  tests: tests/cards/meta-audit.test.ts (9: Daughter of the Void [A] pays spells only — not units, Accelerate or hiding;
  "at a battlefield" targeting; Sky Splitter / Noxus Hopeful costs; Thousand-Tailed Watcher; Void Gate; Smoke Screen minimum;
  Rockfall Path; Frozen Fortress; Time Warp cost; Defy vs Kai'Sa spells by printed cost).
- [META-AUDIT] tools/fuzz-lib.ts: `FUZZ_META=1` deals two of the 20 meta lists per fuzz game (spec.meta records the files);
  invariants unchanged. 2 runs on the meta matchups: no invariant violation (only the soft `long-game` signature from
  random/chaos policies; replayed, not an engine stall).
- [KAISA-AUDIT] Filed an AI in-step targeting tie bug (own unit chosen for a harmful spell on equal scores) in
  docs/ai-requests.md; src/ai not edited.
- Batch 5 (AUTO-AUDIT counterexamples + lead list):
  - payment.ts autoPay: AP-1 (if the runes-only plan recycles, try free Adds — exhaust-only, no extra cost, not a unit — and keep the
    plan with fewer recycles), AP-2 (drop Add sources whose `only` doesn't fit the purpose; prune sources a plan doesn't need), AP-3
    (`poolEntries`: domain pool power is matched and spent before universal power, in planWith / validatePlan / spendFromPool).
    tests/rules/auto-decisions AP tests un-todo'd. The property test is clean at AUTO_AUDIT_N=400. tests/ai/core "Kai'Sa's free Add"
    now asserts only "no rune recycled" (the engine picks the legend Add itself).
  - play.ts (lead item 4 / E5): after Repeat, an "[1] or [A] less" reduction picks one that still reduces something (asks if both
    do), as the first pass does.
  - chain.ts orderTriggers (lead item 3 / E4): tried (order one ability's instances from different events) and REVERTED. It adds an
    orderTriggers prompt that 5 tests don't answer (B2 Nasus, B7 Wraith of Echoes, B8 Nine-Tailed Fox, r1301 RJ#1327, r6501 RJ#6923)
    — moved to ENGINE-7, item 6.
  - rules-decisions #66: tie-break UX default for non-dominated payments (lead).
  - Fuzz (13:17, seed 626262, 200 games in 477 s, 2 workers): 1 signature, the known soft 79376ab89a long-game (turn cap). No new
    repros, no engine signatures.
- OPEN for ENGINE-7 (lead list + AUTO-AUDIT, docs/auto-decisions.md):
  1. The payment Decision's data must list every usable Add source (Seals, Gold, legend powers: {key, obj, label}) so the manual
     panel can offer them (AUTO-AUDIT E1; its UI reads data.adds when present).
  2. Honour the manualPay ("choose runes") preference where autoPay is called directly: trigger costs and trigger Deflect
     (chain.ts placeTrigger), mid-resolution payments (ctx.pay / payResolved: Nocturne RJ#7564, Void Rush / Swarm Queen plays) and
     token Accelerate (actions.ts ~695) (E2).
  3. Multi-domain Add validation by all domains (validatePlan builds add units from `a.power` only, ignoring `powerDoms`).
  4. Tie-break part of rules-decisions #66 not done: among runes of different domains, keep the domain most needed by the hand.
  6. chain.ts orderTriggers: include the event object in `distinct` (`key|source|event.obj`) so one ability triggered by different
     events (two deaths) is ordered by the player, with labels naming the event object; adapt the 5 tests above to answer
     orderTriggers (or auto-order when the instances can't differ).
  5. Needs a decision first: RJ#906 2v2 invite (new Action kind in types.ts + UI/AI/net); Zenith Blade full RJ#5998 reading;
     Super Mega Death Rocket! discard timing (principle 11 vs verified RJ#6533); Astral Heron / B3 "first gear" counting by
     completion (as Darius, RJ#6045)?

## 2026-11-26 — BASICS agent (systematic matrix of everyday play)
- New `tests/basics/` everyday-play matrix (docs/basics-findings.md). It is generated, not hand-picked: 17 turn moments ×
  133 synthetic kinds (unit to base / own battlefield / uncontrolled battlefield, normal / Action / Reaction spells, gear,
  Equip, hide, flip, unit and legend abilities, rune abilities, play-trigger costs, standard moves) and 15 real-card kinds (11 cards) ×
  13 resource states. Each cell is checked for legality (validateAction = getLegalActions = rules oracle), best auto-pay
  end state (independent oracle `tests/basics/oracle.ts`), cost paid in full, optional costs offered if and only if they
  are affordable, priority / focus / passes afterwards, effect, and getView redaction. Plus pool-lifetime (28) and
  manual-payment (24) and showdown/combat-ending scoring (13, incl. the final point rule) generated tests, and oracle
  sanity tests including the reported case.
  - Default run: 14,363 cells / 235,276 checks in 2,516 tests. Full cross: `BASICS_FULL=1`.
- BX-1 (rules, CR 347.2.a / 346.1) FIXED in src/engine/play.ts `activateProcess`: an Add ability used in an open
  showdown (a rune's [T]: Add [1], Gold, a legend Add) now restarts the passes in succession; focus stays. Before, an
  opponent's earlier pass still counted, so tapping a rune and passing ended the showdown. This completes RJ#11052
  (permanents) and rules-decisions #56 (chain case). Tests: tests/basics/findings.test.ts BX-1, BX-1b + matrix cells.
- Payment-choice results recorded in docs/auto-decisions.md "BASICS cross-check": B-1 = A-1 (domain to recycle for
  [A] / multi-domain [C]; 220 cells marked todo); B-2 = AP-1 (confirmed independently, now pinned); B-3..B-5 SAFE.
- View proposals (not changed, shared contract): BX-4 effective play cost in PlayerView; BX-5 stable object ids let a
  formerly public card be tracked into the facedown zone.
- The matrix's in-step view check follows UI-CANCEL's getView: while a player can still cancel, the opponent sees the
  pre-play board and not the card being played.

## 2026-11-26 — UI-CANCEL agent (back out of your own play while making its choices; AUTO-AUDIT A-5)
- types.ts: new Action `{ type: 'cancel'; player }` and `EngineExtra.cancelFor?: PlayerId`.
- src/engine/cancel.ts (new): at every suspension of a replay unit, `cancelableFor()` decides whether the player who started it
  with playCard / activate / hide may still cancel: the decision must be theirs, the play not finalized (no spellFinalized /
  play / activated / hide event), rng unchanged, no reveal/look/draw/predict/channel/burn-out events, no object hidden from
  them at the base moved, became revealed or is shown in the decision, and every earlier decision of the play was cancelable.
  Covers destination, mode, X/number, targets, optional additional costs (Accelerate, Repeat, ...), payment, cost choices.
- game.ts: `run()` stores the answer in `g.ex.cancelFor`; `applyAction({type:'cancel'})` returns a clone of the unit's base
  (the pre-play state; same restore as Rollback). Only `actionCount` (the network version, must keep growing) and
  `ex.lastEvents` (`[{type:'playCancelled'}]`) differ; no log entry. `getView` for anyone else while a play is cancelable
  = the view of the pre-play board with a summary pending ("<name> is making choices", same kind, no options/data) — the
  card being played, its choices and partial payment stay private until it finalizes. concede clears a stale cancelFor.
- legal.ts: `validateAction` accepts cancel only for the deciding player when `cancelFor` allows; `getLegalActions` lists it
  last for in-step decisions. bot.ts chooseAction/randomAction and src/ai search.ts / legacy/search.ts filter it out (bots
  never cancel; first-legal fallbacks never pick it).
- net/protocol.ts: 'cancel' is a valid wire action (guest intents and views whose legal list contains it); the host applies
  it for seat 1 like any intent.
- UI: prompt panels of a cancelable decision get a "Cancel" button first in the action row (`data-testid="cancel-play"`);
  Esc cancels too (ignored in text fields / while a modal is open). LegalIndex.cancel; Board.describe('cancel').
  Single-legal-target auto-picks are unchanged (no confirm step added): if the play has no later choice it finalizes at once.
- tests/basics/matrix.ts checkView: "P1 sees the chain" compares against the pre-play chain while the actor may cancel.
- Tests: tests/rules/cancel-play.test.ts (12: cancel at chooseTargets/chooseMode/chooseNumber/optional (Accelerate, Repeat after
  targets)/payment/chooseDestination/activation restores the state JSON-identically; refused after a reveal; the opponent
  can't; not offered after finalizing (chain response, play trigger in the same step) or at main; getView redaction; host
  accepts the guest's cancel over the wire). tests/ui/cancel-play.test.ts (playwright, manual pay: Cancel button, then Esc,
  card back where it was, game continues). Full suite + tests/ui + smoke green, tsc clean.

## 2026-11-26 — ENGINE-7 agent (standing fixer, after ENGINE-6)
- Batch 1 (ENGINE-6 OPEN list + AUTO-AUDIT):
  - (a) E1: payment Decision `data.adds` = every usable Add source `{key, obj, label}` (payment.ts `paymentAdds`).
  - (b) E2: `choosePayment` (payment.ts) asks the payment Decision (auto-pay preselected) whenever `manualPay` is set, for plays /
    abilities / hide / moves (play.ts payResources), trigger costs + accepted Deflect (chain.ts placeTrigger), `ctx.pay` during a resolution
    (context.ts payResolved), token Accelerate (actions.ts). rules-decisions #68.
  - (c) F-6: validatePlan matches multi-domain [C] Adds by all domains; executePayment fills a missing addDomains; manual plans can't
    count an Add's restricted (`only`) resources for another purpose (Lux's spells-only energy for a unit).
  - (d) rules-decisions #66 tie-break (`domainKeepScore`: hand + champion power, [C] in keyword costs of hand cards and unattached board
    gear, minus runes in play; ties keep the last rune of a domain), also for which ready rune is exhausted for energy. BASICS: the 154
    A-1/B-1 'domain' todos pass; the known-failure mapping is removed (tests/basics/driver.ts), so it is a hard check now.
  - (e) F-4: chain.ts orderTriggers orders one ability's instances from different event objects (labels "(for X)"); the 5 tests answer it.
    rules-decisions #69.
  - BX-4 (lead): `PlayerView.costs` (types.ts) = current cost of each card in the viewer's hand / champion zone (play.ts
    `effectivePlayCost`, game.ts getView); src/ui/board.ts shows a cost badge (`.eff-cost`, green down / red up) on hand cards whose cost
    differs from the printed one.
  - Typing fixes: r0001 ~5443 (`who: number[]`), r9101 RJ#10029 (`counters.buff`), r1301 resolveWith order, r7801 RJ (`faceDown`).
  - New tests: tests/rules/engine7-payment.test.ts (9).
- Batch 2 (todos + DECIDED-ENGINE):
  - A-3 (DECISIONS A-3, principle 24) + RJ#10022: showdown.ts assignTargets computes lethal through damage replacements (replace.ts
    `damageAfterReplacements`, side-effect-free); exempt (`lethal: null`) only for can't-be-dealt-damage units, which get damage only when
    every other unit has lethal; prevent-all / Counter Strike → `unreachable` (lethal 1e9, JSON-safe), not exempt. combat-damage-prevention
    6 todos un-todo'd; r9101 RJ#10022 un-todo'd; UI damage prompt labels both. rules-decisions #67.
  - r5201 RJ#5758 rewritten per DECISIONS A-3 (verified RJ "lethal to the Tank, rest to others" → MISMATCH-RJ; flagged in FINDINGS for the
    adjudicator to add 5758 to the A-3 row).
  - RJ#11322: Arachnoid Horror's "an enemy unit is alone" counts only enemy units; test un-todo'd (its final check moved before the combat).
  - RJ#11346: Akshan off the board — the gear is still detached and moved; no control change, no attach; test un-todo'd.
  - RJ#6533: Super Mega Death Rocket!'s discard is the trigger's optional cost (principle 11); test un-todo'd. Found on the way:
    events.ts triggerSources pushed into abilitySources' cached array, duplicating zone-specific (trash/hand) trigger sources on later scans
    in the same timestamp — fixed (copy). Trigger costs start a new event batch (chain.ts) and helpers/B6 firstOfBatch / batchCount respect
    batch ids, so RJ#6974 (three Rockets → Jinx +3) still holds. rules-decisions #70.
- Batch 3 (lead's DECIDED-ENGINE additions):
  - RJ#6045c (principle 23): Astral Heron counts the first completed card play (completedIndex 1); Jayce's "first non-token gear" uses a
    new per-kind ordinal `completedGearIndex` (events.ts emit; Unit-Gear cards count). r5201 RJ#6045c un-todo'd.
  - RJ#5998b (DECISIONS #5998): Zenith Blade's friendly unit is a required target; the move is asked on resolution (none if already
    there). Flows adapted with outcomes unchanged: r0001 RJ#32/#124, r1301 RJ#1492/#1955, r2601 RJ#2609/#2774, B4 move; r5201 RJ#5998b
    un-todo'd.
  - RJ#1127 (principle 25): Flash and Voidreaver's base move offer units already in base (they don't move; engine moveUnits already skips
    same-location moves). r0001 RJ#1127 un-todo'd.
  - B7 trash Meticulous Restorationist test: dropped a stray 'no' that only worked because of the duplicate-trash-trigger bug (batch 2).

- Batch 4 (FINDINGS poll):
  - RJ#3646 (CR 429.5.c/c.1, principle 3): cleanup.ts killLethal attributes a cleanup kill to a spell only for damage dealt since the
    previous cleanup (`damageSrc[].stale`, types.ts EngineExtra); damage marked earlier makes no spell responsible (Falling Comet, then
    Stupefy: no Immortal Phoenix). r2601 RJ#3646 un-todo'd.

## 2026-11-26 — HIDDEN-IDS agent (BASICS BX-5: object ids leaked across hidden zones)
- Leak: getView kept engine object ids for hidden objects, so a client that saw a card public (on the board, in trash, revealed,
  looked at) could follow it by id into the opponent's hand, deck or a facedown slot. Even with fresh ids, set difference would
  single out the one new id in a hidden zone. Other channels found while fixing: `state.seed` was shipped in every view
  (guest could recompute every shuffle, incl. their own deck order); the objects map listed hidden objects in creation order;
  hidden objects kept epoch / timestamp / enteredThisTurn / hiddenTurn; the opponent's hand was listed in real order; log refs,
  modifier sources, chain targets and ex bookkeeping (memo keys, playPermissions, damageSrc, setAside lists) named hidden ids.
- Fix (view layer, engine ids untouched): new `src/engine/hidden-ids.ts`.
  - Objects hidden from viewer P appear in P's view as `h<14 hex>` = SHA-256(viewKey | P | id | epoch | zone instance | counter),
    with location fields only (owner, controller, zone; battlefield / hiddenTurn for facedown). Visible objects keep real ids
    (the owner acts on them). `viewKey` = `GameSetup.viewSecret` (online hosts now pass 128 random bits, src/net/online.ts) or a
    seed-derived default; never drawn from `state.rng`, so game logic and replays are unchanged.
  - `trackHidden` (called by applyAction / createGame; skipped for `cancel`, which restores the exact pre-play state) keeps
    `ex.hid`: per viewer, per hidden zone instance (hand/deck/rune deck/set-aside per owner, facedown per battlefield+controller)
    a counter that bumps when the zone gains a member (entry or a reveal/look ending), an event named a member, or the members'
    relative order changed (shuffle). A bump re-aliases the whole zone, so the card that went in can't be picked out; cards
    leaving don't re-alias the rest, so aliases are stable between steps (UI animations). UI-CANCEL masking respected.
  - Zone arrays list hidden members in alias order (no deck position / hand order); hidden objects come after visible ones in
    `objects`, in alias order; every other mention of a hidden id becomes `'hidden'` (keys naming one are dropped, log refs
    filtered); `seed`, `ex.viewKey`, `ex.hid`, `ex.memo`, `ex.lastEvents` are stripped from views.
  - types.ts: `EngineExtra.viewKey?`, `EngineExtra.hid?`, `GameSetup.viewSecret?` (optional, additive).
- UI: the opponent's hand backs are keyed by position (`hand-<p>-<i>`; anim.ts flies a new one in from the deck), since their
  aliases change whenever a card enters that hand.
- Tests: tests/rules/hidden-ids.test.ts (10): bounced-then-hidden card, played-bounced-shuffled into deck, Sabotage reveal then
  facedown hide, Rek'Sai reveal + recycle to the bottom, Void Rush reveal + draw, hand reorder; an id-tracking adversary over every
  view must not single the card out (verified to fail with re-aliasing disabled). tests/fixtures/invariants.ts `checkViewIds`
  (no hidden internal id anywhere in the view incl. legal actions, aliases fresh when a zone gains a member, real zone sizes, alias
  order, no seed/key) is run by the fuzzer's redaction check (tools/fuzz-lib.ts viewProblems, which now also compares against the
  pre-play board during a cancelable play). Updated tests that looked hidden objects up by engine id: cancel-play, setup,
  A-setup T012, L-misc T211, basics/matrix view checks. Fuzz: 200 games, no view leaks (one false positive, 44d2fa80a5, fixed).
- Follow-up (ENGINE-7 fuzz repros 58ffd8f808, 55e5a57e1f): hidden hand ids embedded inside view keys (`ex.counts`
  "B4:mv:mfCaptain:oN#5", `ex.combat.roleEpochs` "a:oN") got through: only exact keys or an id at the start were matched.
  `hidden-ids.ts scrubber()` now drops any key and replaces any value token that embeds a hidden id (whole-token match, so
  "o580" is not taken for "o58"), applied as a final pass over the whole view state, plus `pending` and `costs`; anything
  nested deeper than 200 levels is dropped rather than shipped unscrubbed. Regression tests: synthetic keys + both repros
  replayed step by step through `checkViewIds` (tests/rules/hidden-ids.test.ts, 13 tests). Repros triaged fixed. Fuzz rerun:
  200 games, no view leaks.
  - RJ#12559 (DECISIONS #12559): new `ctx.beforeRevealFromDeck(ids)` (context.ts) — helpers/B7 lookPick with revealPicked applies the
    replaceable revealDeck event (Void Hatchling) before the reveal choice; a card it recycles can't be revealed or recycled again.
    r11701 RJ#12559 un-todo'd. rules-decisions #73.
  - RJ#3694 (DECISIONS #3694): cleanupSteps starts a staged showdown/combat in the cleanup that staged it when a repeat pass follows in a
    Neutral Open Action-phase state (startStaged moved from game.ts to showdown.ts). r2601 RJ#3694b un-todo'd. rules-decisions #71.
  - Full suite 6107 pass / 0 fail / 1 todo (RJ#906); tests/basics 2590 / 0 / 0; tests/ai 91 / 0; tsc clean.

  - Fuzz: 14:37 seed 727272, 200 games / 424 s: 2 new `view-leak` repros (58ffd8f808 ex.counts key "B4:mv:mfCaptain:oN#N", 55e5a57e1f
    combat roleEpochs) — internal ids of hidden hand objects in the view, for HIDDEN-IDS (aliasView), not engine-rule bugs. 15:00 seed
    737373 (after all ENGINE-7 changes), 200 games / 263 s: no new repros; soft long-game 79376ab89a and bot-loop 4cd09eb45b only.

## 2026-11-26 — ENGINE-8 agent (standing fixer, after ENGINE-7; stopped early: usage limit)
- Batch 1 (ENGINE-7 OPEN items 2-3):
  - Item 2 (CR 373 + 467.2.c.5): several mandatory replacement effects on one unit's combat damage. replace.ts: `simulateDamage`
    (side-effect-free, respects `_applied`, outcome signature = amount + each applied replacement's data), `damageAfterReplacements(g, ev,
    prefer?)`, `mandatoryReplacements`, `damageOrderMatters`. showdown.ts `chooseDamageOrders`: before assignment, for each recipient
    whose replacements' order can change the outcome for some amount 1..attacking total, its controller chooses the order (asks only
    while the rest of the order still matters); stored in `ex.combat.replOrder`, used for lethal (assignTargets) and at dealing
    (applyReplacements), deleted after the damage. Combat damage whose replacements' order can't matter now applies silently.
    rules-decisions #74. New tests/rules/combat-replacement-order.test.ts (7): prevent 2 + Lotus Trap (survives / dies by choice; lethal
    3 vs 4 in the assignDamage Decision), Counter Strike + Lotus (no question), prevent-all + Counter Strike (asked; Counter Strike kept
    only if the shield applies first), single replacement (no question, order not kept).
  - Item 3 (RJ#3694 in other phases): cleanup.ts `stagedMayBegin` — a staged showdown/combat also begins inside an Ending-Phase cleanup
    (turn tasks pending), and also in a pass that changed nothing; turn.ts Expiration's own cleanup passes `noStart`. rules-decisions #75.
    New tests/rules/staged-phases.test.ts: Ending-Phase RJ#3694 shape (Volibear attacks, Sett dies in the repeat, conquer this turn;
    fails on the ENGINE-7 code) + a Beginning-Phase test marked todo (see OPEN 1). The Beginning-Phase start was implemented and
    reverted: it breaks verified r9101 RJ#9254.
- Not done: item 4 (domain tie-break with legend / activated-ability costs on the board), fuzz run (lead: no fuzz).
- FINDINGS polled once (15:20): no MISMATCH-ENGINE / DECIDED-ENGINE line open (RJ#906 out of scope). DECISIONS A-3 already lists 5758
  (ADJUDICATOR-6, 14:40), nothing to implement.
- Suite (per file, 108 files): 6219 pass / 0 fail / 3 todo (full run 6220/1 fail RJ#9254 → fixed by the revert; affected files re-run green) (RJ#906, one r10401 todo from a cycle agent, the Beginning-Phase test);; tests/basics 2590 / 0 / 0.
  tsc clean.
- OPEN for ENGINE-9:
  1. Needs a decision: Beginning-Phase showdowns. DECISIONS #11019 (CR 323.11, "no phase condition") vs verified RJ#9254 (r9101.md:
     "staged, starts in Action Phase", MATCH). If #11019 wins: add 'awaken','beginning','channel','draw' to cleanup.ts STAGE_PHASES,
     un-todo tests/rules/staged-phases.test.ts, rewrite r9101 RJ#9254. game.ts advance (HIDDEN-IDS-owned during ENGINE-8) also needs its
     non-action-phase start moved before the turn tasks for the cases no cleanup covers.
  2. ENGINE-7 item 4: rules-decisions #66 tie-break (payment.ts `domainKeepScore`) should count [C]/domain power in legend and
     activated-ability costs on the board (not the deck); keep tests/basics green.
  3. Optional: the "apply silently when the order can't matter" rule for non-combat damage replacements (applyReplacements; restricted
     to combat because r1301 RJ#2378 pins a chooseOrder for two Ravenborn Tome bonuses, which commute). Needs a lead call first.
  4. Fuzz run (200 games) after these changes: not run.
## 2026-11-26 — ENGINE-9 agent (standing fixer + Rift Judge adjudicator, finishing phase)
- Batch 1 (ENGINE-8 OPEN items):
  - RJ#11503 (DECISIONS #11503, CR 373.1): actions.ts `kill` sorts simultaneous deaths by their controllers' turn order from the TP
    (stable) before applying replacements, so the turn player's Altar of Blood "pay [A][A][A]" choice is asked first; #46 (one
    player's several deaths → that player picks the first) unchanged. r10401 RJ#11503 un-todo'd; FINDINGS RJ#11503 lines FIXED;
    rules-decisions #76.
  - OPEN 1, Beginning/Channel/Draw-phase showdowns: DECIDED (DECISIONS #9254, principle 27) from CR 308-310 ("At any given time" the
    turn is in one of four states defined only by showdown/combat and chain; riftlens /rules/states-of-the-turn/) + CR 323.11/323.12
    (no phase condition) + CR 315 (start-of-turn phases are only tasks): a staged showdown begins at the first Neutral Open moment in
    any phase. Verified RJ#9254 ("the Beginning Phase is not a Neutral Open State") → MISMATCH-RJ. cleanup.ts `STAGE_PHASES` +=
    awaken/beginning/channel/draw (exported; `stagedMayBegin`), game.ts `advance` starts staged showdowns in those phases before
    the remaining turn tasks. tests/rules/staged-phases.test.ts Beginning-Phase test un-todo'd; r9101 RJ#9254 rewritten (showdown in
    the Beginning Phase); r9101.md row → DECIDED; FINDINGS DECIDED-ENGINE RJ#9254 (FIXED); rules-decisions #75 updated.
  - OPEN 2 (#66 tie-break): payment.ts `domainKeepScore` also counts [C]/domain power in activated-ability costs (not Add) of the
    player's units/gear/legend on the board. New test in tests/rules/engine7-payment.test.ts (Vi "[2][C]" keeps a Fury rune).
  - r*.md hygiene: rows 1147 (r0001), 2385, 2412 (r1301), 6584 (r6501) already decided by DECISIONS rows got "→ DECIDED (#row)".
  - WebFetches used: 4 (RJ#9254, riftlens start-of-turn, rules index, states-of-the-turn).
  - Suite (per file, 109 files): 6244 pass / 0 fail / 1 todo (RJ#906); tests/basics 2590/0/0; tests/ai 91/0/0; tsc clean.
- Batch 2 (FINDINGS poll 16:40; new cycle-agent findings):
  - RJ#12659 / RJ#12660 (SCRIPT unl-087 Blue Sentinel): its extraTriggers rule ignores hold events Skyfall of Areion synthesised for a
    conquest (`fromType === 'conquer'`) — "for holding here" only. r11701 tests un-todo'd.
  - RJ#7770 (ENGINE payment.ts): converter Adds while paying (rules-decisions #77). `ActivatedAbility.convert: 'energyToAny'` (set on
    sfd-117 Ancient Henge); autoPay falls back to the least n Energy → n [A] through one ready converter when nothing else pays;
    plan `other.convert` {key, n} accepted by validatePlan and executed by executePayment (Henge exhausted, logged, `activated`
    event). Bullet Time with 3 runes (1 used for its cost) + Henge now offers 0-5. r6501 RJ#7770 un-todo'd, asserts 5 damage.
  - RJ#11565 (SCRIPT unl-200 Mirror Image): every Reflection the play produced (Zilean, Time Mage's extra copy) becomes a copy with
    [Temporary], as Deceiver (DECISIONS #9917). r10401 test un-todo'd.
  - RJ#12687 (SCRIPT ven-067 Bottled Constellation): the "kill 3" cost counts as paid when Soraka replaces the deaths (principle 22).
    r11701 test un-todo'd.
  - Decisions: #11573 (Rengar, Pouncing can't be played to a battlefield whose combat hasn't begun — RJ#299 kept, RJ#11573
    MISMATCH-RJ; CR 323.12, 466.2); sweep of older flagged rows never given a DECISIONS row: #11579 (aside), #6321 (nuance), #7755,
    #7759 (Possession half, house consensus), #7762, #7782 (example), #9072 (aside), #10238 (aside) — all confirm what the tests
    already assert; r*.md rows marked "→ DECIDED (#…)".
  - Suite (per file, 109 files): 6299 pass / 0 fail / 1 todo (RJ#906); tests/basics 2590/0/0; tests/ai 91/0/0; tsc clean except a
    cycle agent's scratch file tests/riftjudge/zz-tmp-r11701.test.ts (imports a non-existent harness export `playCostOf`; not ENGINE-9's).
- Batch 3 (poll 17:05):
  - RJ#10266 (ENGINE play.ts): a play "ignoring any and all costs" (`noAdditional`, only Bone Skewer) still offers the optional
    additional costs — script optional costs, Accelerate, Repeat (with its Make-Choices targets) — for free; chosen ones count as
    paid (CR 356 step 2, then step 5 total 0; rules-spec §2.5); mandatory ones stay unpaid (RJ#12433 unchanged). r9101 un-todo'd.
  - RJ#11631 (ENGINE/SCRIPT): `RuleAbility.copyInstance` (sfd-059 Svellsongur's copied-text extraTriggers rule) and rules.ts
    `extraTriggerCount` = (1 + copies) × (1 + additional times) − 1, used by events.ts (scripted and builtin triggers) and
    helpers/B2 alsoTriggerAs: every copy of a triggered ability is triggered the additional times too (Blue Sentinel + Svellsongur:
    6). r10401 un-todo'd.
  - Decisions (older/new flagged rows): #11599 (exception), #11606 (aside), #12749 (OUTDATED, Deploy), #6332 (aside); rows 11535
    (→ #10581 / principle 18) and 10274 (→ A-3) marked decided.
  - Suite (per file, 109 files): 6319 pass / 0 fail / 1 todo (RJ#906); tests/basics 2590/0/0; tests/ai 91/0/0; tsc clean (except
    the cycle agent's scratch zz-tmp-r11701.test.ts).
- Batch 4 (polls 17:25-17:50):
  - RJ#5092 (ENGINE actions.ts/play.ts, CR 354.4 / principle 5): a token played while a spell or ability resolves is placed at once,
    but its play event is emitted when the resolution finishes (after the spell's own play completed), so "when you play a spell"
    triggers (Lady of Luminosity) are met first and the tokens' Visions above them. The token keeps the batch it would have had
    (each token of "play four" its own batch — no new ordering prompts), and a reflexive "Then do this" that joined a token's batch
    (SF2-2) is moved with it (RJ#10519 Arise! unchanged). r3901 RJ#5092 un-todo'd.
  - RJ#12813 (ENGINE events.ts/chain.ts): `QueuedTrigger.costEpoch`; placeTrigger refuses a trigger whose "me" cost (exhaust /
    banish / kill / recycle self) refers to an object that became a new object before it finalized (Ravenbloom Prefect killed by
    Wages of Pain). r11701 un-todo'd.
  - RJ#12846 (ENGINE context.ts + SCRIPT ven-136): `ctx.sourceSame()` (trigger items store the source's epoch at trigger time);
    Ambessa, Respected and Feared's attack kill does nothing after she was Temporal-Breached (principle 17, #64). r11701 un-todo'd.
  - Decision: #11640 (Unyielding Spirit vs Imperial Decree: prevented damage is never taken → no kill; MISMATCH-RJ).
  - Suite: 6415 pass / 0 fail / 1 todo (RJ#906); tests/basics 2590/0/0, tests/ai 91/0/0 (run after RJ#12813; re-run below).
- Batch 5 (poll 18:00):
  - RJ#12864 (SCRIPT rad-115 Transpositionist): the "you may play a unit with less Might" instruction runs even when the return
    is replaced (empowered Gangplank, Naval stays at 9 → units below 9). r11701 un-todo'd.
  - RJ#12875: not an engine bug — the Breached gear already comes back a plain Gear; the test compared mightOf (Long Sword's card
    Might is its +2 bonus). Test now asserts the type; un-todo'd.
  - Decisions: #12821, #12834, #12841, #12850, #12851/#12853, #12858/#12860, #12864, #12883, #12895, #12896 (r11701 "uncertain
    answer" rows the cycle agent adopted — confirmed with CR/card-text reasoning), #1235, #3775, #5100; 2538 → #8355.
  - Suite: 6432 pass / 0 fail / 1 todo (RJ#906).
- Batch 6 (poll 18:30, after a session restart):
  - RJ#1292 (ENGINE chars.ts + SCRIPT ogn-079 Leona, Zealot): static "-N, to a minimum of F" (StaticMods `might` < 0 with
    `mightFloor`) are applied last and together, limited over their total (never below F, never raising a lower Might); Leona is
    now { might: -8, mightFloor: 1 } — two Leonas: 12 → 1 (was -4). RJ#5249 unchanged. r0001 un-todo'd.
  - RJ#12904 (ENGINE play.ts): when an as-play effect redirects the entry (Baron Nashor → Baron Pit) the chosen destination is kept
    (`playData.__chosenDest`) and enter-ready play rules may apply for it (The Exile). r11701 un-todo'd.
  - Decisions: #12904/#12907, #12906, #12916 (aside), #1292.
  - Suite: 6472 pass / 0 fail / 1 todo (one transient failure of r9101 RJ#10356 during a concurrent cycle-agent edit; the file
    re-run alone: 510/0); tests/basics 2590/0/0; tests/ai 91/0/0; tsc clean.
- Batch 7 (poll 18:40):
  - RJ#10371 (SCRIPT unl-142 Heedless Resurrection): a replaced cost kill (Zhonya's) leaves no killed unit → the play instruction
    does nothing (as Baited Hook, #4295). r9101 un-todo'd.
  - RJ#12994 (ENGINE showdown.ts + SCRIPT rad-156 Demacian Standard): new `unitsAttack` event {units, bf, player} each time units
    newly gain the Attacker designation (incl. Ambushed later); player-level `playerAttack` unchanged (once per combat). r11701
    un-todo'd.
  - Decisions: #12935, #12937, #12945, #12992 (aside), #10380 (aside).
  - Suite: 6511 pass / 0 fail / 1 todo (RJ#906); tests/basics 2590/0/0; tests/ai 91/0/0; tsc clean.
- Batch 8 (poll 19:00):
  - RJ#13033 (SCRIPT sfd-109 Akshan, Mischievous + rad-146 The Ball): Akshan's move of the stolen gear counts as made before he
    controls it (`turnFacts.__movedBeforeControl` during the move); The Ball's "when you move this" ignores it → no trigger for
    either player. The test's hand-count assertion was off by one (corrected). r11701 un-todo'd.
  - Suite: 6522 pass / 0 fail / 1 todo (RJ#906); tests/basics 2590/0/0; tests/ai 91/0/0; tsc clean.
- Batch 9 (poll 19:18):
  - RJ#13071 (ENGINE cleanup.ts, CR 107.3.b.2): when a controlled battlefield's facedown maximum (1 + extraHide) drops below the
    number of hidden cards there (Bushwhack Trap left the board), its controller chooses and trashes the difference (not a kill).
    The last maximum is kept per battlefield (`fdMax`, only set while above 1), so only a real drop does it. r11701 un-todo'd.
  - Suite: 6541 pass / 0 fail / 1 todo (RJ#906); tests/basics 2590/0/0; tests/ai 91/0/0; tsc clean.
- Final (19:50): FINDINGS has no open MISMATCH-ENGINE / DECIDED-ENGINE line (except RJ#906, 2v2 invite, out of scope); no flagged
  r*.md row without "→ DECIDED" or a DECISIONS row. Suite (per file, 109 files): 6554 pass / 0 fail / 1 todo (RJ#906);
  tests/basics 2590/0/0; tests/ai 91/0/0; tsc clean. WebFetches used: 4.
- OPEN after ENGINE-9:
  1. ENGINE-8 OPEN 3 (apply non-combat damage replacements silently when their order can't matter) — still needs a lead call
     (r1301 RJ#2378 pins the chooseOrder).
  2. Fuzz run not done (lead: no fuzz). Worth one 200-game run after this phase: ENGINE-9 touched turn flow (start-of-turn
     showdowns), token play-event timing, payment (converter Adds), extra-trigger counting and the cleanup (facedown maximum).
  3. Token deferral (RJ#5092) defers only the token's play EVENT; the token itself is on the board during the rest of the
     resolution (scripts keep their references). Fully deferring token entry (CR 354.4) would need every token-making script to
     use ctx.playedObj-style references.

## 2026-11-26 — VIDEO-CHECK
- Added tests/rules/video-5-interactions.test.ts: the five interactions from HyBriiD's "5 Riftbound Interactions That Make
  No Sense", built from real cards (Soraka, Wanderer vs Unchecked Power; Bombs vs fully empowered Kayle, Justified with
  Deflect 3 — decline and pay variants; Kha'Zix, Mutating Horror vs Fiora, Peerless with Ambush units added in response;
  Elder Dragon defending vs 12 Might of attackers; Star-Crossed on Akali, Silent answered by Flash). All 6 tests passed on
  the first run; no engine or script changes were needed.

## 2026-11-26 — ENGINE-10 (engine fixer + Rift Judge adjudicator)
- RJ#13329 (ENGINE actions.ts, CR 808.1.d.1): `kill` moves each dying permanent with the new `toTrashEx` ('trash' | 'replaced' |
  'gone'; `toTrash` unchanged for callers); when a replacement keeps it out of the trash (Endless Riches banishes it) its queued
  Deathknell triggers (any `deathknell` ability, printed or granted, from that object's `die` event) are removed and logged. Other
  "when … dies" triggers stay. r13301 un-todo'd; DECISIONS #13329; rules-decisions #78.
- RJ#13152 (SCRIPT rad-163 Hunters' Circle): token plays (a Bomb) use up "the first unit or gear they play here" (the `!ev.token`
  filter is gone; "create" emits no play event). r11701 un-todo'd.
- RJ#13165 (SCRIPT rad-167 Neeko, Blending In): "while I'm on the board" is a duration — the added legend is set aside by a
  bookkeeping listener as Neeko's leaveBoard event is emitted (no chain item), so a Temporal Breach replay can pick it again, ready.
  r11701 un-todo'd.
- Adjudicated (DECISIONS rows 13328, 13331, 13375/13317, 13153 aside):
  - #13328 Dancing Grenade never leaves the chain while replayed (HOUSE: its own "this spell has dealt damage this turn" clause needs
    the same object, CR 124.1; CR 354.4). unl-020 asks the replay while it resolves and sets `item.choices.replayAgain`; chain.ts
    resolveTop doesn't trash it and, after the resolution, plays it again from the chain for [A] (play.ts keeps state for a
    chain→chain move: same object/epoch); trashed (or Fizz-recycled) only when the loop stops; hit count keyed by id+epoch.
    rules-decisions #80. tests/cards/B5/unl.test.ts Dancing Grenade adapted (the 6-damage unit now dies in the cleanup after the
    replay question, which is asked mid-resolution). RJ#11581 (r10401) main answer kept, trash detail superseded.
  - #13331 Call to Battle: the destination chosen at play stands when my unit target is Gusted; the opponent still moves a unit
    there (CR 355.4, 359.3.e.14). Script reads the raw destination (must still be a battlefield I control).
  - #13375 / #13317 "[1] or [A] less": the payer chooses. helpers/B8 `costModOneOrA` (either-discount) now used by sfd-149 Ezreal
    (additional + repeat scopes) and sfd-141 Irelia, Graceful (play scope, existing B8-6 prompt); play.ts `modVariants` /
    `pickVariant` offer every affordable variant for optional additional costs, Accelerate and Repeat ("Pay [1] or M to Repeat?",
    then "Which cost reduction?" only if 2+ are affordable). r13301 RJ#13317 adapted to the prompt. Not done: ven-163 (Empower
    scope, activated-ability cost path) still takes the [1] (rules-decisions #79).
  - #13153 (aside) Heimerdinger, Inventor's copy of a Seal's [C] is his own domain (Mind), not Chaos — engine already did this;
    r11701 RJ#13153 now pins it. RJ example → MISMATCH-RJ.
- Fuzz (tools/fuzz.ts --games 200 --seed 1026 --workers 2): 200 games (199 finished) in 132 s, 1 signature, 0 new repros — the
  known d09ae46bc6 "attached but not at host location" recurred (seed 1123): Keeper's Verdict (`ctx.toDeck`) moved an equipped unit
  into the deck without detaching its gear. Fixed generically in context.ts: `toDeck` / `toHand` / `toZone` detach a board
  permanent's attachments first (`detachLeaving`). Seed 1123 now plays out clean; new tests/rules/engine10.test.ts pins it.
  docs/fuzz-report.md regenerated by the tool.
- FINDINGS: RJ#13152, 13165, 13328, 13329, 13331, 13375 marked FIXED / DECIDED; r13301/r11701/r10401 rows marked.
- WebFetches used: 8 (cardsrealm Dancing Grenade, UNL patch notes ×2, RJ#13328, OGN FAQ ×2, riftlens index + /rules/domain/) — no
  official text for #13328 or #13153; both decided as HOUSE.

## 2026-11-26 — GPU-SETUP (first run of the PyTorch code on a real GPU: home PC, WSL2, RTX 5070 Ti)
- `scripts/setup.sh` and `scripts/smoke.sh` pass first time (torch 2.10.0+cu128, sm_120, bf16). Model, trainer and
  torch inference backend needed no changes. An 11-minute rehearsal of `config/train.yaml` (14 workers, small model)
  ran with 0 errors / 0 restarts at 553 games/h, GPU mostly idle (numbers in TRAINING.md §9); an eval vs
  searchai/best/bot ran on the GPU.
- elo.py: `elo_from_score` clamped the score to [0.5/n, 1-0.5/n], so any 1-game result was exactly 0 Elo; it now uses a
  half-game prior ((s*n + 0.5)/(n + 1)). `elo_interval` used the Wald interval, which has zero width at 0/n (a 0-16
  eval vs SearchAI showed as -597 [-597, -597]); it's now a Wilson score interval. Test: `test_elo_extreme_scores`.
- export.py: the dynamo exporter always failed (`onnxscript` missing), so every export silently used the deprecated
  TorchScript one, whose file only works at the traced shape (Reshape in the attention layers). The onnxruntime check
  only used the all-zero export dummy at that shape, so it passed. Now: `onnxscript` + `onnxruntime` are in
  requirements.txt; the check also runs random inputs at another shape; the export goes to a temp file and replaces
  the old one only once it verifies; the dynamo export is one self-contained file (`external_data=False`).
- CLAUDE.md: the Python test command is pytest (`unittest discover` found 4 of the 23 tests).
- Training deck pool: `config/train.yaml` now uses Jonathon's lists in `decks/` (home-azir, home-vex, home-rek-sai,
  home-mordekaiser; transcribed from screenshots, main + runes + battlefields, sideboards left empty because self-play
  doesn't use them) in place of 01-azir / 02-vex / 04-rek-sai / 06-kai-sa. All four pass `validateDeck`, every card
  with rules text is scripted or keyword-only, and 3 minutes of GPU self-play + evals with the pool had 0 errors.
- Pre-run review (before home-1):
  - Paired evals: `pairedDeals` (src/ai/selfplay/decks.ts) gives games 2j/2j+1 the same decks, seed and first
    player with seats swapped; every opponent gets the same deals. Test: tests/ai/selfplay/decks.test.ts.
  - Evals count timeouts (`timeouts` column in elo.csv) and break results down by matchup (`byMatchup` in
    eval/step-N.json). Self-play workers keep per-pairing win counts that survive restarts; `status.sh` prints deck
    win % and `--matchups` lists every pairing.
  - tests/ai/selfplay/server.test.ts uses `.venv/bin/python` when present (its 5 TS↔Python tests were always skipped
    on a machine without system numpy).
  - config/train-epyc.yaml uses the same four decks.
  - Battlefields stay `random` (CR 485.3 duel) in self-play. KNOWN ISSUE before switching to `choose`: the first
    player's private pick lives in `ex.unit.actions`, which `determinize()` copies, so the second player's search
    would see it. Resample it in determinize (with a leak test) first.
  - Stop/resume with a different worker count tested on the GPU (trainer step and deck stats carry over).
- home-1 started 2026-11-26 23:26 on the home PC (tmux session `train`: window 0 = launcher, window 1 = dashboard).
- Training dashboard: `scripts/dashboard.sh` (python/riftzero/dashboard.py + dashboard.html, stdlib server, no
  external assets, localhost only). Elo per opponent with 95% bands, losses/entropy (raw + EMA), throughput, deck
  win %, matchup matrix, latest eval by deck, eval history; table views, keyboard crosshair, light/dark. Palette is
  the validated default (3 slots, both modes). Tests: python/tests/test_dashboard.py.

## 2026-11-27 — home-1 stopped, handover to the EPYC
- home-1 stopped cleanly at 14:12 after 14 h 46 m: 14,203 games, 480k positions, 7,500 trainer steps, value loss
  0.99 → 0.335.
  - Evals at 1,500 / 3,000 / 4,500 / 6,000: 0–16 against SearchAI every time; 1, 2, 4 and 1 wins out of 16 against
    the rules bot; it beat the previous checkpoint up to step 4,500 (8–8 at 6,000).
  - Summary, evals, metrics and config are in `docs/runs/home-1/`. Checkpoints and shards stay on the home PC.
- Found at the stop: an interrupted `runs/smoke` run had left its trainer, inference server and 2 workers running
  for the whole of home-1 (about 2 cores). They were killed. CLAUDE.md now says to check `pgrep` before starting.
- Two engine errors, both Mordekaiser vs Rek'Sai: `no legal options for chooseTargets (all rolled back)`. Every
  offered target leads to a payment-failure rollback. Seeds are in `docs/runs/home-1/errors.jsonl`. Not fixed yet.

## 2026-11-27 — epyc-1 started on simulation-server
- `scripts/setup.sh` and `scripts/smoke.sh` pass on the EPYC (Ubuntu 24.04, torch 2.10.0+cu128, all smoke checks).
- The box has one RTX 3060 Ti 8 GB (sm_86, bf16 ok), not the several 5070 Tis `config/train-epyc.yaml` assumed:
  `inference.gpus` is now `[0]` (2 servers × 0.30 memory); the trainer shares that GPU.
- Throughput sweep (5 min each, trainer off, inference evals/s): 60 workers 3,967; 120 → 5,137; 192 (4 servers) →
  5,181; 240 (4 servers) → 5,191. 120 workers with the `small` model: 4,377 (GPU 39% busy). So neither SMT threads
  nor the GPU are the limit: past ~120 workers per-worker speed falls as fast as workers are added. Likely shared
  CPU resources (Zen 4c has 2 MB L3 per core; all-core clock ~2.6 of 3.1 GHz) on an allocation-heavy engine. The
  lever for more games/h on this box is engine speed (`computeChars`, `structuredClone`), not more workers.
  Workers stay at 120 (~3,700 games/h).
- Checkpoint cadence: `train.ckptEverySteps` 1000 → 250. With batch 1024, 1,000 steps ≈ 256k positions (~2 h of
  self-play on one stale net; home-1 refreshed every 32k). 250 ≈ 64k positions (~30 min). `keepCheckpoints` 100,
  `eval.everyCheckpoints` 2 → 6 (every 1,500 steps ≈ 384k positions; an eval takes about an hour).
- Checked in the home-1 data: policy loss ≈ policy entropy at every step is *not* a sign that the search target
  equals the prior. Search targets on epyc-1 shards are much sharper than uniform even from an untrained net
  (mean target entropy 0.86 vs log(options) 1.33).
- Dashboard: runs on the tailscale address (`scripts/dashboard.sh --config config/train-epyc.yaml --host
  $(tailscale ip -4)`), http://simulation-server:8050 from any tailnet device. Without `--config` it shows home-1.
- A third `no legal options for chooseTargets (all rolled back)` error (Rek'Sai vs Mordekaiser, seed 49036357,
  firstPlayer 0), about 1 in 800 games on the EPYC.

## 2026-11-27 — simulation-server crash: DIMM heat, thermal guard
- 15:28: the box hard-crashed during epyc-1 (60 min of near-full CPU load; trainer not yet started). Nothing in the
  journal; on reboot the firmware reported a fatal hardware error from the previous boot (BERT, locator `P0MC0`,
  most likely socket 0 memory controller 0). No corrected ECC errors before or since.
- The BMC event log had been full since 2026-06-29 (FAN7 drops to 0 RPM for ~3 s, ~1,750 times), so the crash was
  not logged there. Before that it recorded DDR5 sticks B1/C1/H1/I1 reaching 85 °C (critical) under load on
  2026-03-22 and 2026-05-24. Leading explanation: DIMM overheating under sustained memory-heavy load (the engine is
  allocation/clone heavy). The M.2 SSD (Micron 7450) also runs hot (83–87 °C hottest sensor at idle, never throttled).
- Temporary fix: side panel off and a fan on the DIMMs (idle DDR5 35–42 → 24–28 °C, M.2 67 → 37 °C).
- `~/hw-setup.sh` (outside the repo) cleared the SEL and added a root cron logging all temperature and fan sensors
  every minute to `/var/log/hwtemps.log`. `~/thermal-guard.sh` runs in tmux window `guard`: it stops training
  cleanly if any DDR5 ≥ 80 °C, CPU ≥ 90 °C or M.2 ≥ 78 °C (log in `~/thermal-guard.log`).
- epyc-1 restarted 15:56 at 60 workers (77 % of 120-worker throughput for about half the load), to step up while
  DIMMs stay under ~75 °C.

## 2026-11-27 — epyc-1: trainer OOM on the 8 GB card; batch 256
- The trainer crashed with CUDA out-of-memory as soon as it reached minPositions (16:24, again at 16:26): batch 1024
  with the `medium` model needs over 6.5 GB, and the two inference servers hold up to ~4 GB. Measured trainer peak
  (bf16, medium): batch 256 1.5 GB, 384 3.0 GB, 512 4.4 GB, 768 6.4 GB.
- `config/train-epyc.yaml`: batchSize 256, lr 3e-4, warmup 500 (home-1's settings), ckptEverySteps 500 (≈32k new
  positions per self-play net), eval every 12 checkpoints (≈384k positions), maxTurnsAnneal 20k→60k steps (as home-1),
  inference.memoryFraction 0.25.
- Resuming restores the optimizer/scheduler from the checkpoint, so a changed `train.lr` does not apply to a resumed
  run. epyc-1's one-step checkpoint was moved to `runs/epyc-1/ckpt.oom-2026-11-27` and the trainer started fresh
  (its 64k self-play positions were kept; none had been trained on).
- `scripts/start.sh` exports `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True` (unless set): with variable-size
  batches the trainer had reserved 4 GB of CUDA cache for a 1.5 GB working set.
- epyc-1 runs at 120 workers again (DIMMs 52 °C at 60 workers, 58 °C at 90, with the desk fan).

## 2026-11-27 — Engine speed: 1.53x engine, 1.84x self-play (branch perf/engine)
No behaviour change: every optimisation was checked against golden traces recorded on the unmodified engine.
`tools/perf-golden.ts` / `tools/perf-golden.sh` hash, after EVERY action, the full state (sorted keys), the events,
the pending player's legal actions and both players' views (fuzz games, random decks from the whole pool, random /
chaos / bot policies), plus every recorded self-play position (factored env + Gumbel search + determinisation,
uniform evaluator). Final: 2,792 games (664 on seeds used while optimising + 2,128 on fresh seeds) all identical.
Full suite identical to main (9,403 pass; the same 18 environment failures: Playwright browsers / `sharp` not
installed on simulation-server, and the RJ#906 todo). `tools/fuzz.ts --games 1500 --seed 7`: identical on both trees
(212,700 actions, same 2 known signatures, 0 new repros), 297 s vs 419 s.
- `clone` (engine/util.ts, also used by determinize): a structuredClone-compatible deep copy for plain state data
  (undefined-valued keys kept; objects reachable by two paths stay shared — the state relies on that, e.g. a chain
  item's `choices.paid` and `choices.playEvent.paid`; anything else falls back to structuredClone). ~1.8x faster than
  structuredClone. `tools/perf-state-shape.ts` lists what the state actually contains.
- applyAction: the replay base of a new top-level action shares the (immutable) input state instead of deep-copying it
  (one deep copy per action instead of two). Relies on the documented contract that callers never mutate a state
  after passing it to the engine.
- `mayHaveGrantedAbilities` (chars.ts): exact superset test; when nothing on the board can grant or copy abilities
  (72% of meta-deck states), `grantsOf` skips evaluating statics and `activeRules` reads a per-script rule index.
- `memoInScope` (chars.ts): memoises pure reads for the rest of a read-only scope (withCharsMemo: legal enumeration,
  validation, rule checks), under the chars memo's own conditions. Used for `destinations`, the board part of
  `playRules`, `unitsAtLoc` / `allUnits`, `domainKeepScore` and `addSources` (each was recomputed many times per
  enumeration: a unit's destinations ~7 times).
- Measured A/B, alternating on the same box: self-play games 1.84x, engine-only fuzz games 1.53x. Remaining profile
  is flat (clone ~14%, then nothing above ~4%).

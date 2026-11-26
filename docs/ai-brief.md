# AI pilot project brief (lead, 2026-11-26)

User requirement: before any meta-tournament winrates are reported, the AI must pilot EVERY one of the 20 decks
(data/meta-decks/*.json, docs/meta-decks.md) the way a competent tournament player would. Azir won the source tournament
(Demacia League Bologna, Nov 2026) but our AI wins ~7% with it — that is an AI failure, not a deck fact. Results that mostly
measure AI blind spots are "useless information" to the user.

Current AI: src/ai (search.ts, eval.ts, determinize.ts, index.ts — ~585 lines). 1-ply search over candidate actions with greedy
settling via the engine bot, determinized hidden info, step budgets. Known weaknesses: docs/meta-sim.md "AI notes" (no multi-step
turn plans, rune/power economy, never hides, Weaponmaster churn, go-wide boards over-valued vs synergy plans).
Tools: tools/sim-lib.ts, tools/meta-sim.ts (+ meta-sim-snapshot.sh — ALWAYS run sims on a snapshot), tools/ai-bench.ts.
Machine: 2 CPU cores shared by ~10 agents — keep sims small and targeted (≤ 8-minute foreground chunks), prefer scenario tests.
WebFetch budget: 800/hour shared with Rift Judge agents — use ≤ 60 fetches/hour per agent.

## Ownership
- AI-CORE agent: src/ai/core/** and the existing src/ai/*.ts (search, eval, determinize, index), tools/ai-*.ts, tests/ai/core/**.
  Must publish the deck-plan interface in src/ai/plans/types.ts + docs/ai-plans.md within its first ~30 minutes.
- PILOT agents: src/ai/plans/<legend>.ts (one file per legend they own), tests/ai/plans/<legend>.test.ts, docs/ai-pilots/<legend>.md.
  Never edit core files; request core features in docs/ai-requests.md (one line each, tagged with the agent name).

## Definition of "can pilot" (per deck) — all required before the full tournament
1. Game plan written down (docs/ai-pilots/<legend>.md) from real sources (guides, deck techs, tournament reports: riftmana,
   mobalytics, cardsrealm, piltoverarchive, riftdecks, YouTube/written deck techs), with source links: win conditions, key cards,
   mulligan keeps, curve/turn-by-turn priorities, combos & sequencing, when to hide what, how to use the legend, matchup notes
   for the other legends in the field.
2. Competence puzzles: ≥ 8 scenario tests per legend (tests/ai/plans/<legend>.test.ts) where a strong player's best move is
   clear (e.g. Azir: play exactly one Equipment then use the legend for a Sand Soldier, Weaponmaster-attach, attack with Azir
   pulling Soldiers in; hide Guards! with open mana; lethal/final-point lines; don't overpay [C]). The AI must find the move.
3. Mechanic-usage metrics from logs over ≥ 40 games (e.g. Soldiers made per game, equips, hides used, legend activations,
   average runes by turn 8) are in a sane range compared with the written plan.
4. Strength: deck piloted by the new AI beats the same deck piloted by the old bot ≥ 70% (≥ 60 games, both seats).
5. Sanity vs reality: rough consistency with real-world results (Azir won Bologna; use riftdecks/other meta stats if available).
   A deck under ~35% overall in pilots needs a written explanation backed by watched games, or more work.
Only then does the lead run the 20-deck round robin.

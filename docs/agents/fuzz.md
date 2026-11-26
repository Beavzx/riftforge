# FUZZ agent notes (branch agent/fuzz)

## 1. Fuzz run (CHANGELOG open item 2)

`node --import tsx tools/fuzz.ts --games 200 --seed 700001 --workers 1 --minutes 45`
→ 200 games (199 finished, 27,991 actions, avg 19.6 turns) in 332 s. **0 new repros.** Checks: 96,960 illegal probes
rejected, 4,081 legal probes applied, 2,059 enumeration checks, 1,651 JSON round-trips, 4,362 view/redaction checks, no
hidden-info leak, no throw, no invariant failure. Two known SOFT signatures only:

- `79376ab89a` long-game (seed 700008, Cosmic Vista): a random-policy game passed the turn cap. Not a bug.
- `4cd09eb45b` bot-loop (seed 700039, Smite + Trusty Ramhound). Triaged: **not an engine bug.** P0 has only Order runes;
  Smite costs [2][A] and is affordable only through Sandswept Tomb ("each spell that chooses one or more friendly units
  here costs [A] less"). So `playCard Smite` is correctly listed, targets at the Tomb pay, and targets elsewhere
  (Hunting Dog, Trusty Ramhound at The Candlelit Sanctum) are legal choices whose payment then fails → rollback (CR: an
  unpayable play is reversed). The heuristic bot's F-3d guard skips the undone play right away, but after another action
  clears `__rolledBack` it can try Smite again with the same unpayable target. That costs it a wasted action, not a stuck
  game.
  **Relevance for RL:** in-step target lists can contain options that roll the whole play back. The factored action
  layer / RL env should treat a `rollback` event as an invalid action (mask it, or probe options with applyAction and drop
  those that roll back), and must not count it as a step of progress. Left the engine unchanged (rules-correct); the
  bot could probe its chosen target for payment, which is a small optional bot.ts improvement.

## 2. RJ#13328 (the one real failure in the baseline suite)

`tests/riftjudge/r13301.test.ts` had a test for a new ruling whose engine change was never made (docs/riftjudge/r13301.md
stops at 13326). Ruling: Dancing Grenade replayed for [A] **never leaves the chain** during the loop. The engine scheduled
the replay as a delayed trigger on `spellResolved`, so the grenade was trashed and then played again from the trash.

Fix:
- `src/cards/scripts/batch-B5.ts` (unl-020-219): the replay is now part of the spell's own resolution. The target's
  controller may pay [A] and the grenade is played again from the chain (same object; the damage count still
  accumulates). The old `B5:replayForA` delayed ability is still registered so saved games that hold one still resolve.
- `src/engine/chain.ts` resolveTop: a spell that has a new spell item for the same object on the chain (it was played
  again by its own resolution) stays on the chain instead of going to the trash. The guard is restricted to
  `kind === 'spell'`. A reflexive item shares its source, but those are placed after this check anyway, so the
  restriction is defensive.
- `tests/cards/B5/unl.test.ts` Dancing Grenade: the third hit's lethal damage now kills the unit at the cleanup after the
  replay decision, because that decision is now inside the resolution. The test asserts damage 6 before "no" and trash
  after.
- New regression test: `RJ#13328 guard` (Disintegrate with its reflexive draw still goes to the trash).

## 3. Caps study (tools/caps-study.ts; caps lifted to measure)

| | games | turns p50 / p90 / p99 / max | actions p50 / p90 / max | main actions in one turn (max) | would hit 40 turns |
|---|---|---|---|---|---|
| uniform random | 100 | 21 / 46 / 95 / 95 | 182 / 338 / 902 | p90 10, max 12 | 10 % |
| SearchAI vs SearchAI (low budget) | 40 | 15 / 18 / 26 / 26 | 182 / 262 / 402 | n/a | 0 % |

Recommendations for RL self-play:
- **maxTurns 60** while the policy is near-random (40 would make about 10 % of early games draws with no learning
  signal), **40** once play is purposeful. Trained play finishes by about turn 26. Score a timeout as a draw (value 0),
  or as a small win/loss by point difference, but keep it clearly smaller than a real win.
- **maxActions 1500** as a safety valve (random max 902, AI max 402). 4000 is harmless but lets broken loops burn CPU.
- **maxMainPerTurn 40** (random max 12). 80 is fine too; it only guards against loops.
- Count a `rollback` event as an invalid action, not a step (see §1).

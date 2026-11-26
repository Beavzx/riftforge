# Meta audit (second pass, 2026-11-26, KAISA-AUDIT / META-AUDIT)

Scope: bugs only (rules correctness of the cards in the 20 Bologna lists, `data/meta-decks/*.json`, and engine invariants in
games between those lists). No AI-strength work. The first META-AUDIT pass (docs/CHANGELOG.md, "2026-11-26 — META-AUDIT
agent") already matched all 159 distinct cards to their scripts and added tests/cards/meta-audit/*.test.ts; this pass re-read
every card against its script with fresh eyes, Kai'Sa lists first, and fuzzed the meta matchups.

## 1. Card text vs script

159 distinct cards (legends, champions, main decks, battlefields; runes excluded), ordered by the number of lists that play
them. Method: `data/cards.json` text (and reminder text) next to the script in `src/cards/scripts/batch-*.ts`, checking costs,
damage amounts, targeting restrictions ("at a battlefield", "enemy", "friendly", "here", "up to"), timing (Action /
Reaction / Hidden), once-per-turn limits, spending restrictions, optional costs, and the DECISIONS rows that cover the card
(docs/riftjudge/DECISIONS.md).

Result: **no script or engine bug found.** All 159 match their text; the doubtful points are already ruled:

| Card(s) | Point checked | Verdict |
| --- | --- | --- |
| Daughter of the Void (Kai'Sa legend) | `[T]: [Reaction] — [Add] [A]. Use only to play spells.` | Pays a spell's power (and its Repeat cost); cannot pay units, Accelerate (unit purpose) or the hide cost (purpose `hide`). Exhausted runes can still be recycled for power — correct (Recycle doesn't need a ready rune). Tested. |
| Hextech Ray, Void Seeker, Sky Splitter, Lost to the Sands, Get Excited!, Hidden Blade, Rebuke, Gust | "a unit at a battlefield" | `unitAtBf` / `F.atBattlefield`; base units are not targets. Tested (Ray). |
| Sky Splitter | cost reduced by the highest Might among *my* units | own units only; tested 8 -> 5. |
| Noxus Hopeful | Legion: [2] less after another card | tested 4 -> 2 after Stupefy. Hiding is not playing (keywords.md). |
| Thousand-Tailed Watcher | -3 (min 1) to every enemy unit, this turn | base included, own units not, gone next turn; snapshot rule DECISIONS #1347/#1448. Tested. |
| Void Gate | +1 per damage instance from spells/abilities to units there | Falling Star 4+3 when one target is there. Tested. |
| Rockfall Path | units can't be played there (tokens neither) | gear can (Pillaged Armory, Edge of Night seen in fuzz/sim logs — correct). Temporal Breach on a unit there = banished for good (play impossible). Tested. |
| Frozen Fortress | 1 to each unit there at the start of *each* player's Beginning Phase | tested; DECISIONS #10958. |
| Time Warp | [10] + 4 Mind power, legend pays one | tested. |
| Defy | "costs no more than [4] and no more than [A]" | printed cost (CR 206, DECISIONS #8607/#7323): counters Hextech Ray, not Falling Star ([2] power) or Sky Splitter (printed [8]) even when it was cast for 1. Tested. |
| Temporal Breach | banish, owner replays at the same location ignoring cost; from facedown only "here" | replays own Empyrean / Tracker / Watcher play effects (seen in games), DECISIONS #12418. |
| Minefield | "put the top 2 cards ... into your trash" scripted as Burn 2 | equivalent: moving more cards than the deck holds burns out (rules-spec §9.3, "draw, burn, mill"). |
| Edge of Night | "attach it to a unit you control" restricted to units *here* | CR 811.1.d (a play effect from facedown chooses only at that battlefield). |
| Equipment (Doran's Shield, Soul Sword, Brutalizer, B.F. Sword, Hand Hammer, Eye of the Herald, Boots of Swiftness, Guardian Angel, Long Sword) | no `card(...)` entry | data-driven Equip [C] + Might bonus; band abilities in batch-B2.ts EQUIP map, tested in tests/cards/meta-audit/azir.test.ts. Weaponmaster with Equip [C] is paid in full (CR 821.1.c.3, DECISIONS "10503 re-check", MA-5). |
| Seal of Discord | no `card(...)` entry | `SEAL()` helper in batch-B2.ts (generic "[T]: [Reaction] — [Add] [C]"). |
| Inferna | keyword-only | Ambush + Assault 2 from data; tested in meta-cards.test.ts. |

New tests: **tests/cards/meta-audit.test.ts** (9 tests: legend payment and its restrictions, "at a battlefield", Sky Splitter /
Legion costs, Watcher, Void Gate + Smoke Screen minimum, Rockfall Path + Frozen Fortress, Time Warp cost, Defy vs the Kai'Sa
spells).

## 2. Invariant fuzzing of meta matchups

`tools/fuzz-lib.ts` got a meta mode: `FUZZ_META=1` makes `makeSpec` deal two of the 20 lists (uniform pairs, so the common
legends — Azir x4, Kai'Sa x4, Rek'Sai x3 — meet most) instead of random decks; the cheap policies (random / chaos / engine bot)
and every invariant of the normal fuzzer are unchanged, and the deck files are recorded in the spec (`meta`).

    FUZZ_META=1 node --import tsx tools/fuzz.ts --games 3000 --seed 424200 --workers 1 --minutes 6.5

| Run | Games | Finished | Actions | Signatures |
| --- | --- | --- | --- | --- |
| seed 424200 | 210 | 203 | 37,989 | 1 soft: `long-game` (7 games > 60 turns) |
| seed 525200 | 162 | 155 | 29,009 | 1 soft: `long-game` (7 games) |

Both runs are recorded in tests/fuzz-repros/_runs.json (note "META-AUDIT: FUZZ_META=1") and counted in docs/fuzz-report.md.

The `long-game` games were replayed: chaos/random policies that barely score (0-0 at turn 50 in a 07-kai-sa mirror, 0-5 at
turn 60 in 18-kai-sa vs 14-azir), decks and trash cycling normally — a policy artefact, not an engine stall. **No invariant
violation, exception, nondeterminism, redaction leak or validate/enumerate disagreement** in the meta matchups.

## 3. One AI-side bug seen while watching games (filed, not fixed — src/ai is out of scope)

`SearchAI` in-step targeting can pick its **own** unit for a harmful spell: `inStepCandidates` returns the legal answers
unsorted when there are at most k (2) of them, and `searchSimple` keeps the first on a tie. When the sampled world makes both
answers score the same (e.g. the opponent's sampled Defy counters the spell either way), the first legal option wins —
object order, often the caster's own unit. Seen once in 360 Kai'Sa damage instances (18-kai-sa vs 08-azir, seed 602,
turn 6: Hextech Ray on its own Bilgewater Tracker; the trace scored both targets 30.38; a fresh AI on the same state scores
11.5 vs 46.4 and picks the enemy). Filed in docs/ai-requests.md (KAISA-AUDIT).

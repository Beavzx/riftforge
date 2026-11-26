# Rift Judge verification

Goal (from the user): every rules question on Rift Judge (https://app.riftjudge.com) must get the same answer
from our engine as Rift Judge's verdict — except where Rift Judge contradicts the CURRENT official rules
(Core Rules 1.5 Radiance, official FAQs/errata), in which case official wins and the conflict is reported.

## Access
- Individual questions: https://app.riftjudge.com/questions/<id> (ids ~1..13000, dense). List/search pages with
  query strings fail for our fetcher; iterate ids. WebFetch prompt that works:
  "Give: question text, ruling text (full), verification status (verified/unverified), rules version/date, any card names involved."
- Each page lists "Related FAQs" (#ids) — duplicates of the same question; record them as duplicates.

## Per question
1. Skip (log as SKIP with reason) if: unverified, OR not about game mechanics (tournament policy, prizes, board layout,
   judge procedure, deck legality paperwork, overtime, product/release, translation). Deck-construction LEGALITY rules
   and mulligan/setup ARE in scope.
2. Classify the verdict into a concrete, testable claim. If it's general rules (priority, chain, combat, scoring…),
   check whether an existing test already proves it (grep tests/conformance, tests/rules, tests/cards, tests/puzzles,
   tests/riftjudge); if yes, cite the test name. If not, write a test.
3. Tests: tests/riftjudge/<agent-range>.test.ts, one `test('RJ#<id> …')` per question. Build boards with the
   conformance harness (tests/conformance/harness.ts: S0, put — accepts real card names/ids — control, addRunes,
   act, play/cast, answer, passAll, attackSetup, legal, rejects) and src/engine/testkit.ts; see tests/puzzles/chain-puzzle.test.ts
   for a full worked chain scenario with real Decisions. Use REAL cards (data/cards.json) when the question names them.
4. Outcome per question: MATCH (test passes), MISMATCH-ENGINE (engine disagrees and RJ is right per official rules →
   test with { todo: 'RJ#id: <what engine does wrong>' }), MISMATCH-RJ (RJ contradicts current official rules — cite the
   official source; test asserts the OFFICIAL behaviour), OUTDATED (RJ ruling predates a rules/errata change — cite),
   AMBIGUOUS (no official answer; RJ verdict adopted as the house ruling unless clearly unreasonable — test asserts it).
5. Log every id in docs/riftjudge/<agent-range>.md as a table row: id | status | question (short) | verdict (short) | outcome | test name / source.
   Update the log every ~10 questions so progress survives interruptions; on resume, continue after the last logged id.

## Rules
- Do NOT edit src/ (engine/scripts are being changed by other agents). Write only tests/riftjudge/<range>*, docs/riftjudge/<range>.md.
- Engine/script bugs: append one line per bug to docs/riftjudge/FINDINGS.md: `RJ#id | ENGINE|SCRIPT <card id> | what's wrong | expected (source) | test name`.
- Keep `node --import tsx --test tests/riftjudge/<range>.test.ts` passing (todos allowed). tsc clean for your files.
- Throughput matters (thousands of questions): keep WebFetch prompts short, skip fast, batch tests.

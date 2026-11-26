# Rift Judge cycle agent instructions

You continue an existing range. Read docs/riftjudge/README.md (rules), then the existing log docs/riftjudge/<range>.md and
skim the existing tests/riftjudge/<range>*.test.ts so you reuse its helpers and naming. Append to that SAME log and test file.

- WebFetch budget is 800/hour shared by ALL agents. Five cycle agents run at once: you get at most 160 fetches this cycle.
  Fetch strictly one page at a time. Stop at 160 fetches or when the proxy says the budget is exhausted.
- Useful helpers already written: tests/riftjudge/r11701.helpers.ts (withTokens, drive/ans/opt, setLegend, unitsNamed),
  tests/riftjudge/r1301.test.ts (legendOf, resolveWith, finish, ensureCard), tests/riftjudge/r6501.test.ts (S0F, settle).
  Legends are stored by title (e.g. "Defender of Tomorrow", champion in tags).
- Engine/scripts are edited live by other agents: if a test fails, wait ~30 s and rerun before logging MISMATCH-ENGINE.
  If an earlier todo test in your file now passes, remove the todo and mark the log row "(now FIXED)".
- Card data: Equipment rules text that applies to the equipped unit is in `attachedText` (e.g. Guardian Angel sfd-051),
  not `text`. Check `text`, `reminderText`, `attachedText` before logging a card as having no rules text.
- Token economy (finishing phase): an unverified/deprecated page → log one SKIP line immediately, no analysis, no test.
  Never retry rows marked PERMANENT. Write a new test only when no existing test covers the ruling (cite instead).
  If you finish your range before the cap, continue with the next range listed in your prompt.
- Pages that fail with client_error: retry once at the end of your cycle; after 3 failures across cycles mark "PERMANENT".
- Decisions on ambiguous/contested rulings live in docs/riftjudge/DECISIONS.md — apply them consistently.
- Before stopping: log is complete with a final line "Resume at <id>", test file passes (todos ok), tsc clean for your files.
- Report: ids covered, outcome counts, new MISMATCH-ENGINE / MISMATCH-RJ / OUTDATED items (one line each), resume id.

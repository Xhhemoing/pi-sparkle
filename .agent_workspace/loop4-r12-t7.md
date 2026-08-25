[Model: gpt-5.6-sol]

# Loop 4 Round 12 — R12-7

## Outcome

Report-only. I made no owned-test edit because the existing pins already fail on the prohibited route/shape mutations, and R12-1's early run-id print was not present in `src/cli/main.ts` during either census. Manufacturing another equivalent freeze would only duplicate coverage.

## Census

- Verified all three authorized paths exist before considering an edit:
  - `test/integration/cli/blocked-next.test.ts`
  - `test/unit/cli/doctor-routed-next-freeze.test.ts`
  - `test/unit/run/inspection.test.ts`
- At `2026-08-25T00:46:34Z`, the working tree was clean. `src/cli/main.ts` had no `onRunStarted` wiring or early tracked-run id print and no diff; its last committed change was `ac3faa37aaf788602c08ab3e1d7b1649e59019f5` at `2026-08-25T00:10:32+00:00`.
- At `2026-08-25T00:46:42Z`, the scoped paths and `src/cli/main.ts` were still clean.
- At `2026-08-25T00:47:01Z`, `src/cli/main.ts` and all three owned tests were still unchanged. The only concurrent transient was 15 additive lines in `test/unit/run/terminal-replay-statuses-freeze.test.ts`, owned by R12-9; I did not touch or test that file.
- At `2026-08-25T00:47:14Z`, `src/cli/main.ts` and all three owned tests remained unchanged. Concurrent edits were present in R12-9's `test/unit/run/terminal-replay-statuses-freeze.test.ts` and R12-2's `test/unit/tracking/independent-evidence-posture.test.ts`; the remaining untracked path was this R12-7 report.

Existing coverage is sufficient:

- `doctor-routed-next-freeze.test.ts` AST-censuses exactly five `DOCTOR_ROUTED_NEXT` entries in order and pins every route plus `GENERIC_FAILURE_NEXT` character-for-character. Its deletion mutant proves the census bites.
- `inspection.test.ts` pins the four keys `type`, `runId`, `status`, and `requiredEvidence`; its rich-child fixture checks both `Object.keys` and the whole object, so child/result detail cannot become a fifth key.
- `blocked-next.test.ts` pins the ordinary four-line routed prefix, exactly three `next:` lines, and the discard disclosure as `note:`. Reorder and fifth-`next:` mutants prove those checks bite.
- An early extra stdout run-id line on the tracked path does not alter any of these stderr routes or the inspect summary object. No successor test is needed unless R12-1 changes one of those frozen values.

## Verification

- Scoped ESLint on all three owned tests: PASS.
- Whole-tree `pnpm exec tsc --noEmit`: PASS.
- All three owned tests together, pass 1: PASS — 28/28.
- All three owned tests together, pass 2: PASS — 28/28.
- All three owned tests together, pass 3: PASS — 28/28.
- The test command emitted the pre-existing engine warning: repository requires Node `>=22.19.0`, environment has `22.14.0`; it did not affect any result.
- No full gate run.

No `src/**` edit, scratch file, checkout, commit, or push.

# PR #43 human conflict-review packet — 2026-09-20

Owner instruction 2026-09-20: human line-by-line conflict review before merge;
the written report does not substitute for the human gate. This packet assembles
the exact evidence to review; each section ends with a checkbox for the owner.

- Subject: PR #43 `hotfix(learning): provider failures never score as model FAIL + workflow governance`, head `7c908ee`, base main `fe25330`.
- The conflict review targets merge commit `2dc978d` (parents `9066b47` hotfix line / `fe25330` main) and its follow-up `7c908ee`.

## A. Five conflicted files (declared in the merge message) — resolution mode, verified 2026-09-20

| File | Resolution mode (diff-based verification) |
|---|---|
| `src/pi-adapter/pi-executor.ts` | **Clean take of main's side.** `git diff 2dc978d fe25330 -- <file>` = **0 lines** (merge result identical to main's `taskFailureForProvider` version; 57-line delta vs hotfix parent). Both sides synthesized UNOBSERVED + PROVIDER_ERROR — the invariant that matters is identical on both; no hand-mixed semantics. |
| `src/routing/failure-class.ts` | Main's enhanced classifier (429 → `provider`), not hand-mixed. |
| `src/routing/provider-retry.ts`, `src/routing/signals.ts` | Merged clean/auto per report; covered by pin tests below. |
| `docs/reports/2026-09-12-pending-local-review.md` | Both sides' facts retained; superseded prose kept as history. |
| `tasks/plan.md`, `tasks/todo.md`, `tasks/adaptive-plan.md` | Both sides' facts merged; authoritative closeout state kept (verified: merge-side todo adds SoL/trusted-execution sections on top of main's content; 52-line delta vs main, 100-line delta vs hotfix parent — superset, not replacement). |

Owner review checkbox: spot-read the merge diff `git show 2dc978d` for these files.

## B. The one observable behavior change — 429 classification

Old (main): `FAILED` + empty evidence + 429 summary → `environment`.
New (merge, `7c908ee` pins it): same input → `provider` (`PROVIDER_HINT`).
INVARIANT preserved either way: never a model-attributable FAIL.

Reconciliation test file `test/unit/routing/failure-class.test.ts` at `2dc978d`:

- Removed from main: `"FAILED with empty evidenceIds is environment, not model"` (the 429-specific case).
- Kept from main, verified present at line 142: `"FAILED with cited evidence still defaults to model when unlabeled"` — **non-429 model-attribution semantics untouched**.
- Added (hotfix/enhanced side): `"429 and transport errors are provider, even if the agent tagged MODEL_ERROR"`, `"maps protocol PROVIDER_ERROR to provider"`, and the reconciled comment at line 131 referencing main's `ed9a6e9` classifier.

Owner review checkbox: read lines 69–152 of that test file at head `7c908ee`.

## C. Census pin reconciliation (`7c908ee`)

`option-a-preconditions` census: main assigns the synthesized UNOBSERVED object to a
variable before the yield, so the source-form census sees only `<runtime>`; the
hotfix line's pin was updated with rationale in the test file. No behavior change —
test-only reconciliation.

Owner review checkbox: `git show 7c908ee -- test/` (two test files only).

## D. Independent verification evidence on record

- Author-run at merged head `7c908ee` (2026-09-17): focused 715/0, gate 2752/0/18, security + pi probes pass; hosted CI green (after the documented race-flake rerun, itself root-caused and fixed by `6ae179c`).
- Composite gate at `928995d` (PR #42 head, which includes the same lineage): 2772/0/18.
- The 2026-09-20 luna-fast review of PR #42 exercised the shared execution surfaces (`loop-artifact`, `command-policy`, `worktree-snapshot`) — adjacent, not a substitute for this review.

## E. Post-review owner actions

1. [ ] Owner completes A/B/C review checkboxes.
2. [ ] Owner merges PR #43 on GitHub (CI green on `7c908ee`).
3. [ ] After merge: confirm remote main, then proceed to native-branch PR (baseline `13f954e`, zero file intersection with PR #42 — verified 2026-09-20, comm output empty).

# Read-only evaluator candidate — verification record

## Identity

- Task/commit: S0-min read-only evaluator manifest candidate; uncommitted working-tree slice.
- Date and environment: 2026-09-25, Windows, `E:\Project\pi-sparkle`.
- Reviewer/owner: author-run implementation; independent reviewer and experiment owner remain open.

## Scope and acceptance

- Validate the A/B/C read-only manifest and all nested fields fail closed.
- Bind B and C to the same opaque routing snapshot and canonical routing/policy bytes.
- Keep A and B projection-off; C alone declares the recall-tool schema difference.
- Produce a detached, recursively frozen manifest record plus reproducible canonical JSON.
- Distinguish unavailable observations (`UNOBSERVED`) from malformed or drifted collection (`INVALID_COLLECTION`).
- Reject duplicate task identities within one arm and bind every pilot result to `manifestId`, `armManifestId`, and `taskId`.
- Refuse authoritative evaluator writes and any apply capability.

Non-goals: no Stage 0 approval, no owner freeze, no provider execution, no pilot run, no candidate application, no production authorization, and no cryptographic tamper-resistance claim.

## Commands

| Command | Result | Notes/evidence |
|---|---|---|
| `pnpm exec tsx --test test/unit/experiments/readonly-evaluator-manifest.test.ts test/integration/experiments/readonly-evaluator-freeze.test.ts` | `PASS` | 14 passed, 0 failed. RED first failed on missing result/ledger APIs, mutable freeze output, and missing route identity constraints. |
| `pnpm typecheck` | `PASS` | Combined workspace run after projection and D1 integration. |
| `pnpm lint` | `PASS` | Full repository ESLint. |
| `pnpm workflow:check` | `PASS` | 10 required files, 16 required headings. |
| `pnpm gate` | `PASS` | 2874 passed, 0 failed, 18 skipped; build passed. |

## Behavioral Evidence

- Changed behavior: empty budgets and non-canonical timestamps are refused; routing references must be opaque `route_v2_` locators; B/C routing tuples cannot diverge; only C may expose projection recall; frozen records are detached and recursively immutable.
- Regression covered by: unit manifest matrix plus integration mutation/refusal test.
- Independent verification source, if any: none yet. Author tests are not independent review.
- Artifact/revision/hash, if applicable: working-tree candidate on `codex/controlled-improvement-20260925`; exact-byte local-weak comparison per ADR-008, without a cryptographic hash.

## Risks and Gates

- Known limitations: task-attempt enforcement remains explicitly `not-implemented`; no pilot ledger persistence or provider execution is added by this slice.
- Human approval required: Stage 0 boundary owner approval, independent manifest review, and budget/data-transfer approval.
- Explicitly not closed: Stage 0 freeze, exploratory pilot, production apply, F6, F-PROD, and Outcome-supported status.

## Handoff

- Next action: rerun typecheck/lint/workflow checks after projection integration, then obtain an independent review before any owner freeze.
- Durable record links: [implementation plan](../superpowers/plans/2026-09-21-readonly-evaluator-freeze.md), [Stage 0 correction](2026-09-22-stage0-boundary-correction.md), [combined prior record](2026-09-22-projection-and-readonly-manifest.md).

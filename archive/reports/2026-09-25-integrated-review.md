# Corrected integrated slice — independent review record

## Identity

- Reviewer: independent read-only reviewer task `/root/integrated_slice_verify`.
- Record owner: coordinator.
- Review channel/method: multi-agent independent read-only review against the exact repository revision.
- Reviewed revision: `7d7cd59bb313f53c605d6e9988be910bfe5e3ec8`.
- Primary implementation revision: `8e7de99b3d3b196e3b23807d52e4f6b8b59d57dc`.
- Baseline under correction: `9b9fbeec`.
- Draft status/review bundle revision: `09bbee48b1d1c6be1ad60c5e09d001129f916d8d`.
- Provenance-bearing review record revision: `edc766b3a1176afab254f7bed9ad75a4ae62fe3c`.
- Date/environment: 2026-09-25, Windows, `E:\Project\pi-sparkle`.
- Verdict: **PASS** for the corrected current slice; no Critical, Important, or Minor findings.

This is an independent read-only review of the corrected native bridge,
projection boundary, D1 read-only diagnosis, persistence guards, and current
contract/status records. It is not the post-L2 final review and does not approve
or freeze Stage 0.

## Findings closed

- `Model.headers` is not read or copied into the native capability snapshot;
  dispatch returns to the unchanged host model and rejects provider/id drift.
- Final native summaries identify the canonical models actually assigned.
- Sensitive-path refusal uses the read tool's canonical root-relative target,
  including in-root junction aliases, `auth.*`, singular `secret/`, and `.ppk`.
- D1 cannot close a gap with empty or blank evidence references.
- Corrupt learned-routing state fails closed before run persistence or provider work.
- EventStore rejects foreign-run records, and unsupported bounded non-zero-offset
  JSONL reads fail closed.
- The controlling plan, active checklist, status matrix, and reports distinguish
  author candidates, this current-slice review, the future post-L2 final review,
  and the still-open Stage 0 owner freeze.

## Verification evidence

| Command/evidence | Result |
|---|---|
| `pnpm test -- --test-concurrency=1 test/unit/native/session.test.ts test/unit/persist/jsonl-offset.test.ts test/unit/pi-adapter/native-executor.test.ts test/unit/pi-adapter/observation-tools.test.ts test/unit/pi-adapter/worktree-coding-tools.test.ts test/unit/run/event-store.test.ts test/unit/run/inspection.test.ts` | Independent reviewer: 90 passed, 0 failed, 0 skipped |
| Independent `pnpm typecheck` | PASS |
| Independent `pnpm workflow:check` | PASS (`10 required files, 16 required headings`) |
| Independent `git diff --check` and `git diff --check 7d7cd59b..09bbee48` | PASS |
| Author `pnpm gate` on the implementation candidate | 2879 passed, 0 failed, 18 skipped; build PASS; cited from the author verification record and not independently rerun here |
| Author `pnpm security:probe` | 26 passed, 0 open findings, 0 refused waivers; cited from the author verification record and not independently rerun here |
| Author `pnpm pi:probe` | 4 PASS checks; cited from the author verification record and not independently rerun here |

The reviewer first attempted `pnpm exec vitest`, which is not this repository's
test runner and failed because Vitest is not installed. That non-applicable
attempt is excluded from product evidence; the repository's declared test
command above was then run successfully.

## Remaining gates

- B0 and D1 retain their task-level states (`ready-for-review` and
  `author-candidate-unreviewed`) until their owners apply the task acceptance
  criteria; this review does not silently advance them.
- S0-min requires an explicit owner/reviewer canonicalizer and host-outcome
  boundary decision. No `approvalEvidence` exists.
- L1, L2, and the post-L2 final review remain planned.
- Live-provider execution, exploratory pilot, production apply, R10/R11,
  F6/F-PROD, and Outcome-supported evidence remain open.

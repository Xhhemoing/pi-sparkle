# Report-driven improvement checklist

Tasks: `TASK-20260927-report-improvements`, `TASK-20260927-report-continuation`\
Date: 2026-09-27\
Owner: implementation agent for bounded A0-root/A1/A2/B1; repository maintainer for independent review, merge and policy gates.\
State: bounded source independently reviewed at `3f5711ba` on 2026-09-28; final integration checks PASS (3152/0/18); PR #46 merged and source published on 2026-09-28, broader roadmap and production acceptance remain open.

[Original plan](../docs/superpowers/plans/2026-09-27-report-driven-improvements.md) | [Continuation plan](../docs/superpowers/plans/2026-09-27-report-continuation.md) | [Current verification](../docs/reports/2026-09-27-report-continuation.md)

## Verified implementation slices

- [x] Plan committed first: `76caf7306e4a9547b1036029a464d72e06951f19`, 2026-09-27.
- [x] A1 Chinese/English intent and readonly planning implemented; A2 quoted-path parsing implemented. Earlier subset counts and limitations remain [historical evidence](../docs/reports/2026-09-27-report-improvements.md); the supported full CI at `a1c32daa` now verifies the integrated source (2026-09-27; current verification).
- [x] A0-root Windows failure reproduced against original main and current code in one runner/fixture; physical directory normalization and alias refusal implemented in preflight and candidate identity. Linux/Windows root and apply tests passed at `db8aff4f` and the combined `a1c32daa` head (2026-09-27; current verification).
- [x] B1 bounded optional native task contract reaches existing requests, criteria, events and returned task-id-bound input summaries. Invalid contracts fail before persistence; old calls remain supported; independent verification stays UNOBSERVED. RED 13 cases plus legacy PASS; integrated CI PASS at `a1c32daa` (2026-09-27; current verification).
- [x] Supported-runtime workflow/typecheck/lint/full-test/build plus security/Pi/kernel/CLI probe steps passed in CI `36307011572`; Windows and Linux smoke passed. Separate cross-platform root/contract workflow `36307011584` passed (2026-09-27; current verification).
- [x] New loader/normalization/propagation, all-or-nothing admission, sibling isolation and caller-mutation regressions included in supported CI. Continuation adds 33 tests, not a claimed full-suite count (2026-09-27; current verification).

## Acceptance still open

- [x] Independent review of path identity, native contracts and intent/parser changes: initial P2 findings corrected; exact-source delta PASS at `3f5711ba` (2026-09-28; [sync review record](../docs/reports/2026-09-28-sync-merge.md)).
- [x] PR #46 MERGED and main published/verified at `bb6d59c8`; original checkout refreshed to main with drafts preserved (2026-09-28; [sync evidence](../docs/reports/2026-09-28-sync-merge.md)). Production operation remains separately gated.
- [ ] Production authorization and real-provider validation remain separate; source review/merge does not close them.
- [ ] Broader A0/reliability completion: O02/O03 and other existing packages keep their current ownership and gates. This root correction does not close all Stage A.
- [ ] B1 independent acceptance and any interactive/real-provider validation. Input requirements are not a B2 completion receipt or a new filesystem read allowlist.

## Remaining dispatch packages

- [ ] B2 host outcomes and completion receipt; approved S0-min/L1/L2/final review required. COMPLETED without host evidence stays UNOBSERVED.
- [ ] B3 event-derived status/candidate views and resume summary; D1 review required; no new terminal-state authority.
- [ ] B4 root budget admission/exactly-once settlement; unknown prices stay unknown.
- [ ] C1 scoped decision memory, counterevidence, correction/revocation and deletion cascade.
- [ ] C2 mandatory-context retention and version-to-evidence invalidation; refuse critical budget omission.
- [ ] D1-learning family/role/version diagnostics, deduplication and primary diagnosis without activation.
- [ ] D2-learning method candidates/inbox using existing adaptation types.
- [ ] D3-learning authorized baseline/candidate comparison, independent outcomes and isolated data.
- [ ] E approved version-pinned activation and policy rollback; F-PROD/R10/R11/F6 remain independent.

Remaining packages inherit the plans' files, observable acceptance, non-goals and abort conditions. One active owner per shared file; no replacement of the existing reliability/controlled-improvement acceptance process.

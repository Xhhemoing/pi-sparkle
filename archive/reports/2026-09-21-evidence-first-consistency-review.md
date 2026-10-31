# Evidence-first consistency review — fresh correction record

## Identity and provenance

- Review reference: `mubcd7l9-651229f5`
- Date: 2026-09-21
- Scope: documentation-only consistency review of the evidence-first plans,
  specifications, preregistration, reconciliation report, and checker.
- Review posture: **REQUEST CHANGES**. This is a fresh-context same-model
  author review, not an independent review, owner approval, implementation
  approval, experiment authorization, or freeze decision.
- Source facts were checked against the native executor, provider retry policy,
  observation-tool wiring, and extension registration before editing. No live
  provider, experiment, apply, write, commit, push, or configuration mutation
  was performed.

## Findings and remediation map

| Finding | Severity | Remediation | Evidence |
|---|---|---|---|
| Arm identity was not sufficiently ledger-bound and could imply complete schema equivalence | P1 | Added explicit A/B/C arm records, per-arm `armManifestDigest`, shared common constraints, B/C frozen routing tuple equality, A native Pi/no learned routing, and the declared C recall-tool difference | Read-only manifest, freeze plan, pilot plan/preregistration, measurement spec, phase plan |
| Retry wording could be read as exactly three calls or a global task budget | P1 | Reworded `maxAttempts=3` as the local provider-executor upper bound for one `PiAgentExecutor.execute()` including the first attempt; retained fixed `K=2`, no outcome-driven runs, and explicit “enforcement not implemented” language | Phase plan, freeze plan, pilot plan/preregistration, manifest, measurement spec |
| A's actual native executor boundary needed to be frozen independently | P1 | Recorded the source facts: separate `PiAgentExecutor`, host-resolved authentication, native `sparkle_read_file` filtering, and recall tool only when projection is supplied; mismatches block collection | Freeze plan, pilot plan/preregistration |
| Stage 0 needed a canonical, non-circular freeze-record design | P1 | Retained/expanded the draft specification under `.agent_workspace/evidence-first-reconciliation/stage0-freeze-record.json`, with JCS dependency/version planning, SHA-256 procedure, write exclusion, weak-integrity/crash/replay fields, provenance, digest-bound approval evidence, and refusal/reproducibility criteria | Stage 0 spec and phase/boundary plans |
| Review status could be mistaken for independent approval | P1 | Recorded REQUEST CHANGES, same-model fresh-context provenance, unrun repository-consistency role, pending low-concurrency re-review, and open owner gates | This report, reconciliation report, preregistration, Stage 0 spec |

## Consistency result

The amended documents are internally aligned on the following draft invariants:

- Common evaluator/task/repository constraints are shared, but runtime identity
  and tool schemas are arm-scoped. A is native Pi with learned sparkle routing
  disabled; B and C share the same frozen routing tuple; C's recall tool is a
  declared schema difference.
- Every result/ledger row carries the common manifest digest and the applicable
  `armManifestDigest`.
- `maxAttempts=3` is not exactly three provider API calls and is not global
  across children or tool turns. It is a local upper bound for one executor
  `execute()` scope. Task schedule is exactly K=2, with no outcome-driven extra
  runs; task-attempt enforcement is not implemented by this documentation slice.
- Stage 0 remains a draft. `boundaryDesignDigest` hashes only the canonical
  design payload, while approval evidence binds that digest without feeding it
  back into the payload. No owner approval or freeze is claimed.

## Open gates and re-review condition

The documents remain drafts/plans. Stage 0 design freeze, independent review,
owner budget/data approval, exact preregistration thresholds, live pilot,
R10/R11 apply review, production authorization, F6/F-PROD, and any worker-write
registration remain open. The repository-consistency review role previously did
not run because of concurrency; fresh low-concurrency re-review must include it.
No relay recovery, owner approval, or successful independent review is inferred
from this correction.

## Verification

The exact checker, workflow, and diff-check command output is recorded in the
[reconciliation verification report](2026-09-21-evidence-first-reconciliation.md)
after the final documentation edits. This record is author-run documentation
review only and cannot close a human or independent-review gate.

# Report execution evidence and handoff

Task: `TASK-20260929-report-execution`. Date: 2026-09-29.
Branch: `codex/report-execution-20260929`. Draft PR #47.
State: bounded implementations and automated verification; independent acceptance and main merge remain open.

## Saved plan and staged source

Starting main: `6ef6a04882ed5a42fa5dae1d37f77b0c48e64689`. The user's report evaluated an older baseline. The [reconciled execution plan](../superpowers/plans/2026-09-29-report-execution.md) was saved before runtime edits at `cee4527c993a1257fa38048d4b497640ce6492f5`; [slice contracts](../superpowers/plans/2026-09-29-report-slice-contracts.md) preceded the bounded changes. Merged A1/A2/A0-root/B1 were preserved rather than reimplemented. The [remaining dependency queue](../superpowers/plans/2026-09-29-report-next-steps.md) refines the next packages without checking them off.

C2 source: `f3a232057975ba5b4607074424a738ffdc43d463`; hosted run `36522164929`, job `109257195394`.
D1 RED tests/staged patch: `b2784940070ad1729bc2a19f09b01a28c51bc370`. D1 source: `e0a95dc4d7e23d8bf978aac4ce33d572191ac896`; hosted run `36523035846`, job `109259892389`. Final ordinary CI at the docs/cleanup tip must be read separately from earlier RED-head runs.

## Implemented behavior

**C2-context:** nonnegative safe-integer budgets; available mandatory constraints, grants, unresolved questions, validation routes, predecessor output, instruction references and non-goals retained whole or the packet refused. Conflicting mandatory keys refuse rather than silently first-wins. Errors report counts, not private constraint text. Initial parent launch enters existing failure/cleanup handling. No child executor is invoked for the oversized mandatory fixture. Optional omissions and unavailable validators remain explicit. The non-ASCII estimator covers packet payload only; it is neither tokenizer calibration nor a whole-prompt bound. C2 version/evidence invalidation remains a separate unfinished slice.

**D1-learning:** taskSuccess diagnostics grouped by project/model/family/role/available model and feature version. Semantic task replay counts once despite changed import time, prose or evidence ordering. Conflicting binding, score, outcome or attribution excludes that task. Non-model failures and invalid scores do not produce model-negative diagnostics. Unbound groups cannot become actionable. Primary issues remain visible without automatic replacement. A role/version-qualified issue does not generate a broader family/model-only avoid candidate; existing unqualified proposal behavior remains where representable. The typed scope-preserving candidate bridge remains unfinished. Persisted ledger identity, posterior logic, live selection and promotion gates are unchanged.

## Actual verification

Supported runtime: Node 22.19.0 / pnpm 10.17.1. Offline verification used the exported public pinned toolchain and locked dependencies, superseding the initial local Node 22.16 limitation. No dependency upgrade was made.

| Check | Result |
|---|---|
| C2 focused context/grounding/parent/checkpoint regression command | 71 PASS / 0 FAIL / 0 SKIP |
| D1 RED on original learning source | 33 total; 21 PASS / 12 FAIL / 0 SKIP |
| D1 learning tests | 135 PASS / 0 FAIL / 0 SKIP |
| Final combined context/learning regression command | 206 PASS / 0 FAIL / 0 SKIP |
| Full local combined-source `pnpm gate` | workflow/typecheck/lint/test/build PASS; 3194 total, 3193 PASS / 0 FAIL / 1 SKIP |
| Hosted combined-source `pnpm gate` | workflow/typecheck/lint/test/build PASS; 3194 total, 3193 PASS / 0 FAIL / 1 SKIP |
| `pnpm security:probe` | status ok; 26 passed; no open, waived or refused-waiver findings |
| `pnpm pi:probe` | PASS; core/AI pinned to 0.86.1; legacy GoogleThinkingLevel absent; ThinkingLevel uses core import |
| `pnpm kernel-reuse:probe` | PASS: live-stream, kernel-facade and executor-steer checks |
| Built CLI `--version` | 0.1.0 |

The one skip is `PiAgentExecutor completes a run against a real provider`: it requires PI_SMOKE=1 and explicit PI_PROVIDER/PI_MODEL plus configured credentials. It is not a completed real-provider experiment. No live provider or holdout run, production application, independent source review or long-term outcome measurement is claimed. C2's earlier checkpoint failure and stricter correction are preserved in [follow-up evidence](2026-09-29-context-gate-followup.md).

Correction to the intermediate staging version of this report: its Pi/CLI versions, probe cardinalities and skipped-test label were transcribed incorrectly. The values above were checked against actual command output; they supersede that staging prose. This correction does not change source, test expectations or any approval gate.

## Delivery and remaining work

Active plan/checklist pointers, the report checklist and status matrix contain dated PR #47 entries. Temporary source bootstrap and bounded publication workflows/patches are removed at the delivery tip; no additional write-capable workflow is retained. The source was published only to the isolated feature branch via additive, non-force commits. Main and other branches were not overwritten.

The [execution checklist](../../tasks/report-execution-todo.md) splits implementation/commands from acceptance. Independent review and main merge of these new slices remain outstanding. S0-min is implemented/source-reviewed but not owner-FROZEN; L1/L2 and B2 host outcomes remain behind that boundary. Retained O02/O03 work and ownership, the separately named evidence-gap D1 review, R10/R11, F6/F-PROD and experiment/provider approvals remain unchanged.

Shared root budget accounting, scoped decision memory, version-bound evidence invalidation, typed method candidates, independent comparisons and controlled activation/subsequent outcomes are still unfinished or gated. The project as a whole is NOT complete and no module is newly Outcome-supported by these commits. Review the exact source and then use the remaining dependency queue; do not infer authority from historical checkboxes.

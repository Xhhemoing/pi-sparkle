# Report execution: bounded slice contracts

Task: `TASK-20260929-report-execution` (2026-09-29), implementation agent. State: in-progress.
Parent: [saved execution plan](2026-09-29-report-execution.md). This amendment precedes runtime edits.

## C2-context

Files: `src/context/packet.ts`, its unit/integration tests, and new admission regressions. Existing child grounding and parent/flowchart dispatch are inspected; no second dispatcher is added.

- Budgets are nonnegative safe integers. Zero remains usable for an empty packet.
- Available constraints, authority grants, unresolved questions, validation routes, predecessor outputs, instruction references and non-goals are mandatory as a whole. If their estimate exceeds the budget, refuse before returning a packet. Do not raise the budget, truncate a constraint or include its text in the error.
- An identical repeated mandatory key coalesces; a conflicting duplicate is rejected, not silently first-wins. Same-scope grants with different content need caller reconciliation, not inferred permission union.
- Missing/unavailable index evidence remains explicitly disclosed; an absent default test route does not become a fabricated requirement. This slice does not authorize running unavailable validators.
- Estimate ASCII material at four characters/token and non-ASCII code points at two tokens each, using the same helper for code-map entries. This is a deterministic conservative heuristic, NOT tokenizer calibration or a hard bound on the entire prompt. Formatting, system prompts and downstream extra material are outside this packet budget.
- Existing tests that permit mandatory omission change to refusal; optional omission behavior remains pinned. Test parent-run dispatch with an oversized privacy constraint and an executor spy; no execution call may occur.
- Packet/event/RunStatus schemas, authority and production policy do not change. Instruction references are retained; their file contents are not newly read or elevated in trust.

## D1-learning

Files: `src/learning/diagnostics.ts`, `src/learning/auto-loop.ts`, focused diagnostics and auto-loop tests.

- Group by project/model/family/role/modelVersion/featureVersion. Missing metadata stays missing, never a wildcard or invented version.
- For task-bound observations, count `(project, run, task, taskSuccess)` once, ignoring replay/import time and prose changes. Conflicting outcome/score/attribution/binding metadata excludes that task rather than selecting whichever row came first. Reject non-finite/out-of-range scores from quality statistics.
- For unbound observations, reuse the existing observation identity to remove exact duplicates; they may remain diagnostic but cannot make a group actionable. Do not alter persisted ledger keys or retrospectively reclassify old feedback.
- Keep provider/environment/tool/contract/run failures and human feedback out of model-negative samples. A deterministic protocol observation is not relabeled independent host validation.
- Primary-model issues stay visible. No automatic primary replacement, promotion or live selection.
- IMPORTANT scope correction: existing learned-routing avoid rules cannot express role or version. Such scoped issues must remain diagnostic-only and explain the missing scope-preserving candidate bridge. Never erase a stratum to generate a broader avoid rule. Preserve the existing proposal-only path only when every scope is representable (known family, no role/version qualifiers). A future approved typed candidate bridge belongs to D2, not a silent expansion here.

## Test and delivery

Write and run RED tests, then implement and run focused context/grounding/learning regressions, `pnpm gate` and applicable built probes. Publish tests and behavior separately. Node 22.16 supplemental output is labeled as such; temporary bootstrap exports the pinned public Node/pnpm toolchain to allow supported offline verification. No credentials/configuration are exported. Remove bootstrap before final delivery.

This bounded work does not close owner freeze, independent review, O02/O03 ownership, host outcome wiring, production, live-provider, holdout, or all Stage C/D work. Abort on a frozen schema change or overlap with retained user work.

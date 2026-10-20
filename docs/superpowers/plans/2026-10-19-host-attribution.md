# Host attribution and offline datasets

## Identity and scope
- ID: TASK-20261019-host-attribution
- Owner: root coordinator and sequential builder/review agents.
- State: planned.
- Authority: ADR-009 A7; parent [staged plan](2026-10-19-staged-continuation.md).
- Implement read-only host attribution and task-disjoint offline preparation. Reuse existing HostTerminalOutcome/Binding/Assessment types. No online policy changes, new authority ledger, hashes, gates or schema freeze. Each sub-slice is separately verified/reviewed/committed.

## A: legacy replay correctness
Source inspection identifies two hypotheses in src/learning/from-episode.ts: outcomeKindFromResult ignores outcome (PARTIAL/CANCELLED can acquire PASSED/FAILED labels); applyCascadeRetry retains the earlier modelVersion when the next model version is unknown. Write failing tests first in test/unit/learning/from-episode.test.ts. Reuse existing taskSuccessFromResult semantics and invalidate unknown-version routes until complete subsequent routing evidence. Preserve valid explicit-version cascades. Verify focused file plus task-success.test.ts and eval-dataset.test.ts. This does not reclassify self-report as independent host evidence.

## B: actual host publication
Files: src/native/write-session.ts, new src/native/host-outcome.ts, test/integration/native/host-outcome.test.ts. Source task identity exists on every attempt but is dropped without optional taskContract; expose the genuine taskId additively on attempted results. Allocate one opaque logical-task ID per execute call because repairs create new taskId/runId while reusing the candidate. Carry all attempts in the same logical group, never hash objective text.

The internal publisher receives the original runClosedLoopCheck check plus its original TrustedVerificationDescriptor at the real session boundary. Require hasTrustedVerificationEvidence, exact cwd/revision/command/argv and settled completed check; copied/deserialized records cannot mint authority. Use actual run/project/episode/task identities and exact matching ModelInvocation rows from host-owned execution telemetry, not routing aliases. Preserve private capability provenance via original object identity; ordinary saved artifact JSON remains historical inspection, not rehydrated trusted authority.

Complete HostTerminalOutcome requires explicit provider/model/version, evaluator identity/version/rubric/canonical definition, actual source version and artifact/check refs. Missing or mixed model identity/version, missing telemetry, earlier different/unknown repair models, provider/tool/runtime errors, timeout, cancellation (including after successful check), unsettled effects, invalid exact evidence or evaluator unavailable yield explicit unobserved exclusions. Generic nonzero exit and isRepairableCheck are not model-quality classifiers: only host-declared evaluator failure semantics can label model-evaluated FAIL. Existing recipe protocol distinguishes accepted/failed/unavailable/unsettled. Acceptance is host checker acceptance, not queue acceptance or source apply.

Store reference-only observation artifacts through the existing run artifact mechanism for inspection/deletion. After restart no artifact parser alone recreates in-memory authority. Source publisher API must not accept arbitrary result JSON as proof. No caller-supplied sourceState assertion can bypass the actual session/check origin.

RED fixtures: real temporary Git candidate, actual Node checker and trusted descriptor; worker PASSED/checker failed; missing/forged/copied/changed evidence; unknown/mixed model versions; provider/tool/cancel failure; late cancellation; repair grouping; no acceptance/apply from observations. Focused native/closed-loop/evaluation identity checks; security/Pi probes at delivery.

## C: readonly offline projection
Files: new src/learning/host-attribution.ts and test/unit/learning/host-attribution.test.ts. Consume genuine host-published observations, readonly actual invocations and host logical-task grouping. Produce eligible/excluded rows with explicit reasons and existing M4-B coverage; no registry or routing writes. Identical evidence and invocation identities deduplicate; conflicts do not silently select a winner. Unknown tokens/prices remain unknown; priced subset is not total cost.

Split at an explicit chronological cutoff: group wholly before is training, wholly at/after is test; any group spanning cutoff is excluded from both as cross-boundary-task. Missing identity/time excluded. Sorting and equality behavior deterministic; input order irrelevant. RED covers repeated logical tasks across run/attempt IDs, cutoff-spanning/equal timestamps, duplicate/conflict evidence, mixed/unknown model versions and partial cost coverage. Verify focused host-attribution and usage-coverage tests.

## Delivery and rollback
Update tasks/status and dated evidence with exact RED/GREEN commands, independent specification then quality reviews and existing full gate. Revert source normally if required, retaining run artifacts and unknown effects. Actual model version absence can leave real provider samples ineligible; do not invent a version to make an experiment pass. No local test grants production/holdout/automatic promotion approval.

## Publisher wiring refinement after source feasibility review
No coordinator execution event currently captures ModelInvocation. Add a host-only onInvocation callback to NativeWriteExecutorFactoryInput, forwarded by host factories to the existing Pi executor/runtime option. The controller already forwards context. Keep execution/event schemas unchanged. Capture and validate immutable bounded rows synchronously in an execute-owned collector; retain malformed/conflict/overflow as exclusion facts. Observe TOOL_FINISHED.isError through an executor wrapper so a swallowed error cannot become model-quality attribution. No persisted telemetry file is authenticated by reading it.

Optional host evaluator configuration may specify evaluator/rubric identity, canonical semantics and explicit model-evaluated failure exits. It cannot override actual project/run/task/artifact/model facts or fill missing modelVersion. createConfiguredPiExecutor currently has no modelVersion option; absence therefore stays ineligible. An additional expected-model restriction may narrow eligibility, never supply evidence.

Use one execute-level opaque logicalTaskId and actual per-attempt taskId/runId; retain original final checked.check/descriptor privately. Finalize after the complete repair loop and corrective cancellation summary, including single-attempt and repair-context-failure paths. Persist only safe references, then recheck cancellation after the last await before synchronously issuing the final trusted observation/result identity. Historical artifact JSON cannot recreate issuance after restart. Generic host code is trusted assembly; callback identity is not protection against a malicious factory with process privileges.

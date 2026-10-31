# Conversation reference recovery (P2 / bounded C3)

## Identity

- ID: TASK-20261020-conversation-recovery
- Owner: root integrates/docs/verifies; one conversation implementation writer; independent spec and quality reviewers.
- State: accepted locally; bounded read-only C3 slice.
- Date opened: 2026-10-20 America/Los_Angeles.
- Authority: [ADR-009](../../../docs/decisions/0009-lightweight-adaptive-framework.md), [approved sequence](2026-10-20-sync-next.md), [Work 3](2026-10-20-cloud-continuation.md#work-3-跨会话恢复c3).
- Prerequisite: [P1 accepted](../../reports/2026-10-20-conversation-tools.md#final-local-p1-acceptance-2026-10-20): focused28/28, spec/quality/doc review, gate3987/0/48+build, security26/Pi4. P2 started only after these completed.

## Problem and Scope

### Problem

P1 tools have only process-local focus. A new host must recover selected references and re-read facts without treating old summaries as current truth or replaying an old task. Arbitrary conversation taskRef is not a queue item or native task ID. Native executorFactory may run before a runId exists; recordRun occurs only after startDevelopmentTask returns. A final focus checkpoint cannot prove that an unrecorded execution never started.

### In scope and design decision

Add an explicit host-owned reference save API and a dedicated read-only recovery session, wired through the same two Pi tools. A recovered session always refuses run-direct, even if all facts look complete or there is no saved run. question/status/focus/restore remain usable. Other separately authorized P1 instances and existing controllers remain independent; this is not a global stop mechanism.

Use a separate recovery entry rather than restoring writable task bindings. Saving the entire session would retain capabilities and duplicate completion state; automatic execution replay needs durable pre-dispatch ownership beyond this slice. Those alternatives are excluded by the approved read-only scope.

### Out of scope

No automatic dispatch or retry, cross-process exactly-once, auto-saving execution state, scheduler/intent ledger, apply capability, raw prompt persistence, paid provider, release, main merge or remote publication. No new hash, frozen contract or gate. Host-managed reference files are not execution receipts.

## Interface and data ownership

- saveConversationReferences(referenceFile, focus): explicitly save only current/suspended locations with projectRef/taskRef/runId. Validate ordinary closed data, strip token/messageRef from the real focus snapshot, and use existing atomic-file persistence. File format has a normal version field, not a new integrity mechanism.
- The host chooses a private file under .agent_workspace by convention. Saving is explicit and host-serialized; tools and late task results never write it automatically. A loaded session owns an immutable snapshot and cannot be overwritten by a later result from another instance.
- Host deleteConversationReferences(referenceFile) deletes only that reference file, idempotently. It does not delete runs/queues or recreate them. Missing/corrupt/oversized/linked reference files fail closed, never fall back to a writable fresh session. Retention is explicit until host deletion; do not retain secrets, paths, prompts, checker output, token generations, consumed-message sets or accepted/completed state in the file.
- createSparkleExtension({ conversationRecovery: options }) is additive and mutually exclusive with conversation. Lazy load the recovery session at the first actual tool call; reuse current pending/abort/shutdown handling. Existing default/P1 options remain compatible.
- Recovery options are trusted ordinary host data. projects provide projectRef/sourceRepo/stateRoot and optionally an already configured controller.status. tasks explicitly distinguish direct references from queue item references; direct task mappings explicitly allow runId/artifactId/sourceRevision, queue task mappings explicitly provide itemId. Never equate taskRef with a queue/native ID or scan unrelated runs.
- Saved location runId must match its host-selected task mapping. Unknown target or foreign/mismatched run is refused before reading that run's data. The host-bound mapping is the declared authority; it is not falsely described as proven by direct-run events or Git HEAD alone.
- New ConversationFocus generation, revision starting from the new instance; recover validated current/suspended pointers only. No import of old generation or message provenance.
- Status returns a new recovery-status response branch, leaving P1 status unchanged. Each request re-reads selected current facts and includes observation time, host-bound provenance, minimal IDs/statuses/revision and reason codes. Do not return whole RunInspection, queue definitions, canonical action inputs, claim tokens or checker output.
- Reuse bounded EventStore.readAll plus inspectRunEvents; reject incomplete-tail recovery as unavailable instead of silently accepting partial logs. Use bounded assertRunPresent/readLoopArtifact for run/artifact presence and identity; missing/deleted/corrupt evidence cannot be acceptance.
- Read current physical source identity/HEAD and dirty status with read-only Git. Compare to the explicitly host-bound historical revision; changed/dirty source is reported stale, never execution permission. Do not equate equal commits with project identity.
- Existing controller.status may briefly acquire its existing read locks; no next/accept/reconcile/admission/resolve calls. It is not a cross-store atomic snapshot. A host may register only existing project stores; missing stores remain unavailable rather than being bootstrapped by recovery. Project/task facts are selected and projected, not enumerated globally.

## Acceptance Criteria

- [x] Actual first child process runs a host-authorized checked Git task and saves references; after closing it, a second process uses the real Pi loader and recovery factory to restore current/suspended refs with a fresh generation and fresh facts.
- [x] Completed/repeated-message requests never invoke an executor in recovery; missing pre-result run references also cannot dispatch. Normal separately authorized P1 behavior remains compatible.
- [x] question/focus/restore/status work in recovery; switching focus during a delayed status produces staleFocus and cannot overwrite the newer pointer. Old instance late results cannot overwrite the loaded session.
- [x] Source revision/dirty changes, deleted run/artifact, corrupt/truncated event log and unknown/cross-project mappings refuse or explicitly invalidate facts, without rebuilding deleted runtime data.
- [x] Reference save/delete is bounded, closed and private; unsafe fields/accessors and foreign refs are rejected; no prompts/tokens/credentials/host binding paths in serialized refs or model-visible projected facts.
- [x] Queue task identity is explicit, queue/action projections expose minimal current facts without invoking executable controller paths or mutating business state.
- [x] Final focused regression, typecheck/lint, independent spec/quality review, current full gate and security/Pi probes pass; docs/status/tasks record scope and exact commands.

## Implementation Slice

| File/symbol | Change | Owner | Dependency/risk |
|---|---|---|---|
| src/conversation/recovery.ts | Strict reference persistence, host mapping and read-only session/fact projection | single writer | No restored authority or sensitive data projection |
| src/conversation/focus.ts | Validated initial current/suspended locations under a new generation | single writer | Preserve existing CAS semantics |
| src/conversation/session.ts | Share request parser/types only as needed | single writer | Do not relax P1 validation or execution safeguards |
| extensions/pi-sparkle/index.ts | Exclusive recovery configuration, lazy actual tools | single writer | Preserve P1/native lifecycle and root-object provider schema |
| test/unit/conversation/ and test/integration/conversation/recovery.test.ts plus dedicated fixtures | Real process restart, actual loader, drift/deletion/privacy/failure cases | single writer | No provider calls or internal full builds |
| docs/conversation-host.md, workflow, reports, tasks, status | Usage, limits and exact evidence | root | Preserve historical P1 records |

## Test-First Plan

- RED: new real-process recovery test fails at missing recovery API/factory, not dependency setup; record actual command/output before implementation.
- Focused: pnpm test --test-concurrency=1 test/unit/native/extension.test.ts test/unit/conversation/ test/integration/conversation/.
- Targeted typecheck and ESLint for changed files.
- Final existing gate: pnpm gate (serialized as P1), then pnpm security:probe and pnpm pi:probe. Root alone runs full builds/gates; no dependency/lockfile changes.
- Focused tests must include existing P1 loader/provider-schema and lifecycle regressions. Avoid mocks that replace the run facts or restart assertion; small delayed controller callbacks may test focus concurrency.

## Gates and Handoff

- User already authorized P1 then P2. The narrow recovery design completes that scope without new permission requests.
- Abort condition: an unknown/invalid mapping stays read-only/unavailable; do not add writable fallback or clear old claims to make recovery succeed.
- Required records: [verification record](../../reports/2026-10-20-conversation-recovery.md), actual RED/GREEN and independent actual-diff reviews; raw logs in .agent_workspace/conversation-recovery-20261020/.
- Next action: this bounded slice is accepted; any writable recovery/ownership work requires its own design and verification. P3/P4/P5 remain separate.

## Closeout

- Verified source/date: 2026-10-20 America/Los_Angeles, 26808ad2 plus reviewed P1/P2 working changes; Windows Node24.18.0, pnpm10.17.1.
- Commands and outcomes: focused36/36, typecheck/lint0, independent spec/quality reviews, gate3995/0/48 conditional skips plus build, security26/Pi4; [exact P2 evidence](../../reports/2026-10-20-conversation-recovery.md#final-local-p2-acceptance-2026-10-20). P1 acceptance preceded P2; no P1-only result substitutes for P2 verification.
- Open follow-ups: durable execution resumption/ownership, broader C3 retrieval, C4, P3/P4 and other platform qualification remain separate.

## Implementation clarification: existing controller stores

A recovery project with controller.status must also supply its existing queuePath. Before invoking status, verify that queuePath and sibling actions/actions.json already exist as ordinary files. This matches DevelopmentController's existing store location. Missing data returns unavailable without invoking status. The check does not provide a filesystem transaction against an external concurrent deletion; existing lock activity and the host's controller remain trusted and explicitly disclosed. No business-state bootstrap or execution path is intentionally invoked.

# Native host-authored acceptance criteria

- ID: `TASK-20261015-native-write-criteria`
- Owner: coordinated `audit_loop`; coordinator owns common status, integration and phase saving
- State: ready-for-review
- Base: `c2b802c`; opened 2026-10-15 Asia/Shanghai
- Related contracts: native isolated-write API, ADR-008, prior bounded repair plan; apply/adaptation gates unchanged.

## Problem and scope

The write task currently has an empty `ChildTaskInput.acceptanceCriteria` even when a host knows the requirements. Add optional named host requirements, validate and freeze them before allocating a candidate or invoking a factory, include them in the actual implementer prompt and structured task request, preserve their IDs and actual task binding in every attempt's evidence and public result. Observable-check text is descriptive; it is never parsed into executable commands or approval policy. The existing aggregate independent check determines acceptance; no per-criterion measurement is invented.

Input: `acceptanceCriteria?: readonly {id,description,observableCheck}[]`, nonempty and at most eight when supplied. IDs are unique ASCII identifiers with at most 64 characters; text fields contain at most 512 characters. Reject unknown fields, non-plain objects, accessors, invalid arrays, empty/NUL fields and duplicate IDs. Omitted input preserves old behavior and result shape.

Output: optional `taskContract` with schemaVersion, actual taskId, acceptanceCriteria, criterionIds and run-scoped artifact. Every attempt preserves a definition artifact and loop attempts link it. Result binding records requirements, not criterion success.

## Ownership and verification

Own `src/native/write-preflight.ts`, `src/native/write-session.ts`, a small write-criteria helper if useful, optional contract-artifact link in the existing write-loop type, focused tests and dated report. Coordinate optional trusted verifier descriptor identity/authenticity with the execution owner; never clone an opaque descriptor or modify execution files in this slice.

RED first: named criteria reach prompt/request, snapshot survives input mutation, malformed criteria allocate no work, every repaired attempt has the same definition with distinct actual task IDs, failed host verification cannot be bypassed by a child's PASSED self-report. Focused command: `node --import tsx --test test/unit/native/write-criteria.test.ts test/integration/native/write-criteria.test.ts`; then existing write/preflight/loop checks. Coordinator owns full gate/probes and publication. No automatic apply, new provider calls, policy promotion or schema/event replacement.

Record commands, review and open limitations in `docs/reports/2026-10-15-native-write-criteria.md`. Abort before execution on invalid host definitions, and fail closed if durable contract evidence cannot be written.

## Coordinated scope extension

The coordinator delegated one additional native boundary fix before implementation: reject applying or issuing a native apply handle for a candidate carrying trusted exact-verification metadata until native apply can accept and revalidate a freshly issued authentic descriptor. Serialized evidence cannot recreate the execution owner's in-process capability, and current native apply rechecks only command/argv. Add explicit refusals in `src/native/apply.ts` and `src/native/apply-registration.ts` plus focused negative regressions; default legacy application remains unchanged. This prevents a stronger candidate check from silently becoming a weaker apply check and grants no apply authorization.

Controller integration follow-up: add host-only `verification.repairableExitCodes?: readonly number[]`, copied/frozen in preflight. Absence preserves existing completed-nonzero retry behavior; an empty list disables check-failure retries. The controller's aggregate verifier distinguishes assertion exit 1 from infrastructure exit 2 and opts into `[1]`. Reject malformed/duplicate/noninteger/out-of-range codes before worker allocation. Pin default compatibility, excluded-exit refusal and mutation resistance with real command tests; this changes retry eligibility only, never check acceptance.

## Author closeout

Implemented criteria validation/snapshot, actual prompt and task-request wiring, per-attempt contract artifacts and result IDs, authenticated trusted-descriptor forwarding, explicit trusted apply/registration refusals, and the optional aggregate-verifier retry exit allowlist. Initial criteria RED: four integration assertions plus missing helper module; first GREEN: seven tests. Both real trusted apply/issuance downgrade reproductions failed RED before the refusal and pass afterward. Exit-policy regressions also passed RED→GREEN. Final focused native regression: 67 pass / 0 fail / 0 skip; typecheck and focused ESLint PASS. [Verification record](../../reports/2026-10-15-native-write-criteria.md). Independent review and combined-source integration are coordinator-owned; no gate is pre-accepted.

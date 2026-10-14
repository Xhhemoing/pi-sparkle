# Native write requirements and trusted-check handoff

- Task: `TASK-20261015-native-write-criteria`
- Base: `c2b802c`; date: 2026-10-15 Asia/Shanghai
- Builder: coordinated `audit_loop`; coordinator owns independent review, shared-source gates and phase save
- State: ready-for-review
- [Scoped plan](../superpowers/plans/2026-10-15-native-write-criteria.md)

## Implemented contract

`NativeWriteSessionInput` accepts optional `acceptanceCriteria: readonly {id, description, observableCheck}[]`. When supplied, the list must contain 1–8 plain criterion objects. IDs are unique ASCII identifiers with at most 64 characters; descriptions and observable-check text contain 1–512 characters without NUL. Unknown fields, prototypes other than plain/null, accessors, sparse arrays, symbolic keys, duplicates and invalid values are refused before candidate allocation or factory execution. A copied, normalized array and every criterion are frozen synchronously in preflight. Omitted criteria preserve the previous factory/result shapes and one-attempt behavior.

The exact copied criteria appear in the factory input, actual implementer objective/prompt, and `ChildTaskInput.acceptanceCriteria`. The structured task request retains the host IDs and combines description with descriptive observable-check text. That text never becomes an executable verifier or permission grant. The host-controlled `verification.command`/`args` remain the execution authority, and a child's PASSED self-report cannot turn a failed host command into acceptance.

Every completed attempt writes a run-scoped `native-write-task-contract` artifact containing the original objective, immutable criteria and verification definition, source revision, candidate path, actual parent run and child task IDs. The result's optional `taskContract` exposes those criteria/IDs and its artifact reference. `loop.attempts` adds an optional `taskContractArtifact` pointer. The artifact explicitly records `definitionOnly: true` and `perCriterionVerification: "UNOBSERVED"`: a passing aggregate host command is not fabricated as an independently measured pass for every named criterion. Actual task requests also retain the definition in run events; no new event union or storage plane was introduced.

## Trusted verifier integration

The native verification input accepts an optional execution-owned `TrustedVerificationDescriptor`. Preflight validates the authentic original host-issued object against command/argv and preserves its identity; cloning or deserializing that object does not restore its private host capability. The descriptor and manifest are already deeply frozen by their issuer. The native session forwards it to `runClosedLoopCheck`, and repair eligibility refuses a failed exact-verification result.

Per-attempt contract artifacts serialize only the public descriptor definition alongside the existing verification snapshot. Private checker/candidate bytes remain execution-owned ephemeral state. Persisted metadata does not become executable authority.

The current native apply path reconstructs serialized write results and runs a legacy command/argv check. Two real-candidate regressions demonstrated that it previously accepted a trusted candidate and silently lost the stronger verification boundary. This slice now refuses both direct native application and apply-handle issuance for results carrying trusted-verification metadata. The explicit error retains the candidate for host review until native apply supports a freshly issued authentic descriptor. Ordinary legacy apply remains unchanged; no automatic apply or owner authorization is introduced.

## Aggregate verifier retry policy

The controller's host-owned recipe runner can distinguish a failed assertion from unavailable execution infrastructure using different exit codes. Optional `verification.repairableExitCodes` snapshots a host allowlist of unique integer codes from 1 through 255 before execution. An empty list disables automatic check-failure repairs; an omitted list preserves the previous completed-nonzero behavior. Runtime validation refuses strings, sparse arrays, duplicate values and invalid numbers before allocating a worker. The controller may opt into `[1]` so aggregate infrastructure exit 2 stops instead of asking an agent to edit code to repair a missing tool. This policy changes retry eligibility only; it cannot make a failed check pass.

A real-command regression proves that `[1]` stops after exit 2 even when the original array is mutated inside the factory to include 2. The default path against the same command still makes a second attempt and succeeds, preserving compatibility.

## Changed files

| Surface | Change |
|---|---|
| `src/native/write-criteria.ts` | Bounded parser and copied/frozen requirement/result-binding types |
| `src/native/write-preflight.ts` | Criteria validation before allocation; authentic verifier snapshot preservation |
| `src/native/write-session.ts` | Factory/prompt/structured task wiring, per-attempt contract artifact and result binding, trusted descriptor forwarding |
| `src/native/write-loop.ts` | Optional attempt contract artifact link and exact-check failure refusal |
| `src/native/apply.ts`, `src/native/apply-registration.ts` | Shared fail-closed guard against trusted-to-legacy apply downgrade |
| New unit/integration `native/write-criteria.test.ts` | Real Git/filesystem/command evidence, malformed inputs, frozen definitions, retry binding, self-report refusal and trusted apply boundaries |

No execution implementation file was changed by this builder; the exact snapshot/descriptor/check implementation belongs to the separately coordinated execution slice.

## Verification record

| Command / evidence | Result |
|---|---|
| `node --import tsx --test test/unit/native/write-criteria.test.ts test/integration/native/write-criteria.test.ts` before implementation | RED: 0 pass / 5 fail. Four integration behaviors failed; the new helper module was absent |
| Same focused command after first criteria implementation | GREEN: 7 pass / 0 fail |
| `node --import tsx --test --test-name-pattern='trusted candidate' test/integration/native/write-criteria.test.ts` before apply guard | RED: 0 pass / 2 fail; both operations unexpectedly succeeded |
| `node --import tsx --test test/unit/native/write-criteria.test.ts test/integration/native/write-criteria.test.ts test/unit/native/write-preflight.test.ts test/unit/native/write-loop.test.ts test/integration/native/write-loop.test.ts test/integration/native/write-session.test.ts test/unit/native/apply.test.ts test/unit/native/apply-registration.test.ts test/integration/native/apply-registration.test.ts` | GREEN: 65 pass / 0 fail / 0 skip, 6.94 s on Linux |
| `node --import tsx --test --test-name-pattern='repairable.exit' test/integration/native/write-criteria.test.ts` before host exit policy | RED: both new behaviors failed |
| Same full focused native command after host exit policy | GREEN: 67 pass / 0 fail / 0 skip, 6.50 s on Linux |
| `node node_modules/typescript/bin/tsc --noEmit` | Final PASS. An earlier shared-worktree run observed the execution owner's new tests before their matching API fields landed; that intermediate failure was not attributed to criteria completion |
| `node node_modules/eslint/bin/eslint.js src/native/write-criteria.ts src/native/write-preflight.ts src/native/write-session.ts src/native/write-loop.ts src/native/apply.ts src/native/apply-registration.ts test/unit/native/write-criteria.test.ts test/integration/native/write-criteria.test.ts` | PASS |
| Independent review / full combined gate | Coordinator-owned; not asserted by this author record |

Positive integration verifies both the actual generated prompt and persisted `CHILD_MESSAGE`/`TASK_REQUEST`, with the resulting contract bound to that actual task ID. A two-attempt repair retains identical criterion definitions but distinct task/run IDs and references. A caller mutates its original criteria and command arguments inside the factory; the executed verifier and stored task definition remain unchanged. A worker claims every requirement passed while the real host command fails; acceptance stays false. Trusted-mode tests use the execution-owned authentic descriptor, reject a copied descriptor before worker allocation, and preserve source/candidate bytes on apply refusal.

## Limits and handoff

Criteria are supplied by a host; this does not add requirement extraction, automatic test generation, per-criterion measurement, or a new approval system. Complete external checker dependency enumeration and exact snapshot scope remain explicit host responsibilities. Requirement definition artifacts are added after the ordinary attempt settles; this is not a crash-resume controller. Trusted application currently refuses rather than recovering authority from serialized metadata. Existing legacy verification/application contracts retain their previously documented limitations.

No live model call, automatic merge, source application, adaptation promotion, production authorization, S0-min freeze, R10/R11 closure, F6 experiment or Outcome-supported benefit is claimed. The coordinator should independently review the source and test bindings, run the combined gate/probes, and phase-save only the verified scope under the current user instruction.

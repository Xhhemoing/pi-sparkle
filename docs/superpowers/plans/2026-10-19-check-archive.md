# Fresh-ledger completed-check archival

## Identity
- ID: TASK-20261019-check-archive
- Owner: root coordinator and sequential builder/review agents.
- State: planned.
- Date: 2026-10-19.
- Authority: ADR-009 M0; [local follow-ons](2026-10-19-local-followons.md).

## Problem and scope
Repeated successful verification consumes the existing 1024 active-action limit. Deleting completed keys would let an old writer replay them. Use the existing authoritative schema version, lock, exact identity and atomic snapshot to retain keys and partition completed candidate-check records. No new hash, baseline, frozen contract, sidecar authority or gate.

Opt-in schema 2 is only for a fresh ledger directory (or reopening an existing schema 2 ledger). Never automatically migrate or overwrite schema 1, even if all its rows look terminal. Keep the default constructor/controller behavior and schema 1 unchanged. The actual ledger directory is derived from queuePath, not stateRoot.

## Chosen storage design
One actions.json snapshot and the existing actions.lock. Schema 2 contains active actions (existing 1024 bound) and a finite archivedChecks array of complete completed candidate-check records; retain all IDs, idempotency keys, input, receipts and history. Keep the existing 8 MiB total byte bound. Lookup/get/list/idempotency inspect both arrays and validate cross-array unique IDs/keys. Never archive prepared/running/uncertain/failed or non-check records. Archive capacity or byte exhaustion refuses without forgetting keys or weakening effect retention.

This supersedes the earlier archive-sidecar/first-write sketch: a single atomic snapshot needs no cross-file publication window or index. Add a host-only DevelopmentController option so real check/recheck paths use the opt-in ledger. Do not silently auto-enable based on existing records or add CLI flags unless required by a concrete caller. Reopening schema 2 requires the explicit host mode; default schema 1 readers still refuse it.

## Compatibility and isolation boundary
Historical e6f6a5b ledger-mediated checks/writes reread and validate schema 1 under actions.lock before prepare/claim. An initialized schema 2 therefore refuses that known old admission algorithm. A constructed old object cannot bypass reread. If an old schema 1 prepare wins initialization, new opt-in initialization must refuse and preserve it. A missing primary beside publication remnants is ambiguous and must not be treated as fresh.

This is a version fence at the existing persistence boundary, not OS containment. Historical 415b072b controller executes some checks outside the ledger; arbitrary hosts and already-untracked effects are not covered. Do not claim isolation of every historical controller or migration of shared live roots. Windows process termination still preserves interrupted trees as unsettled; archival does not change it.

## Implementation and acceptance
Files: src/development/action-ledger.ts, necessary minimal ActionStore initialization support, controller option and focused unit/integration tests; a scratch or reusable non-gate probe for actual historical e6f6a5b implementation. Confirm exact API before editing. Existing v1 unknown-schema, identity, terminal and CLI pinning tests remain.

Observed RED before runtime changes:
- fresh opt-in and actual known-old ledger race: v2 wins means old prepare/claim fails and no effect marker; old wins means opt-in refuses without mutation;
- preconstructed old instance still refuses; existing schema1, symlink and publication-remnant directories refuse;
- more than 1024 settled candidate-checks admit successfully with bounded archival; all other classes stay active;
- restart/get/list/reprepare archived exact key preserves terminal identity; changed input and claim/admit cannot replay;
- concurrent archive/admit/settle has no duplicate identity; overflow/failed publication preserves previous bytes and unresolved actions;
- real controller repeated check/reverify/accept path uses option, while default remains v1.

Use existing unit/development/action-ledger.test.ts plus new unit/development/check-archive.test.ts and integration/development/check-archive.test.ts, exact selected files recorded before execution. Typecheck/lint, spec review then independent quality/pinning review, final pnpm gate/security/Pi/workflow. Run actual historical implementation probe from available Git objects; absent objects mean unavailable qualification, never pass. Copy its exact relevant source or extract its source tree into scratch, preserving historical version provenance; do not label a rewritten mock as old-binary proof.

## Rollback and limits
Disable opt-in for new roots through a normal source revert; existing schema2 roots remain readable only by compatible code, never downgrade them to v1 or remove archive keys. Retain full snapshots and unknown effects. Archive is finite, not unlimited retention or billing settlement. Genuine old-writer migration, Windows containment, power-loss qualification and production acceptance remain separate.

## Planning evidence
Independent containment_reassessment inspected historical/current admission paths and ran three existing ledger identity/claim/unknown-schema tests: 3 pass / 0 fail. No source edits, network, crash or benchmark was performed by that review. Planned schema2 behavior is not yet implemented or qualified.

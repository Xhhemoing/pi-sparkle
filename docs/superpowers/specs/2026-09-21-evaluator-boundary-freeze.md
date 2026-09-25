# Stage 0 evaluator/apply boundary freeze record (draft)

> **ADR-008 correction (2026-09-22):** This draft does not use SHA-256 or any replacement cryptographic hash. It uses an opaque random record locator and exact canonical-byte comparison in explicitly labeled local-weak mode. The draft remains unapproved and unfrozen; it does not authorize writes, apply, provider calls, or live runs.

## Controlling owner decision (2026-09-25)

Owner `coordinator` recorded `APPROVE_OPTION_A_FOR_IMPLEMENTATION_REVIEW` at
`2026-09-25 (applicable session date; no wall-clock minute asserted)`, reviewing base
`e1ce19c0f93d8e34e7ca25512c5d32d2743ba669`. This decision authorizes only
implementation and independent review of Option A. Stage 0 remains **not
frozen**; this decision does not approve L1, a provider or pilot run, apply,
routing activation, promotion, or worker writes.

This dated decision is the controlling correction wherever the historical draft
below requires an external RFC 8785/JCS dependency. S0-min instead uses the one
project-versioned deterministic JSON contract
`pi-sparkle-stable-json-v1`, backed by the existing
`src/experiments/manifest.ts::stableStringify` byte behavior. It is explicitly
**not RFC 8785/JCS** and provides only `local-weak-exact-bytes` binding. No
second canonicalizer, external JCS dependency, or compatibility-changing byte
contract may be introduced under this decision. The older JCS wording remains
below solely as historical provenance and is superseded by this correction.
The legacy `REQUEST CHANGES` state and statement that an owner decision remains
required also predate this decision: the owner gate is now closed only for
Option A implementation review, while independent implementation review and the
later freeze decision remain open.

Before any later `FROZEN` decision, the implementation must fail closed on
unknown or missing allowlisted fields, duplicate object keys detected before
ordinary parsing loses them, non-finite numbers, `undefined` or other non-JSON
values, invalid UTF-8, unpaired Unicode surrogates, trailing bytes or newlines,
and any parse/serialize or exact-byte mismatch. It must also refuse missing,
deleted, foreign, stale, incomplete, legacy, self-reported-only, or
identity/binding-mismatched outcome evidence; evaluator unavailability,
provider/tool/run failure, timeout, or ambiguous crash/replay state cannot be
classified as a model-attributable `FAILED` result. The authoritative evaluator
bundle and terminal outcome DTO remain host-owned and outside candidate/worker
write scope.

## Status and scope

- State: `draft — REQUEST CHANGES; not approved, not frozen`
- Planned record location: `.agent_workspace/evidence-first-reconciliation/stage0-freeze-record.json`
- This document specifies the record; it is not the record, an approval, or an authorization.
- Stage 0 is design-only. It does not register tools, issue apply capabilities, mutate a source repository, or authorize a live provider run.
- Review provenance: fresh-context same-model author review only; independent review and owner decision remain required.

## Canonical record shape

The eventual JSON record must contain exactly this conceptual envelope (the implementation may add only explicitly versioned additive fields):

```json
{
  "schemaVersion": "stage0-evaluator-boundary-v2",
  "designRecordId": "stage0_v2_<uuid>",
  "integrityMode": "local-weak-exact-bytes",
  "designPayload": {},
  "designPayloadCanonicalJson": "<canonical UTF-8 JSON, no trailing newline>",
  "provenance": {},
  "approvalEvidence": {}
}
```

`designRecordId` is an opaque random locator, not a content identity and not an integrity proof. `designPayloadCanonicalJson` is produced from the allowlisted `designPayload`; verification recomputes the canonical bytes and compares them exactly to the stored bytes. The approval evidence separately records the approved record id and approved canonical bytes. No cryptographic tamper guarantee is claimed.

## Canonicalization and exact-byte binding

The planned implementation uses one pinned RFC 8785 JSON Canonicalization Scheme (JCS) implementation. The dependency name and exact version must be recorded in `provenance.canonicalizerDependency` before freeze; no hand-written fallback or ordinary pretty-printed JSON is acceptable.

The procedure is:

1. Construct the allowlisted `designPayload`. Reject unknown top-level fields, duplicate object keys, non-finite numbers, non-JSON values, and strings or bytes not representable as UTF-8.
2. Canonicalize the payload with the pinned JCS implementation, producing exact UTF-8 bytes with no trailing newline.
3. Store those bytes as `designPayloadCanonicalJson`; the field must round-trip as the exact UTF-8 sequence. Recanonicalizing identical payloads must produce byte-identical output.
4. `approvalEvidence.approvedBoundaryDesignRecordId` must equal `designRecordId`, and `approvalEvidence.approvedDesignPayloadCanonicalJson` must equal `designPayloadCanonicalJson` byte-for-byte.
5. Any payload, canonical-byte, record-id, or approval mismatch yields refusal. If a coordinated actor mutates both the record and approval evidence, local-weak mode cannot detect that mutation; this limitation is mandatory labeling, not an implementation defect.

The record cannot be frozen until the dependency, allowlist, exact-byte comparison, and limitation wording are independently reviewed.

## Required design payload

The payload must explicitly record:

- authoritative evaluator bundle and result schema are outside candidate/worker write scope;
- candidate self-tests are evidence only and cannot replace the evaluator;
- evaluator mutation, missing evaluator, policy/identity drift, and foreign or stale inputs refuse collection before outcome classification;
- Stage 0 cannot issue an apply capability, approve an apply, or register a worker-write tool;
- `integrityMode: "local-weak-exact-bytes"` and the absence of cryptographic tamper resistance;
- crash assumptions: process interruption may leave an ambiguous durable boundary, and recovery must refuse to infer success from missing receipts;
- replay assumptions: duplicate records are detected by opaque record/idempotency locators, known replays return the recorded result, and ambiguous replays stop for review; Git rollback does not undo external side effects;
- reproducibility and mutation-refusal criteria below.

The payload must also identify the exact evaluator write-exclusion paths, candidate write paths, repository/tenant boundary, runtime/tool/policy identity fields, and the absence of apply-capability issuance.

## Provenance and approval binding

`provenance` records the source revision, inspected source paths, author/session identity, model/provider identity, review request id, canonicalizer dependency, and creation time. Provenance is evidence about how the draft was produced; it is not approval.

`approvalEvidence` records the reviewer/owner identity, decision, decision time, review artifact reference, scope, `approvedBoundaryDesignRecordId`, and `approvedDesignPayloadCanonicalJson`. Approval is valid only when the id and canonical bytes exactly match the design record. No approval is recorded by this draft.

## Reproducibility and mutation refusal

A future implementation may report a reproducible Stage 0 record only when two independent canonicalization passes over the same allowlisted payload produce byte-identical canonical JSON and a fresh parse round-trip preserves the bytes and all allowlisted values. It must refuse:

- any change to evaluator files, evaluator result schema, write-exclusion, runtime/tool/policy identity, integrity mode, crash/replay assumptions, or capability absence after the exact-byte binding;
- an approval whose bound record id or canonical bytes differ from the design record;
- a record with unknown fields, duplicate keys, invalid UTF-8/canonical JSON, missing provenance, missing mutation/refusal rules, or circular approval inputs;
- any attempt by a candidate/worker to write the authoritative evaluator or issue an apply capability from the read-only boundary.

These are draft acceptance criteria, not evidence that enforcement exists.

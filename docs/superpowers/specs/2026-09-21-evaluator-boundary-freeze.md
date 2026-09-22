# Stage 0 evaluator/apply boundary freeze record (draft)

> **Removal gate (2026-09-21):** This draft is blocked by [TASK-20260921-remove-sha256](../plans/2026-09-21-remove-sha256.md) and [ADR-008](../../decisions/0008-remove-sha256.md). Its digest-bound identity and integrity procedure must not be implemented, frozen, or used for authorization until the owner approves the successor contract and legacy fail-closed policy. This remains a draft and does not authorize writes, apply, or live runs.

## Status and scope

- State: `draft — REQUEST CHANGES; not approved, not frozen`
- Planned record location: `.agent_workspace/evidence-first-reconciliation/stage0-freeze-record.json`
- This document specifies the record; it is not the record, an approval, or an authorization.
- Stage 0 is design-only. It does not register tools, issue apply capabilities, mutate a source repository, or authorize a live provider run.
- Review provenance: fresh-context same-model author review only; not independent review. A fresh independent review and owner decision remain required.

## Canonical record shape

The eventual JSON record must contain exactly this conceptual envelope (the implementation may add only explicitly versioned additive fields):

```json
{
  "schemaVersion": "stage0-evaluator-boundary-v1",
  "designPayload": {},
  "boundaryDesignDigest": "sha256:<64 lowercase hex>",
  "provenance": {},
  "approvalEvidence": {}
}
```

`designPayload` is the only input to `boundaryDesignDigest`. It contains the
boundary invariants, evaluator write-exclusion, integrity mode, crash/replay
assumptions, capability absence, and refusal/reproducibility criteria below.
`provenance` and `approvalEvidence` are recorded separately so timestamps,
review events, and approval evidence do not make the design digest circular.

## Deterministic canonicalization and hashing

The planned implementation uses RFC 8785 JSON Canonicalization Scheme (JCS)
through a pinned, reviewed implementation dependency. The dependency name and
exact version must be recorded in `provenance.canonicalizerDependency` before
freeze; no hand-written fallback or ordinary pretty-printed JSON is acceptable.
The procedure is:

1. Construct the allowlisted `designPayload` object. Reject unknown top-level
   fields, duplicate object keys, non-finite numbers, non-JSON values, and
   strings or bytes not representable as UTF-8.
2. Canonicalize that object with the pinned RFC 8785 implementation, producing
   the exact UTF-8 JCS byte sequence with no trailing newline.
3. Compute SHA-256 over those bytes and encode the digest as lowercase
   hexadecimal with the literal `sha256:` prefix.
4. Store the canonicalizer dependency/version, canonical bytes hash, and
   digest in the record. Recanonicalizing identical payloads must produce byte-
   identical output and the same digest; any payload mutation must produce a
   different digest or be refused as an invalid record.
5. `boundaryDesignDigest` in `approvalEvidence` is a reference to the digest
   above, never an input to `designPayload`. Approval evidence is hashed, if
   needed, over its own payload excluding its derived evidence digest and the
   already-bound `boundaryDesignDigest`; this prevents circularity.

Until the dependency, allowlist, and implementation test are reviewed, the
record cannot be frozen.

## Required design payload

The payload must explicitly record:

- authoritative evaluator bundle and result schema are outside candidate/worker
  write scope;
- candidate self-tests are evidence only and cannot replace the evaluator;
- evaluator mutation, missing evaluator, policy/identity drift, and foreign or
  stale inputs refuse collection before outcome classification;
- Stage 0 cannot issue an apply capability, approve an apply, or register a
  worker write tool;
- `integrityMode` (`local-weak` or a separately approved stronger mode), with
  local-weak results labeled as such and never promoted to production claims;
- crash assumptions: process interruption may leave an ambiguous durable
  boundary, and recovery must refuse to infer success from missing receipts;
- replay assumptions: duplicate records are detected by identity/idempotency
  keys, known replays return the recorded result, and ambiguous replays stop
  for review; Git rollback does not undo external side effects;
- reproducibility and mutation-refusal criteria below.

The design payload must also identify the exact evaluator write-exclusion paths,
candidate write paths, repository/tenant boundary, runtime/tool/policy identity
fields, and the absence of apply-capability issuance.

## Provenance and approval binding

`provenance` records the source revision, inspected source paths, author/session
identity, model/provider identity, review request ID, canonicalizer dependency,
and creation time. Provenance is evidence about how the draft was produced; it
is not an approval.

`approvalEvidence` records the reviewer/owner identity, decision, decision time,
review artifact reference, scope, and `approvedBoundaryDesignDigest`. The
approval evidence is valid only when that field exactly equals the calculated
`boundaryDesignDigest`. A decision that omits the digest, binds another digest,
or claims approval of a different scope is invalid. No approval is recorded by
this draft.

## Reproducibility and mutation refusal

A future implementation may report a reproducible Stage 0 record only when two
independent canonicalization passes over the same allowlisted payload produce
the same canonical-byte hash and `boundaryDesignDigest`, and a fresh parse
round-trip preserves the digest and all allowlisted values. It must refuse:

- any change to evaluator files, evaluator result schema, write-exclusion,
  runtime/tool/policy identity, integrity mode, crash/replay assumptions, or
  capability absence after digest calculation;
- an approval whose bound digest differs from the design digest;
- a record with unknown fields, duplicate keys, invalid SHA-256 form, missing
  provenance, missing mutation/refusal rules, or circular digest inputs;
- any attempt by a candidate/worker to write the authoritative evaluator or
  issue an apply capability from the read-only boundary.

These are draft acceptance criteria, not evidence that enforcement exists.

# Stage 0 owner freeze decision package

## Decision status

- Package state: `ready-for-owner-review`.
- Boundary state: **not approved; not frozen**.
- Evidence revision: `7d7cd59bb313f53c605d6e9988be910bfe5e3ec8`.
- Independent current-slice review: **PASS**, recorded in
  [the integrated review](2026-09-25-integrated-review.md).
- This package provides choices and evidence. It does not create
  `approvalEvidence`, authorize a provider/pilot/apply action, or register a
  worker-write surface.

## Owner decision requested

The owner/reviewer must decide whether S0-min may proceed with the following
host-owned outcome boundary and canonical byte contract. A decision must name
the approved option, scope, reviewer/owner identity, time, and reviewed revision.

### Host-owned terminal outcome DTO

Freeze a neutral DTO outside `src/learning/` with these required bindings:

- opaque `outcomeRef` and `bindingRef`;
- project, episode, run, task, model and target artifact identity/version;
- evaluator and rubric identity/version;
- terminal outcome limited to `PASSED` or `FAILED`;
- at least one non-empty opaque evidence reference;
- explicit failure attribution separating provider/run/tool failures from a
  model-attributable evaluated result;
- canonical evaluator-definition bytes that must match the frozen definition.

Missing, deleted, foreign, mismatched, legacy, incomplete, or self-reported-only
sources remain `UNOBSERVED` and ineligible. Child messages, Pi tool arguments,
model prose, and `extraSignals` cannot write or upgrade this host-owned channel.

### Source and failure rules

- The authoritative evaluator bundle/result is outside candidate and worker
  write scope.
- Candidate self-tests are supporting evidence only.
- A provider error, timeout, unavailable evaluator, identity drift, or ambiguous
  crash/replay state cannot become `FAILED` against the model and cannot close an
  evidence gap.
- Stage 0 is design-only. It cannot issue an apply capability, approve apply,
  activate routing, start a pilot, or authorize worker writes.
- Exact-byte binding remains `local-weak-exact-bytes`; coordinated mutation of
  both the record and approval evidence is not cryptographically detectable.

## Canonicalizer conflict and options

Two active documents currently conflict:

- the Stage 0 draft requires a pinned external RFC 8785 JCS implementation;
- the controlled-improvement roadmap requires reuse of one project canonicalizer
  and identifies the existing `src/experiments/manifest.ts::stableStringify`
  path, with no second canonical JSON implementation.

The boundary cannot be frozen while both claims remain active.

### Option A — project deterministic JSON v1 (recommended for S0-min)

Approve the existing sorted-key serializer as the project-versioned
`pi-sparkle-stable-json-v1` canonicalizer for S0-min/L1, explicitly **not** as
RFC 8785/JCS. Before freeze, amend the Stage 0 draft and add a strict allowlist
validator that rejects unknown fields, duplicate parsed keys, non-finite numbers,
`undefined`/non-JSON values, invalid Unicode, and trailing bytes/newlines.

Why recommended: it follows the controlling roadmap, adds no dependency or
second byte contract, and keeps existing deterministic experiment bytes stable.
Its limitation must remain explicit: it is a project contract, not standards
conformance.

### Option B — pinned RFC 8785 JCS

Approve a named external package and exact version, then amend the roadmap and
migrate every exact-canonical-byte consumer to that one implementation before
S0-min acceptance. Keeping both JCS and `stableStringify` as authoritative
canonicalizers is not allowed.

Why this may be chosen: standards conformance and a smaller custom-algorithm
surface. Cost: dependency/provenance review, byte-compatibility analysis, and a
separate migration because existing experiment identities may change.

### Refused option

Do not freeze a record that labels `stableStringify` as RFC 8785, and do not add
JCS while leaving the controlling roadmap and existing exact-byte consumers
unchanged. Either path would create a false or dual contract.

## Approval choices

The responsible owner/reviewer may record exactly one of:

1. `APPROVE_OPTION_A_FOR_IMPLEMENTATION_REVIEW` — permits implementation and
   independent review of the versioned project canonicalizer/DTO only; it does
   not yet mark Stage 0 frozen.
2. `APPROVE_OPTION_B_MIGRATION_PLAN` — permits a separate JCS dependency and
   migration plan/review only; it does not yet mark Stage 0 frozen.
3. `REQUEST_CHANGES` — names missing fields or a different canonicalizer rule.
4. `DEFER` — leaves S0-min, L1, provider, pilot, and apply gates closed.

A later `FROZEN` decision is valid only after the chosen implementation,
canonical-byte tests, DTO parser/binding tests, independent review, and exact
approval binding are present. This package cannot be used as that evidence.

## Evidence available to the decision

- Corrected implementation and current contracts:
  `7d7cd59bb313f53c605d6e9988be910bfe5e3ec8`.
- Independent corrected-slice review: 90 focused tests, typecheck and workflow
  PASS, no findings.
- Author full gate: 2879 passed, 0 failed, 18 skipped; build PASS.
- Security/Pi probes: 26 PASS and 4 PASS respectively.
- Existing Stage 0 draft remains `draft — REQUEST CHANGES; not approved, not
  frozen`.
- Real provider, pilot, production apply, holdout/F6 and post-L2 final review:
  **NOT RUN / NOT APPROVED** for this decision.

## Next step after owner decision

- Option A: amend the Stage 0 draft, define/export the strict versioned
  canonicalizer and neutral DTO, write RED binding/refusal tests, then obtain an
  independent review before recording any freeze.
- Option B: write the dependency/migration plan and compatibility evidence first;
  do not implement L1 against an interim serializer.
- REQUEST CHANGES or DEFER: keep S0-min and all dependent work closed.

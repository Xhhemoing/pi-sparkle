# Stage 0 minimum owner decision record

## Decision

- Owner: `coordinator`.
- Decision: `APPROVE_OPTION_A_FOR_IMPLEMENTATION_REVIEW`.
- Decision time: `2026-09-25 (applicable session date; no wall-clock minute asserted)` (Asia/Shanghai).
- Reviewed base: `e1ce19c0f93d8e34e7ca25512c5d32d2743ba669`.
- Decision scope: implementation and independent review of S0-min Option A
  only.
- Boundary state: **authorized for implementation review; not frozen**.

The coordinator chose Option A because it preserves the existing deterministic
experiment bytes, adds no dependency or second canonicalizer, and follows the
controlling controlled-improvement roadmap. The controlling canonical byte
contract is the project-versioned `pi-sparkle-stable-json-v1`, backed by the
existing `src/experiments/manifest.ts::stableStringify` behavior. This contract
is explicitly not RFC 8785/JCS and claims only
`local-weak-exact-bytes` binding.

## Authorized implementation scope

This decision permits S0-min implementation and review of:

- one reusable project canonicalizer contract named
  `pi-sparkle-stable-json-v1`, without a parallel JCS implementation;
- a strict allowlist validator/parser that refuses unknown or missing fields,
  duplicate object keys, non-finite numbers, `undefined` and other non-JSON
  values, invalid UTF-8, unpaired Unicode surrogates, trailing bytes/newlines,
  and parse/serialize or exact-byte mismatches;
- a neutral, host-owned terminal outcome DTO outside `src/learning/`, bound to
  project, episode, run, task, model, target artifact, evaluator, rubric, and
  canonical evaluator-definition identities/versions;
- source, binding, and failure-attribution rules that leave missing, deleted,
  foreign, stale, legacy, incomplete, self-reported-only, or mismatched evidence
  `UNOBSERVED` and ineligible;
- RED-to-GREEN tests for canonical bytes, strict refusal, DTO parsing, identity
  binding, and failure attribution.

The authoritative evaluator bundle/result and terminal outcome channel remain
outside candidate and worker write scope. Provider errors, tool/run failures,
timeouts, unavailable evaluators, and ambiguous crash/replay states cannot be
converted into model-attributable `FAILED` outcomes or used to close evidence
gaps.

## Implementation preconditions

1. Reuse or move the existing serializer behavior behind the single versioned
   project contract; do not introduce a second authoritative canonicalizer.
2. Preserve current deterministic experiment bytes and demonstrate that
   preservation with exact-byte tests before review.
3. Detect duplicate keys and invalid byte/text forms before a normal JSON parse
   can erase the evidence needed for refusal.
4. Keep the DTO neutral and host-owned; child messages, Pi tool arguments, model
   prose, self-tests, and `extraSignals` cannot write or upgrade it.
5. Bind approval evidence to the exact opaque record id and exact canonical
   bytes, while retaining the mandatory local-weak limitation statement.
6. Keep implementation within the existing S0-min lease and obtain independent
   specification and quality review for the exact candidate revision.

## Remaining freeze gates

A later owner/reviewer may record `FROZEN` only after all of the following are
present for one exact revision:

- the chosen canonicalizer and strict validator implementation;
- exact-byte stability, duplicate-key, invalid-value/Unicode/UTF-8, trailing
  data, DTO parser, source binding, deletion/mismatch, and failure-attribution
  tests;
- independent review of the implementation and its pinning tests;
- exact approval binding for the design record id and canonical bytes;
- a durable verification record with focused commands and the applicable gate;
- owner confirmation that the reviewed bytes and scope are the bytes being
  frozen.

Until those gates close, S0-min is not accepted or frozen and L1 acceptance
remains blocked. This decision does not authorize provider or pilot runs, apply,
routing activation, registry activation, promotion, production writes, or F6.

## Evidence and controlling references

- [Owner decision package](2026-09-25-stage0-owner-freeze-package.md)
- [Controlling Stage 0 draft correction](../superpowers/specs/2026-09-21-evaluator-boundary-freeze.md)
- [Controlled-improvement roadmap](../superpowers/plans/2026-09-25-controlled-improvement-roadmap.md)
- [B0 verification record](2026-09-25-controlled-improvement-b0-verification.md)

This record captures the owner decision only. It is not implementation evidence,
an independent review verdict, or a Stage 0 freeze record.
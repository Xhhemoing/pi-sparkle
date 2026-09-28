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

## Implementation candidate and verification

- Candidate state: `ready-for-review`; **not accepted and not FROZEN**.
- Implementation base: `f648a739bcf035e662c769228b69268f65fe81e6`.
- Corrected implementation revision: `9120de679e2bb61764dd78a7ff2fc06fd3900ce6`.
- Lease: the two S0-min documents, `src/domain/canonical-json.ts`,
  `src/evaluation/types.ts`, `src/evaluation/evaluator.ts`,
  `src/experiments/manifest.ts`, and the four leased unit-test files only.
- Canonical contract: `pi-sparkle-stable-json-v1`, explicitly non-RFC8785/JCS
  and `local-weak-exact-bytes`; no dependency was added.
- Strict entry points: `canonicalizeStableJson` and `parseStableJsonBytes`.
  They reject duplicate keys before ordinary parsing, unknown/missing outcome
  fields, non-JSON JS values, sparse/cyclic/non-plain/accessor values, invalid
  UTF-8 or Unicode, BOM, whitespace/trailing data, and non-canonical bytes.
- Compatibility: the existing experiment `stableStringify` export and all
  valid-value bytes remain stable. Historical non-JSON compatibility output is
  outside the versioned contract and cannot pass its parser.
- Outcome boundary: `host-terminal-outcome-v1` is host-owned and binds every
  required identity, the opaque `outcomeRef` and `bindingRef`, plus
  canonical evaluator-definition bytes. Missing,
  deleted, foreign, stale, legacy, incomplete, self-reported-only, mismatched,
  or operational-failure sources resolve to `UNOBSERVED` and are ineligible.

Verification evidence is under
`.agent_workspace/controlled-improvement-s0-min-20260925/`:

| Phase | Exact command | Result | Raw log |
|---|---|---|---|
| RED | `pnpm test -- --test-concurrency=1 test/unit/domain/canonical-json.test.ts test/unit/evaluation/evaluation-identity.test.ts test/unit/experiments/freeze.test.ts test/unit/experiments/task-spec.test.ts` | expected failure: 0 pass, 4 fail because the new APIs did not exist | `red-focused.log` |
| focused GREEN | `pnpm test -- --test-concurrency=1 test/unit/domain/canonical-json.test.ts test/unit/evaluation/evaluation-identity.test.ts test/unit/evaluation/evaluator-precedence.test.ts test/unit/experiments/freeze.test.ts test/unit/experiments/task-spec.test.ts test/unit/experiments/readonly-evaluator-manifest.test.ts test/integration/experiments/readonly-evaluator-freeze.test.ts` | PASS: 47 pass, 0 fail, 0 skip | `green-focused-final.log` |
| typecheck | `pnpm typecheck` | PASS | command output captured in session |
| targeted lint | `pnpm exec eslint src/domain/canonical-json.ts src/evaluation/types.ts src/evaluation/evaluator.ts src/experiments/manifest.ts test/unit/domain/canonical-json.test.ts test/unit/evaluation/evaluation-identity.test.ts test/unit/experiments/freeze.test.ts test/unit/experiments/task-spec.test.ts` | PASS | command output captured in session |
| full gate | `pnpm gate` | PASS after building the clean worktree: 2889 pass, 0 fail, 18 skip; typecheck, lint and build PASS | `gate-final.log` |
| security | `$env:npm_config_cache = '<evidence-root>/npm-cache'; pnpm security:probe` | PASS: 26 probes, 0 open findings | `security-probe-final.log` |
| binding-ref RED | `pnpm test -- --test-concurrency=1 test/unit/evaluation/evaluation-identity.test.ts` | expected failure: 47 pass, 2 fail; separate `outcomeRef` and `bindingRef` mismatches were incorrectly eligible | `binding-ref-red.log` |
| binding-ref focused GREEN | `pnpm test -- --test-concurrency=1 test/unit/evaluation/evaluation-identity.test.ts` | PASS: 49 pass, 0 fail, 0 skip | `binding-ref-green.log` |
| corrected typecheck | `pnpm typecheck` | PASS | command output captured in session |
| corrected targeted lint | `pnpm exec eslint src/evaluation/types.ts src/evaluation/evaluator.ts test/unit/evaluation/evaluation-identity.test.ts` | PASS | command output captured in session |
| corrected workflow | `pnpm workflow:check` | PASS: 10 required files, 16 required headings | command output captured in session |
| corrected full gate | `pnpm gate` | PASS: 2891 pass, 0 fail, 18 skip; typecheck, lint and build PASS | `binding-ref-gate.log` |
| corrected security | `pnpm security:probe` | PASS: 26 probes, 0 open findings | `binding-ref-security.log` |

## Independent review finding and correction

Independent specification review of exact revision
`a7677aa56ced7ffbcbfdd00cfa6cfd26120a90cb` returned **REQUEST CHANGES**.
`HostTerminalOutcomeBinding` and the runtime `HOST_BINDING_FIELDS` comparison
omitted the opaque `outcomeRef` and `bindingRef`. A caller could therefore
supply mismatched references while the outcome remained eligible, contrary to
the authorized exact source/binding identity contract.

The correction followed RED-to-GREEN discipline. Two separate regression tests
first reproduced the missing `outcomeRef` and `bindingRef` comparisons (47 pass,
2 expected failures). Revision
`9120de679e2bb61764dd78a7ff2fc06fd3900ce6` then adds both fields to the binding
type and runtime comparison; the focused suite passes 49/49. The corrected
candidate also passes typecheck, targeted lint, workflow validation, the full
gate (2891 pass, 0 fail, 18 skip), and security probes (26 pass, 0 open
findings).

The earlier **REQUEST CHANGES** remains part of the review history and is not
rewritten as a pass. The corrected revision is `ready-for-review`; it requires
fresh exact-revision specification review before exact-revision quality review.
No independent PASS or owner freeze is recorded here.

The first full-gate attempt is retained in `gate.log`: it correctly exposed two
legacy experiment callers that pass optional `undefined` through the historical
compatibility API, plus one clean-worktree missing-`dist` prerequisite. The
candidate kept strict refusal on the versioned contract, preserved the legacy
API only outside that contract, ran `pnpm build`, and then obtained the passing
gate above. The first security run is retained in `security-probe.log`; its sole
packaging check was blocked by the default npm cache location. The rerun used the
evidence-local cache and passed all probes.

This record captures the owner decision, the original exact-revision
**REQUEST CHANGES**, and author verification of the corrected candidate. The
candidate remains `ready-for-review`; it is **not accepted and not FROZEN**.
Independent exact-revision specification review must PASS before exact-revision
quality review, and a later owner must separately bind and record `FROZEN`.
L1, provider and pilot runs, apply, routing activation, registry activation,
promotion, production writes, and F6 remain closed.

## 2026-09-28 integration review correction — legacy provenance

Fresh independent specification review of `d095a099` identified an inaccurate
claim in the historical compatibility summary above: legacy non-JSON inputs can
serialize to bytes that pass the strict byte parser (for example NaN becomes
`null`, Date becomes `{}`, and `[undefined]` becomes `[]`). The strict producer
`canonicalizeStableJson` rejects those original values; `parseStableJsonBytes`
can validate only the received bytes and cannot recover producer provenance.
This dated correction supersedes the earlier "cannot pass its parser" claim.

The current specification and source comment now require strict serialization
for new boundary records plus the existing host source/binding checks. Legacy
experiment bytes and all runtime implementations are unchanged. A five-case
in-memory probe reproduced both strict rejection and legacy/parser ambiguity;
raw output is in `.agent_workspace/sync-20260928/legacy-provenance-probe.log`.
Independent re-review and integration outcomes are recorded in the
[2026-09-28 sync report](2026-09-28-sync-merge.md). No owner freeze follows.

The historical strict-entry-point summary also grouped outcome allowlisting
under the generic canonical JSON APIs. Precisely, `canonicalizeStableJson`
validates JS values, `parseStableJsonBytes` validates encoded canonical JSON,
and `parseHostTerminalOutcome` enforces the outcome field allowlist and DTO
shape. This clarification changes no runtime behavior.

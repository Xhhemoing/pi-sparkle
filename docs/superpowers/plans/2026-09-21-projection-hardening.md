# Projection hardening and telemetry implementation plan

> **ADR-008 correction (2026-09-22):** the successor identity contract is opaque versioned locators plus exact-byte comparison; no SHA-256 or replacement cryptographic hash is selected. This child plan is still blocked on Stage 0 independent review and owner/evaluator freeze. Do not modify product code or collect live evidence before that gate.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` task-by-task. This plan is independent of the apply-boundary plan.
>
> **Implementation reconciliation (2026-09-22):** the author-run engineering slice was implemented on the dirty worktree under the existing owner instruction to continue bounded native hardening. The independent-review and owner/evaluator-freeze gates remain open; no live-provider collection or pilot authorization follows. Subsequent fail-closed corrections are recorded in [the verification report](../../reports/2026-09-22-projection-and-readonly-manifest.md).
>
> **Security-boundary correction (2026-09-25):** `secretBearing` is no longer a caller assertion. The projector derives sensitivity from the original read parameters/path and the returned text before any observation-store write. Missing or malformed read parameters fail closed. The author-run record is [2026-09-25 projection secret boundary](../../reports/2026-09-25-projection-secret-boundary.md); this still does not freeze Stage 0 or authorize a pilot.

**Goal:** Make native observation projection identity-safe, fail-closed for non-projectable results, cumulatively budgeted, and measurable without changing the default-off contract.

**Architecture:** Keep `ObservationStore` run-scoped with opaque versioned locators and exact-byte dedupe. Use an observation-store-backed exact-byte identity for the in-memory run-local send counter: identical bytes reuse the same opaque observation reference, while different bytes are never grouped by a prefix collision. Pass explicit structural projectability metadata from tool adapters; derive secret sensitivity inside the projector from the original read parameters/path and returned text. Absent, malformed, or unsafe input remains unprojected. Add a run-local recall budget above the existing per-page cap. Emit mechanism and cost-observation records without changing live routing or historical event contracts.

**Tech Stack:** TypeScript, Node fs, existing opaque-id `ObservationStore`, `projectObservation`, Pi `AgentTool` adapter, JSONL telemetry, Vitest-style project test runner.

## Identity and gate

- Owner: native adapter maintainer; owner/evaluator approval is required before
  any live-provider collection.
- State: `planned — engineering-only, default-off; blocked until Stage 0 is independently reviewed and owner/evaluator-frozen`.
- Dependency: the pre-pilot evaluator/apply boundary design must be independently
  reviewed and owner/evaluator-frozen, recording that this work cannot issue
  apply capabilities or authorize writes. The current Stage 0 correction is
  author-verified only; two review dispatches failed with `UNOBSERVED`.
- Refusal rule: missing or unsafe projectability metadata, unknown run binding,
  cross-run refs, and exhausted recall budgets fail closed; they never become a
  smaller or silently truncated observation.

## Typed projectability contract (draft)

The adapter must pass explicit metadata for every candidate result before a live
C arm is allowed to run:

```ts
interface ProjectabilityMetadata {
  resultKind: "observation" | "receipt" | "permission" | "error" | "other";
  isError: boolean;
  mutatesState: boolean;
  securityCritical: boolean;
  toolKind: "read" | "write" | "permission" | "verification" | "other";
  toolPolicyProjectable: boolean;
}
```

Only `resultKind: "observation"` from a read tool with the structural safety
booleans false and `toolPolicyProjectable: true` can be projectable. The
projector then requires a valid read `path`, rejects credential-like paths
(`.env*`, credential/auth files, private-key files and secret directories), and
uses the shared secret detector on the result text. Callers cannot declare
`secretBearing: false`. Missing metadata or unverifiable read parameters fail
closed. The existing evidence-receipt marker remains a compatibility fallback
and also forces ineligibility; it is not an authorization signal.

## Recall budget (draft defaults)

The existing per-page caps remain **16,384 UTF-8 bytes** and **400 lines**.
Before implementation freezes values, use these proposed run-local defaults:

- one recall call: at most 16,384 bytes, 400 lines, and 4,096 provider tokens
  when a tokenizer is available;
- one run: at most 262,144 bytes, 65,536 provider tokens when token usage is
  knowable, 32 pages, and 16 recall calls.

Byte, line, page, and call limits are always enforceable. Token observations
carry tokenizer/provider identity; when unavailable they are `unknown`, never
zero, and the byte/page/call limits still apply. A budget refusal is a typed
receipt containing the run/ref identity, exhausted dimension, observed amount,
limit, and requested offset; it never silently truncates a receipt.

## Global Constraints

- Default `contextEfficiency` remains false and disabled output remains byte-identical.
- No cross-session counter persistence or cross-run/cross-tenant recall.
- Error, receipt, permission, secret-bearing, state-mutating, and security-critical results fail closed.
- No R1/bandit/topology imports or live-isolation allowlist changes.
- Observation deletion remains covered by `delete --run`; raw archived bytes follow the existing `run-observation` policy.

## Files

- Modify `src/pi-adapter/observation-tools.ts`: typed metadata, exact-byte observation identity counter, recall budget — only after Stage 0 freeze.
- Modify `src/pi-adapter/native-executor.ts`: explicit metadata from read-tool result and budget-aware recall tool.
- Modify `src/context/observation-projection.ts`: accept typed projectability policy without weakening marker fallback.
- Modify `src/context/observation-store.ts`: expose existing page caps; do not change run archive limits unless separately justified.
- Create/modify `src/telemetry/observation-metrics.ts` only if existing telemetry surfaces cannot represent mechanism rows.
- Test `test/unit/pi-adapter/observation-tools.test.ts`, `test/unit/context/observation-projection.test.ts`, `test/unit/context/observation-store.test.ts`, and adapter loopback tests.

## Acceptance Criteria

- [ ] An observation-store-backed exact-byte identity is the send-counter key; a same-path middle-content mutation receives a fresh first-two window and distinct contents cannot collide through head/tail/length prefixing.
- [ ] A large result with missing metadata, `isError`, `mutatesState`,
  `securityCritical`, a credential-like or unverifiable read path, detected
  secret content, non-observation `resultKind`, a write or verification
  `toolKind`, or false tool policy is never packed. Secret-bearing status is
  derived by the projector, not asserted by the caller.
- [ ] Missing metadata fails closed; the existing receipt marker remains
  fail-closed.
- [ ] Recall enforces the existing per-page caps plus the frozen run-local byte,
  token (when knowable), page, and call limits; exhaustion returns the typed
  refusal described above and never silently truncates a receipt.
- [ ] Recall after source mutation returns the archived snapshot; deletion and
  resume behavior remain fail-closed/documented.
- [ ] Two provider contexts preserve an append-only prefix; no old message is
  rewritten.
- [ ] Mechanism rows record `repeatMassBytes`, provider-token
  `repeatMassTokens` when known, projection/placeholder bytes, recall/budget
  refusals, and storage-unavailable fallback.
- [ ] Cost rows preserve input tokens, cached input tokens, output tokens,
  provider-reported usage/cost, runtime cost, retry/failed-attempt counts, wall
  time, and unknown values without zero imputation.
- [ ] `test/unit/routing/live-isolation.test.ts` remains unchanged and green.

## Test-first steps

1. After Stage 0 freeze, add RED tests for exact-byte middle-content collision, typed unsafe metadata, missing metadata, recall cumulative budget, source mutation, delete, resume, and prefix capture.
2. Run focused tests and record expected failures.
3. Implement the smallest metadata and budget interfaces.
4. Run focused tests, then `pnpm gate`, `pnpm security:probe`, and `pnpm pi:probe`.
5. Record results in a new verification report; do not mark live benefit.

## Gates

- Engineering-only until a real provider is involved.
- Abort on default-path byte changes, cross-run access, silent budget truncation, or live-isolation changes.
- Handoff artifact: verification report plus measurement spec link. Current handoff remains blocked; this documentation correction does not authorize implementation.

# Stage 0 boundary correction — verification record

## Identity

- Task: `TASK-20260922-stage0-boundary-correction`
- Date/environment: 2026-09-22, Windows worktree `E:\Project\pi-sparkle`
- Scope: documentation-only correction of the Stage 0 boundary and read-only evaluator drafts
- Status: **author-run correction verified; Stage 0 remains draft, unapproved, and unfrozen**
- Related: [correction plan](../superpowers/plans/2026-09-22-stage0-boundary-correction.md), [ADR-008](../decisions/0008-remove-sha256.md), [Stage 0 draft](../superpowers/specs/2026-09-21-evaluator-boundary-freeze.md)

## Changes

- Replaced the Stage 0 `sha256:` digest procedure with `stage0_v2_<uuid>` opaque record identity plus exact canonical UTF-8 byte comparison in `local-weak-exact-bytes` mode.
- Made the limitation explicit: coordinated mutation of both the record and approval evidence is not cryptographically detectable; no tamper-resistance claim is made.
- Changed the read-only manifest from digest-shaped fields to opaque references and canonical-byte fields (`manifest_v2_`, `arm_v2_`, `boundaryDesignRecordId`), with common-versus-arm precedence defined.
- Moved `taskAttemptEnforcement: "not-implemented"` into `protocolLimitations` rather than presenting it as an implemented frozen capability.
- Recorded A-arm source facts and mismatch refusal: native executor boundary, host authentication boundary, `sparkle_read_file` filtering, projection-dependent recall registration, and local executor retry scope.
- Updated phase, pilot, measurement, evaluator/apply, and read-only freeze documents to use the corrected vocabulary.
- Updated the documentation checker to pin the corrected schema and refusal invariants.

## Verification

| Command | Result | Evidence |
|---|---|---|
| `node .agent_workspace/evidence-first-reconciliation/check-docs.mjs` | `PASS` | `targeted-doc-check: PASS (11 documents; links, schemas, arm identity, retry scope, Stage 0 draft, and review-state invariants synchronized)` |
| `pnpm workflow:check` | `PASS` | `workflow-check: ok (10 required files, 16 required headings)` |
| `git diff --check` | `PASS` | no output / exit 0 |

No product tests were required because this was documentation-only. No provider, experiment, apply, write registration, freeze-record creation, or runtime-state mutation was performed.

## Gates and limitations

- Independent low-concurrency review remains required; this is not independent verification.
- Owner/evaluator approval and the Stage 0 freeze remain open.
- No read-only manifest freeze, pilot authorization, production apply, worker-write registration, or F6 authorization follows from this correction.
- The exact-byte/local-weak design intentionally provides no cryptographic tamper guarantee. Any stronger integrity mechanism requires a separate owner-approved decision; no replacement cryptographic hash was selected.

## Independent-review dispatch update (2026-09-22)

Two low-concurrency read-only review dispatches were attempted after this correction:

- `run_e026c9af-8ae8-41d2-b7f9-c0f1d0a42aa4`, requested `cursor-grok-4.6-fast`, routed `xhh-grok/grok-4.7`, **FAILED** (`no actionable model-project issue`), acceptance `UNOBSERVED`.
- `run_da43ef03-b41a-4538-aa08-4c764f03da2a`, requested `xhh-luna/gpt-5.6-luna-fast`, routed `xhh-grok/grok-4.7`, **FAILED** (`no actionable model-project issue`), acceptance `UNOBSERVED`.

No independent verdict was obtained. These failures are not treated as relay recovery, review PASS, or Stage 0 approval. Durable dispatch notes are retained under `.agent_workspace/`.

## Execution update (2026-09-22, current session)

A further two-role read-only review dispatch was attempted through the host catalog:

- Run `run_d8ccd9db-d986-4c6d-b4bc-1b503db58ca0`, requested roles `reviewer` and `scout`, routed `xhh-grok/grok-4.7`, **FAILED** (`no actionable model-project issue`); acceptance remains `UNOBSERVED`.
- A single-review retry explicitly requesting `cursor-grok-4.6-fast` was refused before dispatch because the preferred model was unavailable.
- A further single-review retry explicitly requesting `xhh-luna/gpt-5.6-luna-fast` was routed to `xhh-luna/gpt-5.6-luna-fast` but failed with `no actionable model-project issue`; acceptance remains `UNOBSERVED` (`run_43e1f12f-af76-4414-86db-ba759424dd70`).

Author-side verification in this session remains green:

- `node .agent_workspace/evidence-first-reconciliation/check-docs.mjs` — PASS.
- `pnpm workflow:check` — PASS.
- `git diff --check` — PASS.
- `pnpm gate` — 2842 passed, 0 failed, 18 skipped.

These commands verify repository consistency and local behavior only; they do not provide an independent verdict or owner approval. Stage 0 remains draft, unapproved, and unfrozen.

The additional failed dispatch does not establish relay recovery and does not satisfy the independent-review gate.

## Dispatch attempt (2026-09-22, follow-up session)

A further low-concurrency two-role read-only dispatch was attempted:

- Run `run_27637fa2-3e86-47c9-bb6c-811734186ee4`, requested `xhh-luna/gpt-5.6-luna-fast`, roles `reviewer` and `scout`, **FAILED** (`no actionable model-project issue`); acceptance remains `UNOBSERVED`.

No independent verdict was obtained. This attempt does not establish relay recovery, review PASS, repository-consistency closure, or Stage 0 approval.

## Contract reconciliation update (2026-09-22, current session)

A local consistency scan found two current checklist descriptions that still used pre-ADR-008 `hash-verified` wording for the already-delivered apply-registration and observation-projection slices. The active entries in `tasks/todo.md` were corrected to describe opaque-id addressing plus schema/byte-length or exact-byte checks, and to state that no cryptographic tamper guarantee is claimed. A historical checklist entry was not changed.

The same scan found two stale `digest` references in the still-draft read-only evaluator freeze plan. They were corrected to opaque-reference/canonical-byte terminology; the plan remains draft-only and no implementation or pilot gate was changed.

Post-correction verification:

- `node .agent_workspace/evidence-first-reconciliation/check-docs.mjs` — PASS.
- `pnpm workflow:check` — PASS.
- `git diff --check` — PASS.
- `pnpm gate` — 2842 passed, 0 failed, 18 skipped; build completed through `tsc -p tsconfig.build.json`.
- `pnpm security:probe` — status `ok`, 26 passed, 0 open findings, 0 refused waivers.
- `pnpm pi:probe` — PASS; Pi core/AI both pinned to 0.86.1 and legacy adapter probes clear.
- `pnpm typecheck` — PASS.
- `pnpm lint` — PASS.
- `pnpm build` — PASS.

This is a documentation/status consistency correction only. It does not freeze Stage 0, authorize implementation, apply, provider calls, pilot execution, or worker-write registration.

## Handoff

Next action: obtain a successful fresh independent review through an explicitly approved channel, including the previously unrun repository-consistency role. The 2026-09-22 follow-up dispatch `run_27637fa2-3e86-47c9-bb6c-811734186ee4` also failed with acceptance `UNOBSERVED`. Later attempts `run_c431f832-89dc-42b6-882c-2aed9a6ea868` and `run_b9dc6892-d181-4941-aa1b-a99499a1dcca` failed for a separate routing defect: the explicit model was reassigned to `agentrouter/gpt-6-astra`, which the single-model executor cannot resolve. The catalog-order fix is author-verified in [model-pin record](2026-09-22-native-delegate-model-pin.md). A corrected-source session then routed `run_ab1bfcb6-4172-4630-8627-6a5ea0ab28c5` to `xhh-luna/gpt-5.6-luna-fast`, but its child stopped before persisting a verdict, so acceptance remains `UNOBSERVED`. Only after a completed review and explicit owner approval may the Stage 0 record be frozen; then projection hardening and read-only manifest work may proceed as separate reviewable slices.

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

## Handoff

Next action: obtain a successful fresh independent review through an explicitly approved channel, including the previously unrun repository-consistency role. Only after review and explicit owner approval may the Stage 0 record be frozen; then projection hardening and read-only manifest work may proceed as separate reviewable slices.

# Stage 0 boundary correction plan

## Identity

- ID: `TASK-20260922-stage0-boundary-correction`
- Owner: documentation slice owner; independent review and owner freeze remain open
- State: `verified author-run correction — not approved or frozen; independent review pending`
- Date opened: 2026-09-22
- Related: [ADR-008](../../decisions/0008-remove-sha256.md), [Stage 0 spec](../specs/2026-09-21-evaluator-boundary-freeze.md), [read-only manifest spec](../specs/2026-09-21-readonly-evaluator-manifest.md), [active checklist](../../tasks/todo.md)

## Problem and scope

The Stage 0 draft still specifies SHA-256 digest fields and does not fully separate source-bound A-baseline facts, common-versus-arm manifest precedence, or planned retry fields from frozen runtime capabilities. ADR-008 removes first-party SHA-256 and does not select a replacement cryptographic hash. The correction must make the draft internally compatible with ADR-008 without claiming tamper resistance or closing any approval gate.

### In scope

- Replace Stage 0 digest terminology with an opaque random design-record locator plus exact canonical-byte comparison in explicitly labeled local-weak mode.
- State the weak-integrity limitation: coordinated mutation of both the record and its approval evidence is not cryptographically detectable.
- Freeze the source facts that identify the A arm: native executor boundary, host authentication reuse, read-only tool set, retry scope, and absence of recall unless projection is enabled.
- Define common-versus-arm manifest precedence and remove `taskAttemptEnforcement: "not-implemented"` from the frozen capability schema; retain enforcement status as a protocol limitation outside the schema.
- Add a documentation-only verification record and link the correction from active planning records.

### Out of scope

- Stage 0 approval or freeze; owner/reviewer decision.
- Any runtime implementation, provider call, experiment, apply, write registration, manifest materialization, or `.agent_workspace/stage0-freeze-record.json` creation.
- Production integrity guarantees, cryptographic signing, migration, or selecting another cryptographic hash.

## Acceptance criteria

- [x] The Stage 0 draft has no required SHA-256 digest field and uses a versioned opaque locator plus exact canonical-byte comparison with explicit local-weak labeling. Evidence: [verification report](../../reports/2026-09-22-stage0-boundary-correction.md).
- [x] The read-only manifest defines common fields, arm overrides, precedence, and protocol-only retry enforcement status without presenting it as implemented capability. Evidence: [verification report](../../reports/2026-09-22-stage0-boundary-correction.md).
- [x] A-arm source facts and mismatch refusal are explicit and traceable to source paths. Evidence: [verification report](../../reports/2026-09-22-stage0-boundary-correction.md).
- [x] Targeted documentation checker, workflow check, and diff check pass; no freeze or authorization claim is introduced. Evidence: [verification report](../../reports/2026-09-22-stage0-boundary-correction.md).

## Implementation slice

| File/symbol | Change | Owner | Dependency/risk |
|---|---|---|---|
| `docs/superpowers/specs/2026-09-21-evaluator-boundary-freeze.md` | ADR-008-compatible Stage 0 record vocabulary and weak-integrity procedure | documentation owner | Must remain draft-only |
| `docs/superpowers/specs/2026-09-21-readonly-evaluator-manifest.md` | Common/arm precedence and protocol-only retry status | documentation owner | Must stay read-only and unfrozen |
| `docs/superpowers/plans/2026-09-21-evaluator-apply-boundary.md` | Replace digest-dependent draft language and link Stage 0 refusal semantics | documentation owner | No Stage 1 implementation |
| `docs/superpowers/plans/2026-09-21-readonly-evaluator-freeze.md` | Align dependency and identity terminology | documentation owner | No provider execution |
| `docs/superpowers/plans/2026-09-21-evidence-first-phase.md` | Correct active prerequisites and remove stale SHA implementation wording | documentation owner | Preserve open gates |
| `tasks/todo.md` | Link correction evidence without checking Stage 0 complete | documentation owner | Human/reviewer gates remain open |
| `docs/reports/2026-09-22-stage0-boundary-correction.md` | Record exact verification and unresolved gates | documentation owner | Author-run only |

## Test-first / verification plan

- Red test: not applicable; documentation-only correction.
- Focused command: `node .agent_workspace/evidence-first-reconciliation/check-docs.mjs`.
- Acceptance commands: `pnpm workflow:check` and `git diff --check`.
- Negative checks: no Stage 0 record, no approval evidence, no provider/apply/write command, no implementation file changes.

## Gates and handoff

- Human/policy gate: independent low-concurrency review and explicit owner approval are required before freezing Stage 0.
- Abort if any document claims approval/freeze, introduces a cryptographic replacement, authorizes provider/apply/write activity, or contradicts ADR-008.
- Handoff: obtain fresh independent review, including the repository-consistency role; do not proceed to read-only manifest freeze or pilot execution until Stage 0 is approved/frozen.

## Closeout

- Verified commit/date: author-run verification 2026-09-22; commit pending; independent review remains open.
- Commands/outcomes: recorded in the companion verification report.
- Open risks: weak local integrity is not tamper resistance; A-baseline provenance and owner approval remain open.

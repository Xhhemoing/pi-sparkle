# Projection hardening preflight — verification record

## Identity

- Task: `TASK-20260922-projection-hardening-preflight`
- Date: 2026-09-22
- Scope: documentation-only ADR-008 compatibility and dependency preflight
- Status: **author-run; implementation blocked until Stage 0 independent review and owner/evaluator freeze**
- Related: [projection hardening plan](../superpowers/plans/2026-09-21-projection-hardening.md), [Stage 0 correction](2026-09-22-stage0-boundary-correction.md)

## Result

The projection child plan now defines the send-counter successor as observation-store-backed exact-byte identity rather than SHA-256. It explicitly preserves default-off behavior, fail-closed metadata, run-local scope, cumulative budget requirements, and the ban on apply/write authorization. The plan does not authorize product edits or live collection before Stage 0 closes.

The exact-byte design is compatible with the current `ObservationStore` contract: `put()` compares bytes directly and returns an opaque `obs_v2_` locator; the existing projector currently uses a length/head/tail counter key and therefore remains an implementation gap to be addressed only after the Stage 0 gate.

## Verification

| Command | Result | Evidence |
|---|---|---|
| `node .agent_workspace/evidence-first-reconciliation/check-docs.mjs` | `PASS` | 11-document schema/link/review checker remains green |
| `pnpm workflow:check` | `PASS` | workflow check green |
| `git diff --check` | `PASS` | no whitespace errors |
| Product tests / provider / live pilot | `NOT RUN` | blocked by Stage 0 independent review and owner/evaluator freeze |

## Open gates

- Two Stage 0 review dispatches failed with `UNOBSERVED`; no independent verdict exists.
- Stage 0 owner/evaluator approval and freeze remain open.
- Projection code changes, mechanism/economic/outcome telemetry, read-only evaluator freeze, and A/B/C pilot remain unexecuted.
- No production apply, worker-write registration, F6, or live provider authorization follows from this preflight.

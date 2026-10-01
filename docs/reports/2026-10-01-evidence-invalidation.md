# Evidence invalidation (C2-evidence-2) — evidence record

Task: `TASK-20261001-evidence-invalidation`. Date: 2026-10-01.
Owner: implementation agent. Independent review: **not run — remains open.**
Plan: [2026-10-01-evidence-invalidation](../superpowers/plans/2026-10-01-evidence-invalidation.md).
Baseline: main `f5db35f4c76e214c1d450606b505ef40eac2ae1c` (PR #50 merged).

## Scope delivered

Host-independent C2-evidence remainder slice: stored `EvaluationRecord`s can now be re-checked against the current reference set and classified, without deletion, rewrite, or any new runtime event source.

- `src/evaluation/invalidation.ts` (new, pure, no I/O): `EvidenceReference` (artifactId/artifactVersion, rubricId/rubricVersion, evaluatorVersion, dependency name→version snapshot), `assessEvidenceValidity` → `valid | invalidated | foreign` with a reason naming the changed reference, and `partitionEvidenceValidity` batch helper (input order preserved, inputs never mutated).
- `src/evaluation/types.ts` / `evaluator.ts`: additive optional `dependencyVersions` snapshot on `EvaluationRecord` + `EvaluationInput` passthrough. Optional field; no existing field changes meaning; no record parser exists to drift.

## Semantics (fail-closed by construction)

- `valid` only when artifact version, rubric id, rubric version, evaluator version, and the dependency snapshot all match exactly (string equality; no identity inferred from revision-shaped strings).
- `invalidated` when a relevant reference changed (reason names it), when the record carries no target (`unbound`), or when the dependency snapshot does not exactly cover the current names (missing, extra, or different value → `dependency snapshot unverifiable`). Absence of a snapshot means "unverifiable", never "current".
- `foreign` for records bound to a different artifactId: unaffected evidence is **retained** this way — never invalidated by another artifact's version change, never mixed into `valid`. Equality on artifactId is the scope boundary, so mutating the reference's artifactId maps stale records to `foreign` by definition; a test comment pins this.
- No redefinition of independent PASS/UNOBSERVED; frozen `HostTerminalOutcome` DTO, event union, `RunStatus`, and learning modules untouched; `evidenceHash` remains the unused declared field (ADR-008: no cryptographic identity). Classification is advisory until a host-dependent consumer is authorized (B2).

## RED → GREEN

- RED commit `03b8820`: `test/unit/evaluation/evidence-invalidation.test.ts` on unchanged source. Expected RED confirmed: `ERR_MODULE_NOT_FOUND` for the absent module plus the missing snapshot field (1 file-level failure, no partial passes possible).
- GREEN commit `1fbfd87`: module + additive snapshot field.

Two defects were caught by the tests during implementation and fixed before delivery:

1. Test-design contradiction (author-side): the per-reference case list asserted that changing the reference's artifactId must `invalidate`, but by the module's own (and the queue's) definition those records are `foreign`. The assertion contradicted the retention semantics it was supposed to protect. Fixed the test; a comment now pins that artifactId equality is the scope boundary.
2. Over-rigid reason regex: the dependency case matched the literal case name instead of the actual reason text. Replaced with an explicit per-case `reasonPattern` asserting the real reason (`dependency tool-node version changed: recorded …, current …`).

## Commands and outcomes (author-run, Node v24.18.0, Windows)

- RED: `node scripts/run-tests.mjs test/unit/evaluation/evidence-invalidation.test.ts` → module not found (RED as designed).
- Focused GREEN: same command → **7 pass / 0 fail**; full `test/unit/evaluation` → **83 pass / 0 fail**.
- Adjacent: `test/unit/evaluation test/unit/adaptation test/unit/experiments` → **340 tests — 339 pass / 0 fail / 1 skip**.
- `pnpm typecheck` PASS (after fixing one `noUncheckedIndexedAccess`-surfaced `artifactVersion` undefined case — handled as `unavailable`, not asserted non-null); `pnpm lint` PASS; `git diff --check` clean.
- Full gate on `1fbfd87`: `pnpm gate` → workflow-check ok, typecheck PASS, lint PASS, **3241 tests — 3222 pass / 0 fail / 19 skip**, build PASS. (Pre-slice baseline 3234/3215/0/19; delta +7 tests, +1 skip accounted for by this slice.)

## Gates not claimed

Author-run automated verification only. Independent review of this slice, host-dependent wiring of the verdicts (B2/S0-min), and all owner/experiment/production/Outcome-supported gates remain open and are not asserted by this record. Dependency-name vocabulary is caller-defined in this slice; no canonical dependency registry is introduced.

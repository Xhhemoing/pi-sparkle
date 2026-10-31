# Native evidence-gap D1 — verification record

## Identity

- Task: D1 on-demand evidence-gap diagnosis
- Date/environment: 2026-09-25, Windows, `E:\Project\pi-sparkle`
- Status: author-run candidate; independent review remains open

## Scope

- Add real fail-closed JSONL/EventStore byte and record read bounds.
- Add a deterministic, read-only evidence-gap projection to run inspection.
- Keep child `PASSED`/`SUCCESS` as host `UNOBSERVED` by default.
- Permit a future read-only frozen host-outcome resolver to remove a gap.
- Require every observed host outcome to carry at least one non-empty evidence reference; malformed observed resolutions remain gaps.
- Reject valid foreign-run events found under another run's EventStore path and reject unsupported bounded non-zero-offset JSONL reads.
- Preserve event JSON, `inspect --json`, and the four-key `--summary-json` contract.

Non-goals: no new persistence, event, artifact, candidate, provider call,
retry/resume action, model blame, active-policy write, or Stage 0 conclusion.

## TDD and commands

| Command | Result | Evidence |
|---|---|---|
| `pnpm exec tsx --test test/unit/run/event-store.test.ts test/unit/run/inspection.test.ts` (RED) | `FAIL` | `readAll` ignored bounds and `buildEvidenceGapView` was missing. |
| Corrected integrated focused command | `PASS` | 71 pass / 0 fail across D1, native routing and projection boundary tests. |
| `pnpm typecheck` | `PASS` | TypeScript no-emit. |
| targeted ESLint | `PASS` | JSONL, EventStore, inspection, CLI and focused tests. |

## Behavioral evidence

- A file exceeding `maxBytes` is refused before allocation/read of its contents.
- A second complete record beyond `maxRecords: 1` is refused; no partial event list is returned.
- A child-reported successful result with frozen requirements produces
  `missing-independent-verification` and host outcome `UNOBSERVED`.
- Injecting an observed host result with a non-empty evidence reference removes that task's gap without D1 signing or persisting the result; empty/blank references remain `UNOBSERVED`.
- Existing tests pin `inspect --json` as pure event NDJSON and
  `--summary-json` to exactly `type`, `runId`, `status`, `requiredEvidence`.

## Risks and gates

- The resolver is an injection seam only; no S0-min/L1 resolver is wired here.
- Bounded inspection refuses oversized history rather than returning a partial
  diagnosis. This is deliberate because incomplete history cannot be positive evidence.
- Full gate is green at 2879 pass / 0 fail / 18 skip; the corrected current slice received independent PASS at `7d7cd59b`. D1 task-level acceptance remains open.
- Stage 0, live-provider evidence, R10/R11, F6 and outcome support remain open.

# Task Plan: delete-vs-writer race flake on Linux (privacy removal invariant)

## Identity

- ID: `TASK-20260917-delete-writer-race-flake`
- Owner: open (proposed by coding assistant session 2026-09-16/17; not yet assigned)
- State: `accepted` (closed 2026-09-17 per the abort condition — not reproducible at will; monitoring-only, owner decision recorded in the resolution report)
- Date opened: 2026-09-17
- Related ADR/spec/status row: privacy delete cascade row (docs/status-matrix.md, archive §9); `src/run/event-store.ts` header comment (adversarial tight-loop appender measurement); P0 privacy review package §7.

## Problem and Scope

### Problem

Hosted CI (ubuntu-latest, Node 22.19) on PR #42 head `aeb4993` failed once at
`test/unit/privacy/deletion.test.ts:1365` — "a live run's own writers cannot
make a delete report a removal it lost" — with "a returned delete must leave
nothing on disk" (`true !== false`) at line 1400. The delivery delta
(`5357163..aeb4993`) touches none of the involved files (`test/unit/privacy/`,
`src/privacy/`, `src/run/event-store.ts`, `src/persist/`), and a failed-job
rerun went green (run 35197315145). The failure is an intermittent Linux
scheduling race between a concurrent appender and `deleteRunRecords`: a delete
that reports success must leave nothing on disk, and one run observed a
resurrected record instead of a refused delete.

This is the exact invariant measured in the `EventStore` header comment
("0 returned success with records on disk … 30 refused" on Windows). The Linux
window is real but rare; it must not be absorbed by CI reruns.

### In scope

- Reproduce the race deterministically on Linux (CI job or WSL/container) using
  the existing adversarial-appender pattern; measure the loss rate.
- Identify the precise interleaving (append `ENOENT → mkdir → retry` racing the
  delete's verify-under-lock/re-verify-after window) and whether the re-verify
  pass can observe-then-lose a record created between its checks.
- Smallest fix: either (a) make the delete's post-removal re-verification
  closes the window (e.g., one final directory scan after the lock is released
  is NOT acceptable — must stay inside the lock), or (b) make the append path's
  directory recreation acquire the run lock, or (c) delete treats a
  post-verification resurrection as `RunRecordsSurvivedError` (already coded —
  determine why the success path was reached instead).
- Regression test that reproduces the Linux interleaving deterministically
  (scheduled interleaving or fault injection, not sleep-based).

### Out of scope

- Changes to the delete cascade semantics or record classes (P0 surface).
- The RR1/RR2/RR4 delivery or PR #42 (already verified unaffected).
- Windows behavior (already measured at 0/30 losses).

## Acceptance Criteria

- [ ] A Linux reproduction run demonstrates the race deterministically (or a
      measured bound showing why it cannot recur, with evidence).
- [ ] Root cause identified at the exact interleaving level, recorded in a
      dated report.
- [ ] Fix lands with a non-sleep-based regression test; 30+ delete iterations
      against the adversarial appender show 0 successes-with-remains on Linux.
- [ ] `pnpm gate` green on the fix commit; hosted CI green twice in a row on
      the PR head that carries it.
- [ ] Status matrix §9 (delete cascade) notes updated if the invariant
      wording changes.

## Implementation Slice

| File/symbol | Change | Owner | Dependency/risk |
|---|---|---|---|
| `src/privacy/deletion.ts` (`deleteRunRecords`) | Close or correctly report the resurrection window | open | privacy-critical; P0-adjacent, needs review |
| `src/run/event-store.ts` (append dir-recreate) | Optional: route recreate through lock or check-and-bail on missing parent | open | hot append path; bench budget +22.5% headroom documented in header |
| `test/unit/privacy/deletion.test.ts` | Deterministic interleaving regression | open | must not be sleep-based |

## Test-First Plan

- Red test: deterministic reproduction of the losing interleaving on Linux
  (container/CI); expected current-code failure observed before fix.
- Focused command: `pnpm test -- test/unit/privacy/deletion.test.ts`
- Integration: full `pnpm gate`; 30-iteration adversarial probe as in the
  `EventStore` header measurement, run on Linux.

## Gates and Handoff

- Human/policy gate: P0-adjacent — independent privacy review of the fix diff
  before merge (countersign welcome per status-matrix §P0 closure).
- Rollback or abort condition: if reproduction fails after a bounded effort
  (e.g., 3 CI attempts × 30 iterations with zero recurrence), record the
  evidence and close the task as "not reproducible at will; monitoring" with
  an owner decision instead of speculative changes.
- Required durable records: dated report under `docs/reports/`, status-matrix
  note if wording changes, CI run links.
- Next command after handoff: dispatch the reproduction job on ubuntu.

## Closeout

- Verified commit/date: `6ae179c` on `cursor/ps-hotfix-provider-fail-attribution` (2026-09-17) — test-only change, await writer before outcome assertions.
- Abort-condition decision (owner, 2026-09-17): the test observation was fixed (the failure was in the test sampling, not the product invariant); a Linux reproduction effort was bounded by the resolution report's evidence (1 hosted failure in 1 of 3 runs, rerun green; Windows 0/30 losses; product verification confirmed inside the run lock twice). Task closed as **monitoring-only** — no speculative production locking change warranted. Reopen condition: an independent Linux reproduction of a returned-success delete leaving records on disk.
- Evidence links: [resolution report](../../docs/reports/2026-09-17-delete-writer-race-flake-resolution.md); CI run 35197315145 (failure log line ~12564, rerun success); review package 2026-09-16-rr-fix-review-package.md §5.
- Commands: `pnpm test -- test/unit/privacy/deletion.test.ts` 51 pass / 0 fail (2026-09-17); `pnpm workflow:check` pass; `git diff --check` pass.

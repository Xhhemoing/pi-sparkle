# PS-02: project learning-key isolation regression and minimal fix

Task: `TASK-20261001-ps02-project-key-isolation`. Date: 2026-10-01.
Owner: implementation agent; independent review remains a separate open gate.
State: planned, before runtime edits.
Baseline: main `46e1af0` plus PS-01 doc commit `1cac3a9` on `docs/status-reconciliation-20261001`.

## Problem and Scope

### Problem

`stableProjectKey()` in `src/learning/learned-routing.ts` normalizes with `.toLowerCase()` over the whole path after backslash→slash and trailing-separator trimming. On a case-sensitive filesystem, two distinct real directories whose paths differ only by case (`/tmp/x/projectA` vs `/tmp/x/projecta`) collapse to the same key, hence the same:

- routing-policy `ResourceIdentity` (`routingPolicyIdentity` → `prj_p<hash32>`), so the adaptation registry would bind one active policy across two different projects;
- persisted learning paths (`learning/projects/<key>/routing.json`, `bandit.json`, `observation-ledger.json`), so one project's learned state is readable and writable as the other's.

This silently shares learned state and policy identity across distinct projects, violating the plan's "不同项目不共享策略身份" acceptance item.

### In scope

- RED regression first (separate commit), then the minimal fix (second commit), then evidence records.
- Fix shape: stop lowercasing the whole path. Keep backslash→slash normalization and trailing-separator trimming (both are existing cross-platform contracts); lowercase only a leading Windows drive-letter prefix (`[a-zA-Z]:`) or UNC host component, where Windows paths are case-ambiguous by OS design; preserve the case of everything else.
- Characterization tests pinning backslash and trailing-separator equivalence so the fix does not regress them.
- POSIX-only on-disk isolation test with two real case-differing directories (skipped on win32 with the documented reason that NTFS/Win32 cannot host case-differing sibling directories).
- E2E isolation: `updateProjectBandit(rootA)` bytes must not be readable under `loadProjectBanditByKey(stateRoot, stableProjectKey(rootB))`.
- Old-key handling decision: **no migration, no remap.** Legacy lowercased-key directories stay on disk as orphaned learned data; doctor's existing `learnedState` inventory already surfaces `learning/projects/*` keys, so ambiguity is reported, never silently rewritten. ADR-008 boundary respected: no new cryptographic identity, no global state rewrite.

### Out of scope

- No change to `parseProjectId`/id rules, hash32, privacy record-class docs, doctor logic, bandit fail-closed behavior, or any persisted DTO.
- No attempt to disambiguate already-collided legacy keys (that is a data-repair action requiring owner authorization; out of scope by design).
- Symlink-case and Unicode-normalization-case interaction: `discoverProject` canonicalizes roots via realpath before any event carries `project.rootPath`, so all live inputs are already canonical realpath output; this slice does not add a second canonicalization layer. A bounded note is recorded in the evidence report instead.
- PS-03 lifecycle work (owner-dependent) and all other roadmap packages.

## Acceptance Criteria

- [ ] Two case-differing real directories on one shared state-root produce distinct `stableProjectKey` values, distinct bandit paths, and no cross-readable bandit state (RED first, GREEN after fix).
- [ ] `C:\a\b` vs `c:\a\b\` and `//Server/Share/x` vs `//SERVER/SHARE/x` host-prefix folding stay equivalent under the new key (characterization).
- [ ] Case-differing sibling directories yield isolated learned state on a case-sensitive filesystem (POSIX-only, win32 skip documented).
- [ ] No existing test weakens; full learning/routing/doctor suites pass; `pnpm gate` green before delivery.
- [ ] Evidence report records exact commits, commands, counts, skips, and the no-migration decision.

## Implementation Slice

| File/symbol | Change | Owner | Dependency/risk |
|---|---|---|---|
| `test/unit/learning/project-key-case.test.ts` (new) | RED: case-distinct keys; characterization: drive-letter/UNC host folding, backslash & trailing-sep equivalence; POSIX-only on-disk isolation + bandit E2E | implementation agent | none; pure-red on current code |
| `src/learning/learned-routing.ts` `stableProjectKey` | Remove whole-string `.toLowerCase()`; lowercase only leading drive-letter/UNC-host prefix | implementation agent | callers unchanged (bandit-store, from-episode, observation-ledger, auto-loop, doctor, privacy docs) |
| `docs/reports/2026-10-01-project-key-isolation.md` (new) | Evidence: RED/GREEN commands, counts, skip reason, old-key no-migration decision | implementation agent | after GREEN |
| `docs/status-matrix.md`, `tasks/report-execution-todo.md` | Closeout rows/links per evidence | implementation agent | after GREEN |

## Test-First Plan

- Red test: `test/unit/learning/project-key-case.test.ts` — case-distinctness of `stableProjectKey` fails on current code (both derive `p<same>`), while backslash/trailing-sep cases pass pre-fix as characterization.
- Focused command: `node --test test/unit/learning/project-key-case.test.ts` (RED expected on the case-distinct group only, before the fix).
- Integration/acceptance command: full `pnpm test` learning + routing + cli doctor suites; then `pnpm gate`.
- Negative and recovery cases: ambiguous legacy keys are never rewritten; doctor inventory keeps reporting orphaned legacy directories; bandit stays fail-closed (`BANDIT_STATE_UNREADABLE_CODE`).

## Gates and Handoff

- Human/policy gate: none closed; independent review of the fix remains open; no owner gate is touched.
- Rollback or abort condition: source drift on `src/learning/learned-routing.ts` callers, an unexpected regression outside the changed normalization, or a frozen-schema conflict — stop and reconcile.
- Required durable records: this plan, the RED commit, the GREEN commit, and the dated evidence report with exact counts and the documented win32 skip.
- Next command after handoff: `pnpm gate` on the combined head, then evidence-record commit; PS-03 stays with its owner.

## Closeout

- Verified commit/date: pending.
- Commands and outcomes: pending.
- Open risks/follow-ups: legacy lowercase-key directories remain on disk (doctor-visible, not migrated); registry identities for previously-keyed projects change, so a fresh promotion baseline is expected by design, never silent reuse; symlink-case interaction is noted, not layer-bypassed.
- Evidence links: filled at closeout.

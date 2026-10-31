# Project learning-key isolation — evidence record (PS-02)

Task: `TASK-20261001-ps02-project-key-isolation`. Date: 2026-10-01.
Owner: implementation agent. Independent review: **not run — remains open.**
Plan: [2026-10-01-ps02-project-key-isolation](../superpowers/plans/2026-10-01-ps02-project-key-isolation.md).
Baseline: main `46e1af0`; PS-01 doc commit `1cac3a9` precedes this slice on the same branch.

## Defect and reproduction

`stableProjectKey()` lowercased the whole normalized path, so two distinct real directories whose paths differ only by case collapsed onto one project key: one `learning/projects/<key>/` directory (routing.json / bandit.json / observation-ledger.json), one routing-policy `ResourceIdentity` (`prj_p<hash32>`), and cross-project readable learned state.

RED commit: `eff6c00` (`test/unit/learning/project-key-case.test.ts`, behavior-unchanged source).

Command (exact):

```
node scripts/run-tests.mjs test/unit/learning/project-key-case.test.ts
```

RED result at `eff6c00` (Node v24.18.0, Windows, win32): **8 tests — 3 pass / 4 fail / 1 skip.** The four failures are the defect reproduction:

1. case-differing POSIX paths derived identical keys;
2. case below the Windows volume prefix derived identical keys;
3. case-differing roots shared a routing-policy identity;
4. project B read project A's bandit state through the case-collapsed key (`loadProjectBanditByKey` returned A's state for B's key).

The three passing characterization cases (backslash/trailing-separator equivalence, drive-letter folding, UNC host+share folding) pin the contracts the fix must not regress. One case is win32-skipped (see coverage below).

## Fix (GREEN)

Commit: `004d59d` — `fix(learning): fold only the case-ambiguous volume prefix in stableProjectKey`.

`src/learning/learned-routing.ts` now lowercases only the case-ambiguous volume prefix — a drive letter (`C:`) or the `//host/share` UNC prefix — and preserves the case of everything after it. Backslash→slash and trailing-separator trimming are unchanged. Callers are unchanged: `bandit-store.ts`, `from-episode.ts`, `observation-ledger.ts`, `auto-loop.ts`, `doctor.ts` inventory, and the `privacy/record-classes.ts` doc paths all derive from the same function.

One test-authored defect was caught by the new tests before delivery: the first fix revision contained an over-escaped drive regex (`\[a-zA-Z]`), which the drive-letter characterization test failed; corrected in the same commit.

GREEN results (author-run):

- Focused: `node scripts/run-tests.mjs test/unit/learning/project-key-case.test.ts` → **7 pass / 0 fail / 1 skip**.
- Adjacent suites: `node scripts/run-tests.mjs test/unit/learning test/unit/routing test/unit/cli/doctor.test.ts test/unit/privacy test/unit/adaptation test/unit/run/flowchart-learned-routing.test.ts` → **655 tests — 651 pass / 0 fail / 4 skip**.
- `pnpm typecheck` PASS; `pnpm lint` PASS; `git diff --check` clean.
- Full gate on the fix head: `pnpm gate` → workflow-check ok, typecheck PASS, lint PASS, **3234 tests — 3215 pass / 0 fail / 19 skip**, build PASS. (Pre-change baseline was 3226 tests / 18 skip; the delta is +8 tests and +1 skip from this slice.)

## Coverage notes and documented skip

- The on-disk sibling-isolation test (two real case-differing directories under one state root) is `{ skip: process.platform === "win32" }`. Reason: NTFS/Win32 cannot host two sibling directories differing only by case, so the premise is unconstructable on this platform. The key-level, identity-level, and bandit-path contracts run on every platform; CI's ubuntu leg exercises the on-disk case.
- Live callers receive canonical roots: `discoverProject` realpaths the project root before events carry `project.rootPath`, and the run/auto-loop entry points pass that value through. This slice adds no second canonicalization layer; interaction between case and symlink resolution is noted as a known boundary, not silently layered over.

## Old-key handling decision (no migration)

- Legacy lowercase-key directories are **not** migrated, remapped, or deleted. They remain on disk as orphaned learned data and stay visible through doctor's `learnedState` inventory, which already enumerates `learning/projects/*`.
- Because `routingPolicyIdentity` now derives from case-preserving keys, a previously-keyed project gets a fresh registry identity and therefore a fresh promotion baseline. This is by design: no old policy is silently reused across the identity change, and CAS promotion/approval still gates any new active version.
- No new cryptographic identity and no global state rewrite are introduced (ADR-008 boundary respected).

## Gates not claimed

Author-run automated verification only. Independent review of the fix, and all owner/experiment/production/Outcome-supported gates, remain open and are not asserted by this record.

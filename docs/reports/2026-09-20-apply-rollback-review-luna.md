# PR #45 independent review — luna-fast, 2026-09-20

## Identity

- Subject: PR #45 `fix(native): roll back source on failed fast-forward during apply`, branch `fix/apply-head-drift-rollback`, base main `5dccb324`.
- Reviewer: luna-fast (owner-designated channel); dispatch `mu9invia-d951b389` and `mu9ixges-60907c0f` failed before start (503 transport, gateway instability); minimal probe `mu9j32ou-f3a8800e` confirmed channel alive between attempts; review dispatch `mu9j51je-5d069640` completed. Author: main agent session.

## The induced-failure test and the gap it exposed

Follow-up from [2026-09-19-native-apply.md](2026-09-19-native-apply.md): "the HEAD-drift rollback path is implemented and code-reviewed but not exercised by an induced-failure test."

Injection (probed, not assumed): `post-merge` never fires on fast-forward merges; a `reference-transaction` hook in the `committed` phase does. The test's hook fires **exactly once** (marker-gated), committing a third-party drift between the apply's `merge --ff-only` and its HEAD verification. Marker lives outside the repo so an empty rollback cannot satisfy it. Hook path must be a plain `C:/` absolute form — probed: the `\\?\` namespaced form is silently not resolved by git hook lookup.

Gap found (RED): when the drift makes the merge itself fail after the ref update had already landed, the old code refused **without restoring the source** — HEAD left at the drift commit, violating the docstring contract "on mid-apply failure the source is rolled back to its prior revision."

## Fix

`!applied.ok` branch in `src/native/apply.ts` now: `reset --hard <previous>` (no-op when nothing was touched) → verify HEAD equals `previous` → refuse with merge+rollback details if either step fails. Success path unchanged.

## Review verdict — PASS

Evidence (`mu9invia`→`mu9j51je` chain, verdict at `.agent_workspace/luna-45-review/verdict.md`):

| Check | Result |
|---|---|
| Scope | Only `src/native/apply.ts` + `test/integration/native/apply.test.ts` |
| Logic | Correct rollback target (`previous`, not candidate); detailed error; success path unchanged |
| Test quality | Once-gated external marker; assertions: hook fired / HEAD at exact prior revision / no candidate content / candidate retained; hook unset in `finally` before cleanup |
| Focused (6 integration + 5 unit apply tests) | 11 pass / 0 fail |
| typecheck | exit 0 |

Author-run verification additionally recorded: focused native set (7 files) **34 pass / 0 fail / 0 skip**; eslint clean; `git diff --check` clean; RED→GREEN sequence preserved in session log.

## Status for PR #45

- Independent review: **PASS** on head `fix/apply-head-drift-rollback`.
- Remaining owner actions: confirm hosted CI green on the PR head, then merge authorization per standing rule.
- After merge: the 2026-09-19 apply report's open follow-up "induced mid-apply HEAD-drift test is a candidate follow-up" is closed; the remaining registration gates (host-facing registration decision, disposal policy, human authorization) are unchanged.

## Environment

- Windows / Git Bash; Node v24.18.0; pnpm 10.17.1. Review artifacts: `.agent_workspace/luna-45-review/`.

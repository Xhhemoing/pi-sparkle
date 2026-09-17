# RR fix review package — PR #42 final head `aeb4993`

## Identity

- Base: `fe253301` (remote main, unchanged).
- **PR #42 head (delivery candidate): `aeb49930f688ea3f1c3cde01beda3740f4399308`** = full local candidate `412230a` + RR fix commit `aeb4993`. `5357163` (previous PR head, R3/R1 only) is a verified ancestor — alignment was a fast-forward, no history rewrite. PR remains OPEN, not merged.
- Separate line (not part of PR #42): provider-fail attribution hotfix branch `cursor/ps-hotfix-provider-fail-attribution` @ `5256339` (on `8dd31e9`; governance `052fd5a` + hotfix `5256339`).
- Author of the RR fixes: coding assistant session 2026-09-16 (**not an independent reviewer**). All runs below are author self-verification.

## What changed (RR → file/test map)

| RR | Product fix | Regression test |
|---|---|---|
| RR1 rename source identity | `src/execution/worktree-snapshot.ts` — `parsePorcelainZ` keeps rename/copy source; rename source = `deleted`, copy source = `modified`; scope filter applies to both | `test/unit/execution/worktree-snapshot.test.ts` "rename source identity changes the fingerprint…" |
| RR2 durable run identity | `src/execution/loop-artifact.ts` `assertRunPresent` via `EventStore.readAll()`: rejects empty/corrupt/mid-corrupt/identity-mismatch/no-RUN_CREATED; torn tail tolerated; lock-free read under the run lock | `test/integration/execution/closed-loop.test.ts` "empty or corrupt event logs…" + "run lock is respected…"; fixtures in 4 files replaced with real `RUN_CREATED` init |
| RR4 timeout policy | `src/execution/command-policy.ts` — finite positive safe integer 1..2147483647; `undefined` → 60000 | `test/unit/execution/command-policy.test.ts` |

## Author self-verification (2026-09-16, Windows / Node v24.18.0 / pnpm 10.17.1, cwd `pi-sparkle-merge-r3r4`)

| Command | Result |
|---|---|
| RED checks (3 ported scenarios before fixes) | 3 fail for the intended reasons (49 pass / 3 fail observed mid-session) |
| `pnpm test -- test/unit/execution/ test/unit/pi-adapter/worktree-coding-tools.test.ts test/integration/execution/` | **61 pass / 0 fail / 0 skip** (baseline 57 + 4 new) |
| `pnpm gate` | exit 0 — **2771 pass / 0 fail / 18 skip** |
| `pnpm security:probe` | no open findings |
| `pnpm pi:probe` | PASS (pin 0.85.1) |

## Independent review protocol (run before any merge)

1. Fresh checkout of `aeb4993` (do **not** reuse this session's trees).
2. Original five regressions: `.agent_workspace/grok-rereview/review-regressions.test.ts` imports `./tree/` — point a fresh `tree/` checkout at `aeb4993` (or re-clone into that layout); expect 5 pass / 0 fail.
3. The three new scenarios are now product tests (names above); additionally `pnpm test -- test/unit/execution/ test/unit/pi-adapter/worktree-coding-tools.test.ts test/integration/execution/` → expect 61/61.
4. `pnpm gate` → expect exit 0, 2771 pass / 0 fail / 18 skip; then `pnpm security:probe` and `pnpm pi:probe` (dist exists after gate build).
5. Hosted CI on the exact head: run 35197315145 — first run: cli-smoke windows+ubuntu SUCCESS; **quality FAILED at Test** (`test/unit/privacy/deletion.test.ts:1365` "a live run's own writers cannot make a delete report a removal it lost", assertion "a returned delete must leave nothing on disk" `true !== false`). Root-cause verified **pre-existing platform flake, not a regression**: `git diff --stat 5357163..aeb4993` shows zero changes under `test/unit/privacy/`, `src/privacy/`, `src/run/event-store.ts`, `src/persist/`; the test is the documented adversarial tight-loop-appender vs `deleteRunRecords` race (see `src/run/event-store.ts` header) and lost one Linux-timing race. Failed-job rerun → **run completed success** (both jobs green on the same head).
   **Follow-up (owner):** an intermittent Linux race loss in the delete/removal privacy invariant deserves its own task (reproduce on ubuntu, harden or document the scheduling window) — not silently absorbed by reruns.
6. Acceptance = independent reviewer PASS on `aeb4993` + owner authorization; only then merge PR #42.

## Explicitly not closed

- PR #42 not merged; merge is an owner action after review PASS.
- Provider-fail hotfix (`5256339`) is a separate line: not in PR #42, needs its own review/PR decision.
- F6 remains NOT READY; no provider/holdout/seal runs were performed.
- Worktree cleanup deferred until after review; `.agent_workspace/` evidence preserved.

# Whole-repo review and next steps — 2026-09-16

## Scope / identity

- Read-only review of governing records, active task state, status matrix, delivery reports, worktree layout, and the uncommitted local diff. One focused test run (see below). No product code changed by this review; no push/merge/dispatch.
- Reviewer: coding assistant (non-human); environment Windows / Node v24.18.0 / pnpm 10.17.1.
- Base commit: `8dd31e9` (branch `cursor/ps-hotfix-provider-fail-attribution`, dirty).

## Repo state facts

- 234 src files / 317 test files; gate last independently recorded 2026-09-14 on candidate `412230a`: 2767 pass / 0 fail / 18 skip; security probe 26 PASS; pi probe 4 PASS (2026-09-14-grok-repair-rereview.md).
- Two open delivery tracks: Grok trusted-execution residuals (RR1/RR2/RR4, PR #42 head misalignment) and SoL-Pi post-merge evidence gaps (PR #36 reviewer/authorization artifacts).
- 9 git worktrees + 3 temp detached worktrees exist; several duplicate verified candidates (`412230a` twice, `fe25330`, `5357163`, etc.).
- Untracked governance set: `AGENTS.md`, `docs/development-workflow.md`, `docs/templates/`, `tasks/README.md`, `scripts/workflow-check.mjs`, its test, and rollout reports — not yet committed.

## Uncommitted local diff review (hotfix: provider-fail attribution)

Intent: provider/runtime failures must not enter taskSuccess as model FAIL (bandit poisoning). Changes: `pi-executor.ts` emits `UNOBSERVED` verification + structured `failure` instead of synthesizing `FAILED`; `failure-class.ts` treats FAILED with empty `evidenceIds` as `environment`; `signals.ts` forwards `evidenceIds`; PR template/CI wire `workflow:check` into the gate.

- Focused check run this session: `pnpm test -- test/unit/routing/failure-class.test.ts test/unit/learning/task-success.test.ts` → **26 pass / 0 fail / 0 skip**.
- **Finding (P1, must fix before commit): `src/learning/from-episode.ts` (~line 216) still calls `classifyTaskFailure` WITHOUT `evidenceIds`.** An episode-replayed TASK_RESULT with `verification.kind: FAILED, evidenceIds: []` therefore still classifies as `model` and can enter the posterior — the exact poisoning this hotfix stops on the live path. The `signals.ts` prose path (line ~110) deliberately omits evidenceIds and is correct as documented.
- Minor: CRLF warnings on `tasks/plan.md` and the two touched test files (pre-existing, recorded in the 2026-09-14 re-review).

## Next steps (ordered)

1. **Commit the governance/process set** (docs + `workflow:check` + PR template + CI step): docs/process-only; gate `pnpm workflow:check`.
2. **Complete the hotfix (test-first):** RED test in `test/unit/learning/from-episode.test.ts` reproducing empty-evidence FAILED via episode replay asserting no model-attributed FAIL; then pass `evidenceIds: message.evidenceIds` (or the verification's) at `from-episode.ts:216`; GREEN + `pnpm gate`.
3. **Grok residuals per 2026-09-14 re-review:** RR1 (rename source identity in `worktree-snapshot.ts`), RR2 (durable run identity in `loop-artifact.ts` / `closed-loop.ts` + replace empty-log fixtures), RR4 (`command-policy.ts` positive-timeout validation); delete/write interleaving tests. Do not repeat fixed items.
4. **SCM alignment:** make PR #42 head equal the verified full candidate (currently `5357163` carries only R3/R1); obtain SoL-Pi per-stage reviewer PASS + owner authorization artifacts for PR #36.
5. **Worktree hygiene:** after records are preserved, prune the temp/duplicate worktrees (`.agent_workspace` candidates excepted while review evidence lives there).
6. **Still gated, do not start:** F6 seal/holdout, live R1/bandit/topology wiring, Pi extension import (ADR-006 Proposed), Outcome-supported claims (Checkpoint G).

## Dispatch attempt — 2026-09-16

Subagent dispatch of both fixes (from-episode hotfix in main worktree; RR1/RR2/RR4 in merge-r3r4) to a new `luna-fast` agent (model `xhh/gpt-5.6-luna-fast`) first failed with relay outage: `https://k.xhh.cloudns.be/v1` returned HTTP 502 (gateway down), then recovered (HTTP 200) but stayed unstable for sustained multi-turn sessions — of 5 dispatches, one small task completed, one timed out mid-work leaving RED tests, two timed out with zero progress, one connection error. Root cause pattern: single direct API probes succeed (even 150KB input / streamed 77KB output) while long agentic sessions die; settings `retry.provider.maxRetries: 0` turns any blip into a failed run. Fallback per plan option C: fixes completed in-session (from-episode hotfix + gate in main worktree; RR1/RR2/RR4 finished from the subagent's RED tests). Agent file `C:/Users/86080/.pi/agent/agents/luna-fast.md` stays for reuse.

## Fix verification — 2026-09-16

### Main worktree (`8dd31e9` dirty, provider-fail attribution hotfix)

- `src/learning/from-episode.ts`: episode-replay `classifyTaskFailure` now passes `message.verification.evidenceIds` (same source as `signals.ts:364`).
- First subagent test scenario was ineffective (the `429` detail hit the `ENVIRONMENT_HINT` prose path before the evidenceIds branch — RED check with the fix stashed still passed, honestly reported by the agent). Test corrected to a hint-free failure (`"executor crashed before reporting"`); controlled RED re-verified: stash fix → test fails (`failureClass` was `model`), restore fix → 7/7.
- `test/unit/tracking/option-a-preconditions.test.ts` census pin updated for the contract change: pi-executor terminal fallback is now a literal `UNOBSERVED` (never synthesizes FAILED); wire/protocol contract unchanged, rationale commented in the pin.
- `eslint.config.js`: added `.agent_workspace/**` to ignores — the 37 pre-existing lint errors came only from review-scratch files there (AGENTS.md rule 5 runtime-state dir); product code had 0 errors.
- `pnpm gate` (main worktree): **PASS — 2616 pass / 0 fail / 18 skip**, workflow-check ok, typecheck ok, lint ok, build ok.

### `pi-sparkle-merge-r3r4` (`412230a` dirty, RR1/RR2/RR4)

- **RR1** `src/execution/worktree-snapshot.ts`: `parsePorcelainZ` now preserves the rename/copy source path; rename source recorded as `deleted`, copy source as `modified` (actual content, never a deletion); both honor include/exclude scope. Rename-source swap now changes the fingerprint → `ok=false`.
- **RR2** `src/execution/loop-artifact.ts`: `assertRunPresent` validates durable identity via `EventStore.readAll()` — rejects missing dir (original message kept), empty log, corrupt/mid-corrupt lines, identity mismatch, missing `RUN_CREATED`; torn tail stays tolerated by the existing recovery policy. Runs under the run lock, takes no lock itself (no nested same-lock acquisition).
- **RR4** `src/execution/command-policy.ts`: `timeoutMs` validated as finite positive safe integer within `1..2147483647` before spawn; `undefined` keeps `60000`; 0/negative/NaN/Infinity/out-of-range rejected with `DomainValidationError`.
- Fixtures: all empty-log seeds replaced with real `RUN_CREATED` initialization (`closed-loop.test.ts`, `pi-closed-loop.test.ts`, `loop-artifact-lifecycle.test.ts`, `loop-artifact.test.ts`); new controlled interleave test proves lock respected + no nested acquisition (check completes after release; a nested acquisition would LOCK_TIMEOUT).
- Focused: `pnpm test -- test/unit/execution/ test/unit/pi-adapter/worktree-coding-tools.test.ts test/integration/execution/` → **61 pass / 0 fail / 0 skip** (baseline 57 + 4 new). RED evidence: the three boundary tests failed for the intended reasons before each fix (49/3 observed mid-session).
- `pnpm gate` (merge-r3r4): **exit 0 — 2771 pass / 0 fail / 18 skip**. `pnpm security:probe`: no open findings. `pnpm pi:probe`: PASS (pin 0.85.1, legacy identifiers absent).

### Still open (unchanged)

- These fixes are implementation + self-verification on the local candidate; the re-review's required final same-head independent review (old 5 + new 3 regressions, focused, gate, post-build probes) has not run. PR #42 head remains `5357163` (only R3/R1); SCM alignment is a separate human/SCM step. All changes left uncommitted for owner review. F6 NOT READY; no provider/holdout/seal runs.

### Delivery record — 2026-09-16 (owner approved 1A→2A→3A→4A)

- Commits: main worktree `052fd5a` (process/governance + gate wiring) and `5256339` (provider-fail hotfix) on `cursor/ps-hotfix-provider-fail-attribution`; merge-r3r4 `aeb4993` (RR1/RR2/RR4) on `local/merge-r3r4` atop `412230a`.
- Pushed: `cursor/ps-hotfix-provider-fail-attribution` → origin (new branch); `aeb4993` → origin `grok/trusted-execution-review-fixes` (**fast-forward** — `5357163` verified ancestor; PR #42 head now `aeb4993`, state open, not merged). Hosted CI on the head: cli-smoke windows+ubuntu SUCCESS, quality in_progress at packaging (run 35197315145).
- Independent review package: [2026-09-16-rr-fix-review-package.md](2026-09-16-rr-fix-review-package.md) — exact SHAs, RR→test map, reviewer protocol, acceptance conditions.
- Worktree cleanup: `pi-sparkle-main-clean` pruned (commit verified contained in origin/main history); the three dirty temp worktrees (`dbg-wt-r03XWB`, `mainwt`, `pi-sparkle-t15-t16-verify`) left untouched — each has uncommitted deletions of scratch files; owner decides. `.agent_workspace/` evidence preserved; branch-carrying worktrees kept until review PASS.
- CI note: first hosted run on `aeb4993` failed `quality` on a pre-existing delete-vs-writer race flake (`deletion.test.ts:1365`, delta-untouched files verified); failed-job rerun → run success. Follow-up task proposed to owner (see review package §5).

## Verification record

| Command | Result |
|---|---|
| `pnpm test -- test/unit/routing/failure-class.test.ts test/unit/learning/task-success.test.ts` | PASS — 26/26 |
| `pnpm workflow:check` (this docs change) | recorded below at delivery |

# Development continuation: bounded batch and historical review

Plan: [B3 implementation](../superpowers/plans/2026-10-15-development-batch-review.md). Checklist: [B3 tasks](../../tasks/development-batch-review-todo.md). Baseline: PR #60 `726e5e5519aabf74fcb6699c64b268d401a2cefd`.

## Delivered behavior

`runDevelopmentBatch` and `develop batch` produce at most eight requested items serially, all against one fixed source revision. Each item retains its own native repair loop, claim, action and candidate. Total time is shared; per-item limits shrink to remaining time. Only ready-for-review continues. First failure, visible running/uncertain effect or claim, source drift, cancellation, no selectable work or exhausted limits stops. Successful candidates are not automatically accepted or applied. A later invocation can choose remaining independent tasks, without replaying prior ready candidates. Existing scope/dependency rules remain unchanged.

Operation signals now reach queue evidence verification, selection, claim and readiness publication. Pre-commit cancellation cannot publish a claim; committed tokens/records are returned for fenced handling. Controller loads after claim are inside its recovery boundary, and prepare/claim/checkpoint awaits have cancellation fences before worker dispatch. Real completed receipts survive cancellation for explicit reconciliation. New signal-aware verification waits for actual resolver settlement; old calls without external signals preserve their previous timeout behavior. No Promise.race abandons a claim or worker. Deadline and queue admission are cooperative observed-state controls, not an OS sandbox, hard real-time guarantee, global worker lock or dollar budget.

Controller receipts now preserve final and optional loop artifact refs even for failed outcomes. `reviewDevelopmentCandidate` / `develop review --action` verifies their task, claim, source, candidate, run and host-definition bindings; reads bounded artifacts/event logs; and emits concise historical per-attempt observations. It does not execute a checker/model, write queue/action records, expose raw source/full argv/stdout/stderr, or grant fresh acceptance. Missing legacy refs are unavailable; explicit missing/corrupt/stale/contradictory refs refuse. Queue/action versions are rechecked around the read. Current candidate mutation does not rewrite prior history.

The optional artifact reader bounds retain default reader behavior and existing run/event identity validation. Artifact allocation is fixed by a stable descriptor; event bytes/records use the existing bounded reader. Fixed review limits: 512 KiB/artifact, 2 MiB and 10000 records/run, five attempts/eight criteria. File, parent, link and metadata checks detect cooperative drift; they do not claim protection against arbitrary hostile transient path swaps or cryptographic integrity.

## Test-first and independent review

| Slice | Evidence and outcome |
|---|---|
| Store cancellation | new RED before source; original/no-signal timeout retained; external-signal tail settlement and committed publication tested. Review found inherited signal loss; ordinary-object check plus RED regressions fixed it. Final author/independent focused PASS. [Record](2026-10-15-work-item-cancellation.md) |
| Controller cancellation/refs | real RED then new+existing 26/26; independent 26/26 PASS. [Record](2026-10-15-controller-cancellation.md) |
| Batch/CLI/store cross-interface | root batch missing-module RED then GREEN; reviewer late unknown effect RED corrected before final limit reporting. Final independent combined 61/61 PASS. [Independent record](2026-10-15-development-batch-independent-review.md) |
| Historical review | initial RED, real two-attempt contract/descriptor/shadow-ref regressions; reviewer contradictory outer outcome RED fixed, preserving valid late cancellation/time-budget history. Final author/independent 23/23, CLI review 3/3 and original probe 1/1 PASS. [Record](2026-10-15-development-candidate-review.md) |
| Optional bounded artifact reader | child author and root independent 42/42, no skips. Root read reviewed source diff: default path retained, limits snapshot before await, fd-size allocation, no-link/identity drift, bounded event reader and run identity retained. FIFO regression is subprocess time-bounded. [Record](2026-10-15-loop-artifact-bounds.md) |

No author test count is summed as if it were a unique aggregate count. These are offline mechanism checks; no real provider effectiveness is inferred.

## Final local aggregate

`node scripts/run-tests.mjs`: **3519 total / 3518 pass / 0 fail / 1 skip**, 65.073 seconds. The skip remains the existing opt-in real provider smoke. TypeScript, whole-repository ESLint, workflow, build and diff checks pass using original package commands directly. Security 26 PASS/0 findings; Pi compatibility 4 PASS; kernel reuse 3 PASS. Full log: `.agent_workspace/stage3/full-tests.log`.

Source was restored from its saved GitHub commit after workspace cleanup between sessions. Offline/direct dependency attempts could not restore every package. Managed `pnpm install --frozen-lockfile --ignore-scripts` validated the existing supply-chain policy and restored all 195 locked packages from cache (zero downloads). Package/lock/workspace-policy files have no diff. The local wrapper is still pnpm11.25.0 versus the project's10.17.1, so no literal local pnpm gate PASS is claimed. Hosted Node22/pinned-pnpm evidence remains separate.

Read-only `node dist/cli/main.js models list --json` again returns primary=null, fast=null, models=[]. LIVE-01 remains blocked, with no model/credential configuration change and no live calls. The scripted [batch demo](2026-10-15-development-batch-demo.md) and [guide](../development-agent-loop.md) describe concrete review and continuation commands.

## Saved stages and hosted gate

Implementation/source checkpoint is saved as remote `fccfa2470df9de100d0a210428c5531a393eff1a` / local `4366acc6409610686f54d86efbaa17e7ac4d16f2`, with exact shared tree `165325780f65ab2500b31e12bb848d2ecac47e8e`. The remote tree was compared with the tested local tree before the branch was advanced under an expected-head lease. All **five hosted source-checkpoint jobs PASS** on Node22.19.x and pinned pnpm10.17.1:

- [CI38664804090](https://github.com/Xhhemoing/pi-sparkle/actions/runs/38664804090): quality, Ubuntu CLI smoke, Windows CLI smoke.
- [Root38664803991](https://github.com/Xhhemoing/pi-sparkle/actions/runs/38664803991): Ubuntu and Windows root regression.

Hosted quality full suite: **3519 total / 3518 pass / 0 fail / 1 skip**, 155.514 seconds. All workflow/type/lint/build/security/Pi/kernel steps PASS. Both smoke jobs explicitly pass the new development batch/review/cancellation and bounded-reader selection. Final closeout updates only guide, task and evidence documents; it does not change the reviewed runtime, tests, example or CI configuration. The matrix now runs new batch/review/controller/store-cancellation and bounded-reader cases explicitly on Ubuntu and Windows, in addition to old CLI and reliability tests. Existing production, R10/R11, adaptive, holdout, merge and release decisions remain separate.

Continuation after this bounded slice: preserve completed candidates, inspect each action with `develop review`, explicitly accept only after current verification and independent review, then integrate through the host Git/PR workflow. A subsequent batch can work on remaining independent tasks; dependencies still require integrated-source verification. LIVE-01 is a separately recorded model/budget prerequisite rather than a reason to replay or waive queue states.

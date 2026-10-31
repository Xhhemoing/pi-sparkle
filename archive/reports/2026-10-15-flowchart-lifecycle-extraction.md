# Flowchart durable-recovery validation extraction

- Task: `TASK-20261015-flowchart-lifecycle-extraction`, bounded DP06 continuation; [plan](../superpowers/plans/2026-10-15-flowchart-lifecycle-extraction.md).
- Date: 2026-10-15 Asia/Shanghai; Linux, Node v24.19.0.
- Working branch: `codex/architecture-agent-loop-20261015`; current shared-worktree base `c2b802c385dda97c5becd0a9ecde666782806ae5`. Root owns final commit binding and combined gate.
- Implementation: command-cleanup agent. Independent review: exact-snapshot agent, no source edits during review.

## Change and compatibility

`src/run/flowchart-lifecycle.ts` now owns two pure durable-recovery prerequisites: `requireFlowchartReplay` requires a nonempty replay with the recorded run and project; `requireFlowchartCheckpoint` validates the existing checkpoint schema and requires its flowchart snapshot. Resume and control restoration share both helpers. Unblock shares only checkpoint validation, retaining its distinct log/project/active-block checks before the checkpoint read.

The helpers preserve exact `DomainValidationError` messages, validation ordering, original return objects and checkpoint-read timing. They add no event writes, state transitions, runtime schemas, public package exports, terminal handling, cancellation logic, routing, or file access. Existing flowchart contracts, per-task criteria and cost-ceiling restoration stay in the same call sites. `flowchart-run.ts` loses 44 net lines through removing repeated validation. Existing crash-terminal and teardown seams remain unchanged.

## Before and after evidence

This is a behavior-preserving extraction. Thirteen public-path characterization tests were written and passed against the original source before moving any runtime code. A deliberately failing feature test would not describe the intended unchanged behavior. The characterization tests assert exact errors through resume, pause and unblock, and verify refused recovery appends no run events.

| Command | Outcome |
|---|---|
| `node --import tsx --test --test-concurrency=1 test/unit/run/flowchart-lifecycle.test.ts test/unit/run/flowchart-run-abort.test.ts test/unit/run/flowchart-checkpoint.test.ts test/integration/m2.5/flowchart-run.test.ts` before runtime extraction | PASS: 50 tests, 0 fail, 0 skip; 3.39 s. |
| Exact same command after runtime extraction | PASS: 50 tests, 0 fail, 0 skip; 3.20 s. |
| `node --import tsx --test --test-concurrency=1 test/unit/routing/live-isolation.test.ts test/integration/run/unblock-flow.test.ts test/integration/m2.5/resume.test.ts` | PASS: 54 tests, 0 fail, 0 skip; 4.32 s. |
| `node_modules/.bin/tsc --noEmit` | PASS for the current shared worktree. |
| `node_modules/.bin/eslint src/run/flowchart-run.ts src/run/flowchart-lifecycle.ts test/unit/run/flowchart-lifecycle.test.ts` | PASS. |
| `node scripts/workflow-check.mjs` | PASS: 10 required files, 16 required headings. |
| `git diff --check` | PASS. |

Coverage includes malformed or missing logs/checkpoints, validation precedence, pause recovery, terminal failures and cancellation, incremental checkpoint replay, acceptance-window crash recovery, cost ceilings and recorded criteria, durable contract precedence, unblock/discard authorization, one-time recovery of appended unblock events, and the pinned live-routing import closure.

## Independent review

The reviewer compared the exact call-site diff and helper implementation and found no changed messages, check ordering, checkpoint-read timing, state/event side effects or runtime import coupling. They independently ran `node --import tsx --test --test-concurrency=1 test/unit/run/flowchart-lifecycle.test.ts`: 13 pass, 0 fail, 0 skip. Their scoped ESLint and whitespace checks passed. Review outcome: PASS for this bounded source slice; bind it to the final combined commit.

## Remaining scope

Root owns full integrated gate and delivery. This extraction addresses the shared durable-recovery validation portion of DP06 without a state-machine rewrite. It does not close live-provider, production-apply, R10/R11, platform-containment, or experimental gates. The independent native-acceptance review was coordinated in parallel and reported to root; it is separate from this source slice.

[Model: gpt-5.6-sol-xhigh-fast]

# Loop 4 · Round 8 — R8-5: Round 7 documentation truth-up

## Verdict

Landed in the shared working tree. The live documentation now records the
Round 7 reconstruction, criteria/gate semantics, parent-plane terminal
recorder, BLOCKED operator guidance, empty-graph preflight refusal, and the
keyed doctor reader. The tracking implementation plan now distinguishes its
dimension examples and display cap from the runtime's actual gate semantics.

Files changed:

- `docs/status-matrix.md`
- `docs/data-dictionary.md`
- `docs/specs/m0-m2-architecture.md`
- `docs/superpowers/plans/2026-08-18-phase-a-tracking-supervisor.md`
- `src/run/supervisor.ts` — one disclosed comment-only truth-up, as allowed
- `.agent_workspace/loop4-r8-t5.md`

No ADR was edited. In particular, ADR-006 remains Proposed everywhere.

## Truths recorded

1. A resumed flowchart node with a logged `TASK_REQUEST` runs under that logged
   spec: request fields restore objective/artifacts/criteria/budget, the
   role-bearing assignment `MODEL_ROUTED` restores role/model/cascade, and
   checkpointed edges restore dependencies. A never-requested node keeps empty
   criteria/artifacts and receives a caller-authorized fallback budget.
2. `FlowchartContinuation.contract` is honoured when supplied, but no
   production caller can fill the seam because the constraints are not durable
   on a record reachable from a run id. The docs do not invent a contract from
   episode acceptance criteria.
3. Acceptance criteria are prompt guidance plus a plan-time coverage
   obligation; the deterministic verifier is the sole child-assessment gate.
   `cappedByHardFail` affects `displayPrescore` only, while scoring and gate
   evaluation receive uncapped `P`.
4. `runParentRun` routes completion, ordinary failure, and crash exits through
   one `recordTerminal`; it consults `replayedTerminalStatus` and refuses a
   second terminal append.
5. The BLOCKED runbook surface is stated from the final working-tree census,
   not from the Round 7 dispatch: reason/evidence plus `inspect`, `inject`, and
   `unblock` `next:` lines. Resume alone replays BLOCKED; the locked unblock
   command records `RUN_UNBLOCKED` against the exact active block, reopens
   without executing, and resume then drives the work. Flowchart `resume` and
   `answer` print the same block. A BLOCKED result still exits 1.
6. `validateTaskGraph([])` refuses the M2 supervised DAG synchronously in
   preflight, before the lock, writes, or executor.
7. The R1 matrix row now names doctor's real read-only exception,
   `loadProjectBanditByKey`, not `loadProjectBandit`. R8-9's working-tree
   deletion of the unused root-keyed symbol is disclosed in the sync note.
8. R8-8's landed test-only declaration is reflected:
   `INSPECT_SUMMARY` is frozen additive with exactly
   `type` / `runId` / `status` / `requiredEvidence`, no `id`, and no membership
   in the domain `Event` union.

## Working-tree census

The census was taken from `git status` / `git diff`, not the dispatch list.

- **2026-08-24 21:41 UTC:** R8-9 had deleted root-keyed
  `loadProjectBandit` in flight. R8-1 and R8-8 had no working-tree edits yet.
- **2026-08-24 21:44 UTC:** R8-8's exact-shape freeze pins and report were
  present. R8-1 had added `RUN_UNBLOCKED` schema/replay foundations, but no
  command, BLOCKED-note rewrite, or event-fuzz seed yet. The docs therefore
  retained the current operator guidance while disclosing the in-flight
  foundation.
- **2026-08-24 21:50 UTC (final):** R8-1's source now included the matched
  unblock replay, checkpoint restore, flowchart reopen, locked CLI command,
  `resume`/`answer` BLOCKED reporting, event-fuzz seed, and rewritten operator
  note. Its assigned `replay.test.ts` and `blocked-next.test.ts` pin rewrites
  were still absent, so those old Round 7 expectations were transiently red.
  The docs record the new working-tree source and disclose the in-flight pins
  rather than retaining the pre-unblock wording.
- Other sibling edits observed in the shared tree: R8-2 resume absence pins,
  R8-3 flowchart/`applyRetry` absence pin, R8-6 catalog-route posture and
  bandit producer test, R8-7 parent crash/cancel decisions, and R8-10's
  successful-bind pre-rounds crash seed. R8-4's design pins/report and all
  sibling reports except R8-1's were present by the final census. Parent-owned
  `OWNERSHIP.md` and `PROGRESS.md` were also dirty and were not touched by this
  slot.

## Stale ADR body flagged, not edited

`docs/decisions/0005-checkpoint-f-holdout-open-questions.md:110` still names
`loadProjectBandit` in its Round 2 symbol-level guard. That is now stale: doctor
calls `loadProjectBanditByKey`, and R8-9 removes the old symbol in the working
tree. Per instruction, this report flags the ADR body and leaves it unchanged.

## Optional source-comment disclosure

The only `src/**` edit in this slot is comment-only at
`src/run/supervisor.ts` above `runAndSettleSupervisedRun`. It removes the stale
claim that an empty task list still seeds the pre-rounds crash window and states
the current boundary: `validateTaskGraph([])` now refuses before lock/write;
a failure after opening begins but before graph acceptance can still leave no
resumable graph. The file was not dirty when this comment edit began. R8-10
subsequently added only its owned integration test and did not touch this file.

## Verification

- `git diff --check -- docs src/run/supervisor.ts`: clean.
- `pnpm exec eslint src/run/supervisor.ts`: exit 0.
- Final stable truth/consumer batch: **50 pass / 0 fail / 0 skipped** across
  resume reconstruction/contract absence, criteria guidance/display cap,
  parent terminal refusal, empty graph, live isolation, and the
  `INSPECT_SUMMARY` freeze.
- First whole-tree `pnpm exec tsc --noEmit`: transient exit 2 after R8-1 added
  `RUN_UNBLOCKED` to `EVENT_TYPES` but before its owned
  `event-row-fuzz.test.ts` exact-key seed appeared. All three diagnostics named
  that missing sibling-owned seed. Final whole-tree rerun after the seed:
  **exit 0**.
- The R8-1 unblock-focused batch reached **21 pass / 4 fail / 0 skipped** at
  the final census: the four failures are the still-unrewritten Round 7
  absence/note expectations in `replay.test.ts` and `blocked-next.test.ts`.
  Event fuzz and the rest of replay passed. No owned file is involved.
- No timing-sensitive test is owned by this docs slot. No full gate was run.

## Final census

At **2026-08-24 21:50 UTC**, the final working tree contained this slot's four
docs files, the one disclosed `supervisor.ts` comment, and this report; all
other modified/untracked files were attributed above to the parent or sibling
slots. R8-1 source carried the unblock and rewritten note, so the final docs use
the post-unblock wording. `docs/decisions/0005…md` remains flagged and
unchanged; every ADR status line remains untouched.

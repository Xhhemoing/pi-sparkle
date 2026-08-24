[Model: gpt-5.6-sol-xhigh-fast]

# Loop 4 · Round 9 — R9-4: Round 8 documentation truth-up

## Verdict

The docs truth-up is present in the shared working tree. It replaces the three
stale 21:50 UTC notes, records the Round 8 decisions and frozen contracts, and
syncs the live descriptions to the final Round 9 working-tree census.

Files changed by this slot:

- `docs/status-matrix.md`
- `docs/data-dictionary.md`
- `docs/specs/m0-m2-architecture.md`
- `docs/superpowers/plans/2026-08-18-phase-a-tracking-supervisor.md`
- `.agent_workspace/loop4-r9-t4.md`

No ADR file, ADR status line, `src/**`, `package.json`, or parent-owned
`.agent_workspace/PROGRESS.md` was edited.

## Truths recorded

1. R8-9's deletion of root-keyed `loadProjectBandit` is committed at
   `ba0b2ce`, not an in-flight edit. Doctor's keyed diagnostic reader remains.
2. R8-1's implementation and pins landed together in `05051ac`. The BLOCKED
   surface remains exactly four routed lines: three `next:` lines (`inspect`,
   `inject`, `unblock`) and the `note:` that resume alone replays BLOCKED.
3. The parent-plane residuals are decisions: a crash over
   `WAITING_FOR_USER` records `RUN_FAILED` because the in-memory answering
   channel died; `RUN_CANCEL_REQUESTED` stays unguarded because it is an
   operator fact, not a status claim.
4. `CATALOG_OBSERVED_CORRUPT` remains a frozen defense-in-depth route for a
   future command producer. No CLI producer reaches it; doctor is the only
   command-path reader and absorbs the typed error into `learnedState`.
5. R8-4's fourth precondition was documented, then updated when the observed
   Round 9 tree closed it: `PiAgentExecutor` now exposes
   `sparkle_report_task_result`. A reported `PASSED` reaches a pinned no-gate
   case, evidence-backed `FAILED` reaches `deterministic-fail`, and silence or
   refusal remains `UNOBSERVED`. This is a whole-task verdict, not the deferred
   per-criterion channel.
6. R8-8's `INSPECT_SUMMARY` remains frozen additive, exactly
   `type` / `runId` / `status` / `requiredEvidence`, outside the event union.
   R9-1 added the producer-side `main.ts` comment; this docs slot did not touch
   it.
7. End-sync also records R9-1's observed durable run-contract implementation:
   `FlowchartCheckpointState.contract`, validation and checkpoint writers,
   pause/inject restoration, CLI projection, and explicit-continuation-first
   precedence. The contract is never synthesized from episode acceptance.

## Working-tree census

The census used `git status`, `git diff`, source reads, and symbol searches
against the shared tree, not the dispatch in-flight list.

- **2026-08-24 22:26:35 UTC:** tree clean at `54d3131`; no R9-1 or R9-2
  implementation was present.
- **2026-08-24 22:26:59 UTC:** `event-row-fuzz.test.ts` was modified and HEAD
  had advanced to `c5ab9bf`; this was the first observed sibling edit.
- **2026-08-24 22:28:39 UTC:** the tree contained R9-6 source/tests and several
  other slot reports; no `report_task_result` producer existed in `src/**`.
- **2026-08-24 22:29:26–22:30:04 UTC:** R9-1's checkpoint schema, writers,
  restorers, precedence, and CLI projection appeared incrementally in the
  working tree. The old “contract is not durable” prose was then updated.
- **2026-08-24 22:31:22–22:32:57 UTC:** R9-2's
  `sparkle_report_task_result`, real `TASK_RESULT` producer, tests, and
  inverted R8-4 producer census appeared. The docs were updated from the
  no-real-producer precondition to the observed reachable outcomes.
- **2026-08-24 22:33–22:34 UTC:** verification crossed two sibling mutation
  checks: R9-1 temporarily removed the CLI contract spread, and R9-2
  temporarily removed the verdict tool from the agent tool list. Those
  transient reds were attributed to their exact files and left untouched.
  Both owners restored their mutations; the final rerun was green.
- **2026-08-24 22:36:16 UTC (final):** HEAD was `4d21a96`. R9-1's
  `src/{cli/main,run/flowchart-run,run/replay}.ts` implementation/tests and
  R9-2's `src/pi-adapter/pi-executor.ts`, producer-census pin, and new
  `report-task-result.test.ts` were present but uncommitted. The final sync
  labels them working-tree facts rather than HEAD commits.

## Stale ADR body flagged, not edited

`docs/decisions/0005-checkpoint-f-holdout-open-questions.md:110` still names
deleted `loadProjectBandit`. The ADR body and every ADR status line remain
untouched. ADR-006 remains Proposed.

## Verification

- `git diff --check -- docs`: clean.
- Round 8 truth batch: **60 pass / 0 fail / 0 skipped** (parent decisions,
  option-(a) preconditions before R9-2 appeared, inspection freeze, unblock
  replay/output, live isolation, and real bandit command routing).
- Final R9 durability/verdict batch: **47 pass / 0 fail / 0 skipped** across
  `resume.test.ts`, `flowchart-snapshot.test.ts`, `row-fuzz.test.ts`,
  `report-task-result.test.ts`, and the inverted option-(a) producer census.
- Whole-tree `pnpm exec tsc --noEmit`: exit 0 after the final restored tree.
- No full gate; parent owns it. No scratch files were added.

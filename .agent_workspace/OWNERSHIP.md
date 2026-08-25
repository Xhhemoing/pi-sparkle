# File ownership — Loop 4 Round 15 (`agent/opt-continuous`)

Parent owns `.agent_workspace/PROGRESS.md`. Subagents never git commit. **Stay on branch `agent/opt-continuous`. Do not `git checkout` another branch.**

**One slot. No siblings.** ROUND14-BRIEF §4: this docs truth-up is valid only as the round's sole landing. Dispatching any other landing voids the candidate (reproduces the census-note treadmill). Freeze extras are not dispatched.

Lists are binding. Nobody edits `src/**`, tests, `flowchart-run.ts`, `main.ts`, or any pin file.

Landing commits are slot files + report only — no PROGRESS ticks.

Injection brief: `.agent_workspace/ROUND14-BRIEF.md`. Review: `.agent_workspace/loop4-r14-review.md`.

| Slot | Model | Owns |
|---|---|---|
| R15-1 | gpt-sol | `docs/**` only. Terminate the census-note treadmill: the three embedded notes still describe the pre-coda `replay.ts` paragraph ("then lines 85–93"), superseded by `25a3c2f` five seconds before their own commit. Record Round 14 landings as commits (`25a3c2f`, `a1ea5f2`): the scoped coda at `replay.ts:95-101`, the ride-along pointer retirement, and the docs truth-up itself. Five-census pattern; with no sibling in flight the census can be current at HEAD — say so, and say subsequent rounds need a new census note only when a landing changes what the surfaces describe. **Do not touch any ADR status line.** ADR-006 stays Proposed. `docs/decisions/**` untouched. Never assign an uncommitted sibling a commit id (there must be none). |

**Parent sign-off:** no extra. Docs: no ADR flip. This is the round's only landing.

Frozen (do not break): `taskCriteria` writer as shipped (three sources, empty logged ignored, no `continuation.taskCriteria`, both behavioural arms); scoped laundering coda is citable source prose; early-id disclosure uniform on all three public run paths; `onRunStarted` as shipped; exact eight `RunStatus` members; option (a) schema; restore-side discard audit; 11-case probe; `INSPECT_SUMMARY` four keys; BLOCKED prefix + `note:`; `RUN_UNBLOCKED` three keys; `RUN_UNBLOCKED_WITH_DISCARD` exact-key; `independentEvidence` one `void` + spine zero-mention; episode never-synthesize; every flowchart-payload writer carries `contract` and `taskCriteria`; verdict-producer rules; gate `runStatus` ledger; R8-3 AST pin; `loadProjectBandit` absence; catalog posture (b); parent-plane residuals; reconstruction `childTasksFromLog` + FAIL-unreachable; `coverageOutcome` no FAIL; `recordCrashTerminal` rethrow; `applyRetry` sole scheduler producer; jsonl; `writeFileAtomic`(+Sync); no new private tmp+rename; `withRunLifecycleLock`; append/checkpoint unlocked; five `DOCTOR_ROUTED_NEXT` routes; loopback supervised resume; empty-graph pre-flight; `settleSupervisedOutcome` absence; no live R1 / Outcome-supported / ADR-006 Accepted / auto-promote / `package.json`. Do not edit the `replay.ts` docstring again.

Every slot: census first against the working tree; verify handed paths exist before writing; `git diff --check -- docs`; stale-claim search; report `.agent_workspace/loop4-r15-t1.md`. No full gate. No scratch files. Timestamp-census the working tree.

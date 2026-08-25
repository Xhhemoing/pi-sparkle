# File ownership — Loop 4 Round 14 (`agent/opt-continuous`)

Parent owns `.agent_workspace/PROGRESS.md`. Subagents never git commit. **Stay on branch `agent/opt-continuous`. Do not `git checkout` another branch.**

The freeze surface is saturated. **Two real candidates, not ten** (ROUND13-BRIEF §4). Freeze-extra census slots are not re-dispatched.

Lists are binding. **Hard contention:** R14-2 (comment-only `replay.ts`) and R14-1 (docs) truth-up adjacent facts. They run in parallel with docs-race discipline; **the parent commits R14-2 before R14-1**. R14-1 never assigns an uncommitted sibling a commit id. Nobody edits `flowchart-run.ts`, `main.ts`, `blocked-next.test.ts`, `unblock-flow.test.ts`, `replay.test.ts`, or any pin file without a mandate naming it.

**Dispatch cross-check:** every "replace X in the same diff" obligation below lives in that slot's owned files. Fold unowned-file joints into the landing commit, not a follow-up. Landing commits are slot files + report only — no PROGRESS ticks.

**Mutations run out-of-tree:** full copy under `/tmp` with `node_modules` symlinked, then deleted. No in-tree mutation window.

Injection brief: `.agent_workspace/ROUND13-BRIEF.md`. Review: `.agent_workspace/loop4-r13-review.md`. Dispatch: R14-2 `bc-6fe42e12-b7d6-58d8-a1a5-569ec66c7470`; R14-1 `bc-1c805383-8352-5b87-81df-eb042c90dad3`.

| Slot | Model | Owns |
|---|---|---|
| R14-2 | opus | Comment-only `src/run/replay.ts`. Scope the `:85-93` laundering narrative: mechanics stay true for unrecorded nodes; recorded nodes are restored before they run; an unvouched logged-empty is detectable. Keep every pinned phrase (`never *synthesized*`, `not from the bound episode` at `:72`/`:98`, outside this paragraph but inside the same interface region). Mechanically comment-only; token-stream-proven. Optionally comment-only `test/unit/tracking/option-a-preconditions.test.ts:618` (replace spent `loop4-r11-t1.md` pointer with landed fact `resume.test.ts` / R12-1; disclose). Conditional pin files only if a pinned sentence must move (replacement not deletion). **No behavioural src.** |
| R14-1 | gpt-sol | `docs/**` only. Timestamp-census the working tree. **Do not touch any ADR status line.** ADR-006 stays Proposed. `docs/decisions/**` untouched. Own the stale Round 13 spots in the brief §4 R14-1. Record Round 13 landings as commits. Never assign an uncommitted sibling a commit id. If R14-2 has not landed as a commit at census time, describe the `:85-93` paragraph as it is — do not cite an uncommitted sibling. |

**Parent sign-off**
- **R14-2 YES — comment-only scoping of `replay.ts:85-93`.** One or two sentences; keep the mechanics sentences and every pinned phrase. Mechanically comment-only. Ride-along: spent prescription pointer at `option-a-preconditions.test.ts:618` if you take that file (comment-only, disclose).
- **R14-1:** no extra sign-off. Docs: no ADR flip. Parent commits this slot after R14-2.

Frozen (do not break): `taskCriteria` writer as shipped (three sources, empty logged ignored, no `continuation.taskCriteria`); reopen carry and log-merge now behavioural; early-id disclosure uniform on all three public run paths (sequence pins); `onRunStarted` as shipped (throw swallow, not a control channel); exact eight `RunStatus` members; option (a) schema; restore-side discard audit; 11-case probe; `INSPECT_SUMMARY` four keys; BLOCKED prefix + `note:`; `RUN_UNBLOCKED` three keys; `RUN_UNBLOCKED_WITH_DISCARD` exact-key; `independentEvidence` one `void` + spine zero-mention; episode never-synthesize; every flowchart-payload writer carries `contract` and `taskCriteria`; verdict-producer rules; gate `runStatus` ledger; R8-3 AST pin; `loadProjectBandit` absence; catalog posture (b); parent-plane residuals; reconstruction `childTasksFromLog` + FAIL-unreachable; `coverageOutcome` no FAIL; `recordCrashTerminal` rethrow; `applyRetry` sole scheduler producer; jsonl; `writeFileAtomic`(+Sync); no new private tmp+rename; `withRunLifecycleLock`; append/checkpoint unlocked; five `DOCTOR_ROUTED_NEXT` routes; loopback supervised resume; empty-graph pre-flight; `settleSupervisedOutcome` absence; no live R1 / Outcome-supported / ADR-006 Accepted / auto-promote / `package.json`.

Every slot: census first against the working tree; **verify that a path the brief hands you actually exists before writing to it**; scoped eslint + whole-tree `tsc --noEmit`; 3× timing-sensitive tests; report `.agent_workspace/loop4-r14-tN.md`. Census consumers. No full gate. No scratch files. Docs slots census the working tree with timestamps.

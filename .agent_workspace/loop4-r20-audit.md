[Model: claude-fable-5-thinking-xhigh]

# Loop 4 · Round 20 — I/O, races, protocol honesty, disaster recovery at HEAD

Auditor role: Loop 4 Round 20 auditor. Branch `cursor/opt-r18-postmerge-42b1`, dispatched at HEAD
`f6d6151`; HEAD advanced mid-audit to `3cd8718` (verified `.agent_workspace/PROGRESS.md`-only via
`git show --name-status`; `git diff f6d6151..3cd8718 -- src test docs scripts package.json` is
empty), so the audited code tree is exactly `4412fac`'s throughout. No commits, no pushes, no
branch changes by this auditor; zero edits outside `.agent_workspace/` (this file and
`ROUND20-BRIEF.md` only).

**Verdict: 2 candidates, both proven with deterministic out-of-tree runs of real repo code, 3×
identical each.** R20-1 (a declared per-child `maxCostUsd` is silently rewritten across
pause/resume for a never-dispatched child — dropped in one direction, invented in the other, P2)
and R20-2 (a steer aimed at a run in retry backoff is delivered into a different run sharing the
executor, and the aiming run's log durably claims its own agent was steered, P3, sign-off YES on
the contract signature). Everything else on the dispatched plane is killed with evidence below.
This round deliberately did not reopen anything ROUND19-BRIEF §3/§5 froze.

## 1. Independent baseline (this VM, Node v22.14.0, engines `>=22.19.0` warning only)

- Auditor's own `pnpm gate` at HEAD: **GREEN, exit 0 — 2042 tests / 2041 pass / 0 fail /
  0 cancelled / 1 skipped / 120 suites**; typecheck, lint, test, build all ran. Exactly one
  `# SKIP` line (`grep -c` = 1): `ok 296 - PiAgentExecutor completes a run against a real provider
  # SKIP` (the standing `PI_SMOKE` gate). **Matches the parent's recorded 2042/2041/1/120 exactly.**
- Auditor's own `node scripts/crash-probe.mjs`: **exit 0, `ok: true`, 11 cases × 3 iterations
  each**, names and order verified one-by-one against the pinned record
  (`jsonl-truncated-tail` … `unblock-discard-append-before-checkpoint-sigkill` last). No 12th case.
- `node scripts/security-probe.mjs` against the gate-built `dist/`: see §3 H3.
- Environment note: the gate build produced `dist/` in-tree; `dist` is gitignored (verified with
  `git check-ignore`). Working tree clean at report time; the ~65 leaked `pi-sparkle-*` suite roots
  my own full-suite run left in `/tmp` (the known hygiene phenomenon, posture frozen in
  ROUND19-BRIEF §5) were removed, along with the gate/probe logs and the proof copy.

## 2. Method

Proofs ran in a full out-of-tree copy: `git archive HEAD` extracted to `/tmp/r20-audit/tree`,
`node_modules` symlinked, proof tests added **only inside the copy**, run via the repo's own
`scripts/run-tests.mjs` (tsx --test), each 3× with identical results, then the whole `/tmp/r20-audit`
deleted and verified gone. No scratch files remain anywhere; the proofs' `mkdtemp` state roots were
removed by the proofs' own `finally` blocks (verified: no `pi-sparkle-r20-*` entries in `/tmp`).

## 3. Named hypotheses — disposition

| # | Hypothesis | Disposition |
|---|---|---|
| H1 | Resume × cost cap (`fallbackChildLimits` omits/carries `maxCostUsd`; cluster `onSpawn` hardcoded limits) | **PROVEN in both directions → R20-1** (§4.1). The cluster `onSpawn` half is **killed**: on the coordinator plane the `ChildCoordinator` is constructed with `maxCostUsd: run.limits.maxCostUsd` (`coordinator.ts:705`), so a spawned peer's hardcoded three-field limits (`coordinator.ts:692`) still meet the run-level cap inside `costCapFor` (min with an absent per-task cap = the run cap); on the flowchart plane (`flowchart-run.ts:595`) there is no run-level cap to lose (`FlowchartRunLimits` carries none — R18 audit §5, still true) and a spawned peer declares no per-task cap, so no declared or forwarded ceiling exists to disappear. |
| H2 | `acceptedSteers` lifetime vs abort/retry/concurrent execute | **PROVEN for the cross-run wrong-instance shape → R20-2** (§4.2). The other named shapes are **killed**: *lost after R18-1* — the log's lifetime is the whole `execute()` (`runWithRetry` registers/deletes with identity guard, `pi-executor.ts:655-656`, `:688-690`), never cleared on attempt success, snapshot per attempt; the 12 in-tree steer pins run green in the gate. *Double-applied* — the per-attempt snapshot (`:662`) plus the once-per-attempt latch (`:568-584`) exclude it; the reviewer's M2 mutant already proved the latch load-bearing. *Wrong instance within one run* — `steerText` refuses >1 live kernels loudly; the sole-live targeting for one parent run's children is the disclosed contract (`coordinator.ts:777-779`) and the parent-run `STEER_INJECTED` payload deliberately carries no `agentInstanceId` (`:788`), so no record goes false. *Abort during backoff* — no kernel live under an unshared executor → loud refusal (frozen, and re-verified as the in-proof control of R20-2). |
| H3 | `scripts/security-probe.mjs` vs `dist/` | **KILLED.** Run against the gate-built `dist/` (exactly what its header prescribes): exit 0, `status: "ok"`, **14/14 passed** (13 redaction/secret-body samples through the real `dist/feedback/redaction.js` + 1 `npm pack --dry-run` scan), `openFindings: []`, `waivedFindings: []`, no `SECURITY_WAIVER` set. No security or honesty failure; nothing waived to drive by. |
| H4 | New unlocked read-modify-write / torn publish under live kernel events | **KILLED.** The full R18 range diff (`985250b..4412fac`, verified with `git diff --stat`) is 5 files; the only two `src` files are `pi-executor.ts` (steer state is in-memory only: `liveKernels`, `acceptedSteers`; its sole disk-adjacent output is the `onInvocation` telemetry sink, whose writer is the Loop-3-locked invocation log) and `main.ts` (parse region, writes nothing). Steer retry and live-through-tool-start both write through the pre-existing `EventStore.append`/`SteerChannel` paths that the R18 audit already swept; no new writer, no new read-modify-write, no new publish exists at HEAD to tear. `EventStore.append`/`CheckpointStore.write` stay unlocked per the frozen measured decision — untouched and not re-litigated. |
| H5 | A durable event or CLI/docs surface R18-1/R18-2 made false | **KILLED as a slot; two records made (below).** USAGE documents the children spec as `{ "tasks": [{ "id", "role", "objective", ... }] }` and makes no limits-field claims — nothing false. README mentions neither steering nor cost caps. `docs/data-dictionary.md` is the durable *record-class* dictionary (file classes, planes), not an event-type catalog — `STEER_INJECTED`/`THINKING_DELTA` absence is out of its scope, not staleness. `protocol/v1.ts`, `execution/contract.ts`, and `m0-m2-architecture.md:359-366` all verified still aligned with R18-2's rewrite. |

**H5 records (not slots):**
1. `docs/kernel-reuse.md` — the dispatch and ROUND19-BRIEF §5 freeze this file, and the freeze is
   honored. For the parent's awareness only: beyond the dated journal subsections, the file's
   present-tense normative section (“## Semantics extenders must respect — These are properties of
   the current adapter, not suggestions”) still states at `:131-136` that “Queued
   steering/follow-up messages … do not survive a retried attempt”, and the worked example at
   `:213-214` says “The retry decision went to document-and-drop”. R18-1 superseded exactly that
   for accepted steers (they are re-delivered into each retry kernel). The ROUND19 freeze judged
   the file on its `maxCostUsd` claim gates (`:107-114`, still true); these lines were not part of
   that judgment. Recorded for whenever the parent re-judges the freeze; no edit made or proposed.
2. `docs/specs/m0-m2-architecture.md:368-377` says a substituted node “receives the earliest logged
   sibling's budget” — written when the budget was three coordinator-enforced fields. R20-1's proof
   shows the sibling's *spend authorization* now rides along. Whichever fix direction lands,
   this sentence is the landing-triggered census alignment that rides **inside** the R20-1 landing
   (census terminator), so it is listed in R20-1's ownership, not as a separate item.

## 4. Proven holes (deterministic, out-of-tree, real repo code, 3× identical; proofs deleted)

### 4.1 R20-1 (P2) — pause/resume silently rewrites a declared per-child `maxCostUsd`

**Seam.** `resumeFlowchartRun` rebuilds child specs from the parent log (`childTasksFromLog`,
`flowchart-run.ts:483-524`). A child the log has never seen dispatched has no `TASK_REQUEST`, so it
gets `fallbackChildLimits` (`:428-449`): the earliest logged sibling's **entire** limits object
(`:433 return sibling.value.limits;`) or, with no sibling, a three-field object built from
`RUN_CREATED` (`:437-441`) / defaults (`:444-448`) that never carries `maxCostUsd`. Both arms were
harmless while `maxCostUsd` was disclosed-unenforced; since `159630e` + R18-2 the field is
load-bearing (`costCapFor` → execution request + child `RUN_CREATED.limits`, `CostGate` enforces
under `PiAgentExecutor`). Nothing durable records a declared-but-never-dispatched child's cap: the
R12-1 `taskCriteria` checkpoint record — created for exactly this dispatch-gap laundering — carries
acceptance criteria only. CLI-reachable end-to-end: `run --children` compiles into
`startFlowchartRun` with `childTasks` (`main.ts:990,1009`); `pause --run`; `resume --run --unpause
--executor …` reaches `resumeFlowchartRun` (`main.ts:1442`).

**Proof** (out-of-tree test driving real `startFlowchartRun`/`resumeFlowchartRun`, the in-tree
resume suite's own scaffolding — two tester children, second `dependsOn` first, pause toggled by the
first child's executor, resume with `unpause`; all records read back from the on-disk event store):

```text
# control TASK_REQUEST tsk_second limits: {"maxAttempts":3,"timeoutMs":45000,"maxWallTimeMs":900000,"maxCostUsd":0.05}
ok 1 - control: without a pause, a declared per-child maxCostUsd reaches the second child intact
# resumed TASK_REQUEST tsk_second limits: {"maxAttempts":3,"timeoutMs":45000,"maxWallTimeMs":900000}
# resumed child RUN_CREATED tsk_second limits: {"maxTasks":16,...,"maxWallTimeMs":3600000}
# resumed execution request tsk_second maxCostUsd: undefined
ok 2 - a declared per-child maxCostUsd disappears across pause/resume for a never-dispatched child
# resumed TASK_REQUEST tsk_second limits: {"maxAttempts":3,"timeoutMs":45000,"maxWallTimeMs":900000,"maxCostUsd":0.25}
# resumed child RUN_CREATED tsk_second limits: {"maxTasks":16,...,"maxWallTimeMs":3600000,"maxCostUsd":0.25}
# resumed execution request tsk_second maxCostUsd: 0.25
ok 3 - a sibling's maxCostUsd is invented for a never-dispatched child across pause/resume
```

3/3 identical runs. **Direction one (test 2):** the caller declared `maxCostUsd: 0.05` for
`tsk_second`; one pause before its dispatch and one resume later, the ceiling is gone from the
re-dispatched `TASK_REQUEST.limits`, from the child's `RUN_CREATED.limits` (“the record of what this
run was allowed to spend”, per `runTask`'s own docstring), and from the execution request — the
child runs uncapped, exit 0, no warning. The same silent-drop honesty shape R18-2 closed at the
parse, reopened by the resume rebuild. **Direction two (test 3):** `tsk_second` declared *no*
ceiling; the rebuild hands it the sibling's `0.25`, which is stamped into both durable records and
handed to the executor for real enforcement — violating the frozen kernel-reuse contract "an absent
cap stays absent — never invent one" on disk, and (under a priced catalog) stopping a child at a
ceiling its caller never set on it. The control (test 1) pins that the straight-through path is
intact, so the pause/resume boundary is the sole difference-maker.

**Severity** P2 — needs a declared per-child cap plus a pause/block/crash before that child
dispatches, but the outcome is either unbounded spend the operator believes is capped or a false
durable authorization enforced against the wrong task. Same class as R18-2.

**Fix shapes** (parent decides; see brief §4): (a) minimal — `fallbackChildLimits` substitutes only
the three coordinator-enforced fields, stripping `maxCostUsd` from the sibling arm (kills the
invention; the disappearance stays, disclosed); (b) full — record dispatched per-child limits (or
just the ceiling) durably at accept time and restore them on the rebuild, exactly the R11→R12
`taskCriteria` precedent (checkpoint-schema addition → sign-off). Either way
`m0-m2-architecture.md:368-377` is realigned inside the landing.

### 4.2 R20-2 (P3) — a steer aimed at a run in backoff lands in a different run sharing the executor

**Seam.** `AgentExecutor.steerText?(text)` carries no target (`execution/contract.ts`), so
`PiAgentExecutor.steerText` targets “the sole live attempt” (`pi-executor.ts:701-720`): it refuses
zero and >1 live kernels, but with exactly one live kernel it cannot know which run the caller
meant. During run A's retry backoff, A's kernel has been deleted from `liveKernels` (`:612-614`);
if a second run B on the same executor has a live kernel, `runA.steer(text)` — run A's own handle —
delivers the text into B's kernel, records it in **B's** `acceptedSteers` (`:719`, so a retry of B
would re-deliver A's instruction into B again), and run A's `SteerChannel` then appends
`STEER_INJECTED` to **A's** log with **A's** root `agentInstanceId` (`coordinator.ts:350-361`) —
delivery-before-logging satisfied by the wrong run's delivery. The disclosed whichever-child
targeting covers children of *one* parent run, whose `STEER_INJECTED` deliberately omits
`agentInstanceId` (`coordinator.ts:777-788`); only cross-run sharing makes a durable record false.

**Proof** (out-of-tree test, two real `startRun` calls sharing one real `PiAgentExecutor`, scripted
faux provider, retry `sleep` stubbed to a deferred, run B held open by a blocking tool; fully
gated by deferreds, no timers):

```text
# A-call-1 user turns: ["[...\"RUN-A: audit the schema\"]"]                       (then 429 → backoff)
    control: runA.steer(...) while nothing is live → throws DomainValidationError /no agent run is in flight/
# B-call-1 user turns: ["[...\"RUN-B: refactor the parser\"]"]                    (blocking tool holds B live)
    runA.steer("RUN-A ONLY: stop the schema migration immediately.") → ACCEPTED, no throw
# B-call-2 user turns: ["[...\"RUN-B: refactor the parser\"]","\"RUN-A ONLY: stop the schema migration immediately.\""]
# A-call-2 user turns: ["[...\"RUN-A: audit the schema\"]"]
# run A STEER_INJECTED: {"agentInstanceId":"agt_a62aab7e-…","text":"RUN-A ONLY: stop the schema migration immediately."}
ok 1 - a steer aimed at a run in retry backoff lands in a different run sharing the executor
```

3/3 identical runs. Asserted: the in-proof control shows the frozen backoff refusal holds while the
executor has no live kernel; with B live the same steer through the same handle is accepted; run A's
log carries exactly one `STEER_INJECTED` naming **A's own agent instance**; no model call of run A
ever carried the text; exactly one model call of run B did; run B's log records **no** steer. Two
durable dishonesties from one act: A's log claims an instruction A's agent never saw, and B's
transcript-affecting instruction has no record on B at all.

**Severity** P3 — embedder-only (the CLI never shares an executor across concurrent runs), needs
the backoff window plus a concurrent run on a shared executor. But the executor documents itself as
serving concurrent work, sharing one configured `PiAgentExecutor` is the natural embedder shape, the
transcript is deterministic, and the record made false names a specific `agentInstanceId`.

**Fix shape** (needs sign-off — contract signature change): widen the optional contract member to
`steerText(text, agentInstanceId?)`; `startRun` passes its root agent instance (it mints it),
`startParentRun` keeps passing none (whichever-child stays the disclosed semantics for one run's
children); `PiAgentExecutor.steerText` with a target delivers only to that instance's kernel and
refuses loudly when that instance has no live kernel — restoring "a steer during backoff is a loud
refusal" under sharing. `acceptedSteers` recording keys correctly for free. Backward-compatible
optional parameter; no new event type; R18-1 replay mechanics untouched. Declining the fix and
disclosing the sharing hazard instead would leave the false `agentInstanceId` record — that is why
(a)-shape documentation-only is not proposed.

## 5. Swept clean this round (not candidates, with reasons)

| Surface | Result |
|---|---|
| Coordinator-plane resume of `run --objective`/DAG runs | No analogous seam: the M2 DAG resume (`main.ts:1476-1481`) rebuilds a checkpoint, executes nothing, and re-dispatches no children; only the flowchart resume rebuilds specs. |
| Started-child resume fidelity | A child with a logged `TASK_REQUEST` keeps that request's limits verbatim on the rebuild (`request?.limits ?? substituted`, `flowchart-run.ts:510`), `maxCostUsd` included — verified by reading the rebuild path; only the substitution case is broken (R20-1). |
| `costCapFor` min semantics | Unchanged and correct: per-task and run-level caps min'd, absent+absent stays absent (`child-coordinator.ts:413-418`). R20-1 corrupts its *input*, not its arithmetic. |
| Steer within one run across abort/cancel | Abort during a live attempt: kernel aborted, execution returns CANCELLED, channel closes, later steers refuse loudly (in-tree pins). No path found where an accepted steer is dropped or double-applied within one execution at HEAD (analysis + reviewer's single-red mutants + 12 pins green). |
| `SteerChannel.settled()` allSettled swallow | Unchanged; disk-failure-only, frozen posture (owner-on-next-touch of `coordinator.ts`), not reopened. |
| `AsyncEventQueue` close race | Unchanged, docstring-pinned unreachable; not reopened. |
| Crash/DR windows around resume | The unblock/checkpoint crash windows are covered by the 11-case probe (re-run green 3×); `preserveResumableState`/`recordCrashTerminal` diff-empty since their pins; no new window introduced by the R18 range (5-file diff). |
| Invocation telemetry under retries | `reportInvocation` writes through the locked invocation sink; attempt/callOutcome fields unchanged by R18-1 (only the steer replay was added); usage trustworthiness rules (`usageIsTrustworthy`) unchanged. |

## 6. Process record

- Census run against the working tree first; every path cited above exists at HEAD.
- Proofs: out-of-tree full copy (`git archive HEAD` + symlinked `node_modules`), proof tests added
  only in the copy, run 3× each via `scripts/run-tests.mjs`, transcripts captured above, then
  `/tmp/r20-audit` deleted and verified gone. The proofs' own state roots self-cleaned; my gate
  run's ~65 leaked `pi-sparkle-*` suite roots and the gate/probe logs were also removed. `/tmp` has
  no `pi-sparkle*` or `r20*` entries at report time.
- No commits, no pushes, no branch changes. Zero edits to `PROGRESS.md`, `src/**`, `test/**`,
  `docs/**`, `scripts/**`, `package.json`. This file and `ROUND20-BRIEF.md` are the only writes.
- Frozen-list compliance: nothing in ROUND19-BRIEF §3/§5 was reopened; the two candidates sit on
  seams those lists do not name (the resume-substitution cap fidelity and the cross-run steer
  target), and each *restores* a frozen contract the proofs show violated ("absent stays absent";
  "a steer during backoff stays a loud refusal").

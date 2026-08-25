# Durable record dictionary

Source of truth: `src/privacy/record-classes.ts` (`DURABLE_RECORD_CLASSES`).
Tests: `test/unit/privacy/record-classes.test.ts` (schema, required ids,
**path-completeness**, sensitivity-class consistency, **plane layout**),
`test/unit/privacy/plane-boundary.test.ts` (**adaptation→runtime boundary**,
direct imports), and `test/unit/privacy/adaptation-plane-closure.test.ts`
(the same boundary over the **transitive value-import closure**).

This dictionary is a Developer Preview control. It does **not** close P0 privacy
review by itself. The 2026-08-22 independent review returned **CONDITIONAL**:
Q3–Q5 passed; Q1 and Q2 required remediation, which is now implemented
(see `docs/reports/2026-08-22-p0-privacy-review-package.md` §7).

## State-root plane layout (Q1 remediation)

The state root (`~/.pi-sparkle/`, override `--state-root`) is split into two
explicit plane directories:

- `<root>/runtime/` — run-event, run-checkpoint, run-pause, track-questions,
  episode, model-invocation, catalog-observed, providers-config,
  auth-credential
- `<root>/adaptation/` — feedback (+tombstones), preference,
  preference-dataset, candidate, routing-eval-report, routing-eval-dataset,
  learned-routing-policy, learning-bandit, experiment

**Boundary rule:** adaptation modules never read runtime files directly.
Runtime data reaches the adaptation plane only as (a) derived signals with no
user text (taskSuccess PASS/FAIL via `src/learning/from-episode.ts`), or
(b) through the redaction pipes (`redactFeedback` / `exportForDataset` /
`exportRoutingEvalDataset`, which truncates the task objective to 500
characters and runs it through `redactSensitiveText` before writing a replay
dataset). The current import exceptions are pinned in
`test/unit/privacy/plane-boundary.test.ts`; new ones require an explicit
allowlist entry with a justification.

> Precision note (2026-08-24, Loop 3 pin revised at Loop 4 closeout): the allowlist pin
> above is **direct-import only**; the second pin closes the transitive gap.
> `test/unit/privacy/adaptation-plane-closure.test.ts` walks the union
> **value-import closure** (`import type` statements stripped, as
> `verbatimModuleSyntax` erases them) of every adaptation-plane module and pins
> each runtime-prefix module against an explicit, justified allowlist. Loop 4
> removed the inferred-preference episode lookup from `from-episode`, shrinking
> that pipe to `run/event-store.ts`, `run/events.ts`, and `run/injection.ts`;
> the fourth allowed module is `supervisor/model-router.ts`, reached through
> `adaptation/eval-routing.ts -> routing/assign.ts`. The router's entire value
> subtree is pinned filesystem-free. The fail-closed regex walker counts
> comment-shaped imports as edges, sees only literal specifiers, and is paired
> with a repo-wide rejection of computed `import(expr)` in `src/`.

> Layout note: this is a Developer Preview breaking change. Data written by
> builds before 2026-08-22 sits at the legacy flat locations and is not
> auto-migrated (per Q4 decision: migration planning deferred to v2).

## Classes (18)

| id | owner | path | retention | deletion | migration |
|---|---|---|---|---|---|
| run-event | runtime | `runtime/runs/<runId>/events.jsonl` | run-scoped | delete-files | 1 |
| run-checkpoint | runtime | `runtime/runs/<runId>/checkpoint.json` | run-scoped | delete-files | 1 |
| run-pause | runtime | `runtime/runs/<runId>/pause.json` | run-scoped | delete-files | 1 |
| track-questions | runtime | `runtime/runs/<runId>/track-questions.json` | run-scoped | delete-files | 1 |
| episode | runtime | `runtime/episodes/<episodeId>.jsonl` (+ `<episodeId>.events.jsonl`) | episode-scoped | delete-files | 1 |
| artifact-ref | runtime | TASK_RESULT ids only | run-scoped | exclude-from-export | 1 |
| feedback | adaptation | `adaptation/feedback/records.jsonl` (+ `tombstones.json`) | until-deleted | tombstone-ids | 1 |
| preference | adaptation | `adaptation/preferences.json` | until-deleted | tombstone-ids | 1 |
| preference-dataset | adaptation | derived export | until-deleted | exclude-from-export | 1 |
| model-invocation | runtime | `runtime/invocations.jsonl` | run-scoped | delete-files | 1 |
| catalog-observed | runtime | `runtime/routing/catalog-observed.json` | until-deleted | delete-files | 1 |
| candidate | adaptation | `adaptation/registry.json` | until-rollback | tombstone-ids | 1 |
| routing-eval-report | adaptation | `adaptation/evals/<candidateId>.<cacheKey>.json` | until-deleted | exclude-from-export | 1 |
| routing-eval-dataset | adaptation | `adaptation/eval-datasets/<runId>/manifest.json` (default; `adapt dataset --dir` may name another directory) | until-deleted | delete-files | 1 |
| learned-routing-policy | adaptation | `adaptation/learning/projects/<stableProjectKey>/routing.json` | until-deleted | delete-files | 1 |
| learning-bandit | adaptation | `adaptation/learning/projects/<stableProjectKey>/bandit.json` | until-deleted | delete-files | 1 |
| experiment | adaptation | in-memory / fixture plans | until-deleted | exclude-from-export | 1 |
| providers-config | runtime | `runtime/providers.json` | until-deleted | delete-files | 1 |
| auth-credential | runtime | `runtime/auth.json` | until-deleted | delete-files | 1 |

## Deletion tooling (Q2 remediation, extended through 2026-08-24 Round 6)

`pi-sparkle delete --run <id>` removes the run's whole subtree under
`runtime/runs/<id>/`, **filter-rewrites the shared `runtime/invocations.jsonl`**
so the run's rows are dropped (under the log's cooperative lock; a corrupt
middle line fails the whole rewrite closed rather than reporting a partial
delete as success), and — when rows were dropped — **invalidates the derived
`runtime/routing/catalog-observed.json` snapshot** (unlinked, not recomputed;
the class's recovery is "rebuild from invocations.jsonl" and readers treat a
missing file as "no observations"). The subtree removal is verified rather
than assumed: if `runtime/runs/<id>/` survives or reappears during the removal,
the command throws `RunRecordsSurvivedError` with code
`RUN_RECORDS_SURVIVED` and refuses to report success. The removal and first
verification hold the cooperative `runtime/runs/<runId>.lock`; the command
then verifies a second time after releasing the lock. The second verification
is essential because the per-step event and checkpoint writers deliberately
do not take this lock and can recreate the subtree. A write after the final
verification is a new write, so deletion after termination remains the
supported flow.

The M0, parent, flowchart, and supervised start/resume paths, plus clarification
runs, take `runtime/runs/<runId>.lock` once for the whole record-writing
lifecycle and release it after teardown. Clarification discovery remains
outside the acquisition; its event, checkpoint, episode, and questions writes
are all inside one non-reentrant acquisition. Start preflight also remains
outside the lock on the other planes, so a refused start persists nothing.
That includes the M2 supervised DAG's empty-graph check:
`validateTaskGraph([])` throws before lock acquisition, event append,
checkpoint write, or executor entry.
Resume must acquire before reading the records that deletion could remove; a
refused resume of a nonexistent supervised or flowchart run therefore leaves
an empty `runtime/runs/` directory, but no run subtree, lock, or record.

`delete --run <id>` and `delete --episode <id>` accept
`--lock-wait-ms <ms>`. Omitting it preserves the lock's 5 s default, `0`
refuses a held lock immediately, and only decimal whole milliseconds through
the 24 h ceiling are accepted. The bound applies to every cooperative lock the
delete takes, not just the target's: on the `--run` path that is
`invocations.jsonl.lock` as well as `runtime/runs/<runId>.lock`, so `0` refuses
at both and a long chosen wait is not cut short by a default at the first one.
A delete aimed at a live run waits for clean teardown up to that bound instead
of removing records underneath it; if the run outlives the wait, deletion fails
with `LOCK_TIMEOUT`.

**A timed-out delete is partial, not a no-op, and that is deliberate.** Both
targets complete their adaptation/telemetry half *before* taking the lock that
guards the target's own records, so the privacy-safe work survives a failure:

- `--run` has already filter-rewritten `runtime/invocations.jsonl` and
  invalidated `catalog-observed.json` by the time it asks for the run lock.
  Those rows are not restored on failure; the CLI prints one stderr line naming
  the count and the paths before it exits non-zero, because the throw discards
  the `DeletionResult` that reports them on the success path.
- `--episode` has already stripped `body`/`summary` from feedback bound to the
  episode and persisted those ids as tombstones by the time it asks for the
  episode lock (`cascadeFeedbackTombstones` runs first, and the two locks are
  never nested).

What a `LOCK_TIMEOUT` refuses is the lock-guarded half — removing
`runtime/runs/<id>/`, or unlinking `<epId>.jsonl` and `<epId>.events.jsonl` —
and those records are left byte-identical. Re-running the same delete once the
lock is free is idempotent: the completed half is a no-op the second time and
the refused half finishes.

`pause` deliberately has no matching flag: waiting longer can succeed only
after the lifecycle holder has stopped, when writing a pause token would be a
slow no-op rather than pausing a busy run. A cross-process pause therefore
still fails closed with `LOCK_TIMEOUT` while the run is live.

A process killed by SIGKILL cannot release its lock; locks are never stolen, so
pause/delete/track-question writes remain blocked until an operator inspects
the recorded PID and run state with `pi-sparkle doctor`, stops any live owner,
and manually removes a confirmed abandoned lock. The crash-probe case
`sigkill-run-lock-operator-recovery` crosses that OS-process boundary: it proves
the recorded PID is dead, proves a timed-out delete leaves every file under the
run's own directory byte-identical (the scope it snapshots; the pre-lock
telemetry half above is outside it), checks
doctor's `pidLiveness: "not-running"` and manual-removal guidance, then removes
the confirmed abandoned lock and verifies deletion. The standing probe has
eleven ordered cases, each run for three iterations. The added tenth case,
`unblock-append-before-checkpoint-sigkill`, proves exact-once recovery after an
external kill between the complete `RUN_UNBLOCKED` append and checkpoint write;
the eleventh,
`unblock-discard-append-before-checkpoint-sigkill`, proves the corresponding
single-event recovery for `RUN_UNBLOCKED_WITH_DISCARD` and re-executes only the
retry target and discarded descendant. The name-list pin is
`test/integration/persist/crash-recovery.test.ts`.

A flowchart run has exactly one active replayed terminal. A tracking-gate
`queue_analysis` therefore beats a later node failure, and a
verification-failed child ends the run BLOCKED with `ANALYSIS_QUEUED`, the
episode WAITING, and the run injectable and resumable. The flowchart terminal
writers and replay anomaly rule share `TERMINAL_REPLAY_STATUSES` /
`replayedTerminalStatus` rather than deriving terminal status separately. A
matched `RUN_UNBLOCKED` explicitly ends the named BLOCKED interval; replay then
has no terminal until a later COMPLETED, FAILED, or BLOCKED event becomes
active.
The library/test-only parent plane follows the same first-terminal rule:
`runParentRun` routes its completion, ordinary failure, and crash exits through
one `recordTerminal`, which consults `replayedTerminalStatus` and refuses a
second terminal append. Two residuals are explicit decisions. A crash over a
log replaying `WAITING_FOR_USER` still records `RUN_FAILED`: the parent loop's
in-memory answering channel died with the process, so preserving the buried
wait would advertise a responder that no longer exists. `RUN_CANCEL_REQUESTED`
stays unguarded because it records an operator fact, not a status claim; replay
keeps any existing terminal and reports the ordering anomaly.

On flowchart resume, a node with a logged `TASK_REQUEST` is reconstructed from
the durable parent log rather than from the checkpoint definition's thin node
shape: the request restores objective, artifacts, criteria, and budget; the
role-bearing assignment `MODEL_ROUTED` restores role, model, and cascade;
checkpointed edges restore dependencies. A node without a logged request keeps
empty artifacts and receives the earliest logged sibling's `maxAttempts`,
`timeoutMs` and `maxWallTimeMs` (never its `maxCostUsd`) or the run's declared
per-task limits; a declared ceiling comes back only from the durable
`taskCostCeilings` record. Its criteria come from the durable `taskCriteria`
record when that record names the node; otherwise they remain empty/unknown.
The optional run requirement contract is durable as
`FlowchartCheckpointState.contract?` at unchanged checkpoint
`schemaVersion: 1`; absence remains valid. Validation, every
flowchart-checkpoint writer, pause/inject restoration, and both CLI
continuation paths preserve it. Resume honours an explicit
`FlowchartContinuation.contract` first and otherwise recovers the checkpointed
value. It never synthesizes a contract from the episode, from per-task
acceptance criteria, or as an empty `{ constraints: [] }` value.
Round 11 also added the validated optional
`FlowchartCheckpointState.taskCriteria?` seam. Absence means unknown, an
entry's empty list means known-none, entries are ordered by `taskId`, and the
field is never synthesized from the episode, flowchart definition, or run
contract. Round 12 filled the seam in `81f5b81` from exactly three sources:
caller specs at start, non-empty logged `TASK_REQUEST`s on checkpoint writes,
and the checkpoint's existing record on restore. Writes are monotone
first-write-wins. Empty logged requests are ignored because they cannot
distinguish substituted re-dispatch from known-none; only the caller's own
empty spec records known-none. The reader fills criteria only into substituted
specs and never overrides a logged request. There is no
`FlowchartContinuation.taskCriteria` input. Round 10's contract census and
Round 12's `d592f8c` / `0e61063` pins require field carriage and at least one
writer without freezing the writer count, while the source-wide episode-reader
census rejects contract- or task-criteria-shaped output. The episode remains a
deliberately lossy projection carrying acceptance criteria, never run-contract
or task-dispatch authority. Commit `f6e4c04` corrected the two stale source
comments to describe this shipped writer. Commit `e7d018c` behaviourally pins
the persistence edges: a caller-recorded known-none entry survives unblock
reopen and the following resume write when read back from disk; a valid legacy
checkpoint with the field stripped recovers only non-empty logged requests.
The substituted legacy node still re-dispatches with no criteria, logs `[]`,
and remains absent from the record. That visible cost is recorded rather than
hidden.

Each real Pi-executor attempt exposes `sparkle_report_task_result`. A valid
call writes one request-identity protocol-v1 `TASK_RESULT` with a non-empty
summary and a whole-task `PASSED` or evidence-backed `FAILED` verdict into that
attempt's transcript. `CANCELLED` is not a child claim; malformed `evd_` or
`art_` references refuse the whole call; `FAILED` requires at least one
evidence id. The first valid verdict wins, and a failed attempt's verdict does
not leak into the retry. The adapter synthesizes `UNOBSERVED` only when the
surviving attempt is silent or every report is refused. Measured reachability
has `PASSED` open all 360 swept production-input cells (minimum 0.750 over the
0.55 soft threshold) and `FAILED` hard-block all 180 swept cells with
`deterministic-fail` leading. Round 11 added optional per-criterion results to
the same tool call and protocol-v1 verification object without a protocol
version bump. When present, the criterion list is non-empty with unique ids,
and each reported `FAILED` criterion cites evidence. A reported criterion
failure reaches the hard `unmet-acceptance-criterion` gate for every role,
even when the whole-task verdict is `PASSED`. Omission, a protocol-level
`UNOBSERVED` criterion, and a task that never ran remain unknown, not unmet,
and do not trigger that gate. Round 12 commit `b8f784f` reaches the gate in
production: the node is COMPLETED while the run is BLOCKED. Retry is refused
for that completed node, no-retry `unblock` is the sanctioned exit, and
`--discard-executed` is structurally unavailable because there is no failed
retry node to name.
Round 10's producer freeze additionally proves that model-supplied
`from`/`runId`/`taskId` cannot displace the lease, an explicitly empty
`FAILED.evidenceIds` emits nothing, an identical repeat is still a forbidden
second verdict, and the tool remains an unconditional direct element of the
attempt's `tools` array.

`PrescoreInput.independentEvidence` is derived solely from that child-authored
verdict and then discarded by `computePrescore`. It is a self-report posture,
not independent corroboration. Round 10's whole-`src` dereference census allows
only that `void` discard, and `95a2b25` separately requires zero mentions in
the flowchart spine. Its 144-cell sweep shows the flag changes no score today;
giving it a reader or a new name requires a separate decision.

`GateApplyResult.runStatus` is a ledger projection, not a control input. Both
runtime planes act on the directive and events and have zero
`runStatus` readers; `applied` and `transitionId` are likewise result metadata,
not transition authority.

For a BLOCKED `run --flowchart` or `run --children`, the CLI renders the newest
recorded reason and required evidence plus exactly four routed lines:
`inspect`, `inject`, and `unblock` `next:` lines followed by a `note:` that
resume alone replays BLOCKED. Flowchart `resume` and `answer` render the same
block. The operator runs the locked
`unblock --reason <text> [--retry-node <nodeId>]` command first, then resumes
the reopened work. `unblock` appends one `RUN_UNBLOCKED` naming the exact active
block and reopens state without executing it; stale, repeated, and wrong-node
requests are refused. A BLOCKED result still exits 1.

On the gate path that recorded reason is the constant `ANALYSIS_QUEUED`, which
names the queue the block was filed under rather than the anomaly. The anomaly
is `GATE_TRANSITION.payload.reasonCode`; the failed dimensions are on the
`TRACKING_ASSESSMENT` that transition cites; an acceptance criterion the child
reported unmet is on that child's terminal `CHILD_MESSAGE`.
`src/run/inspection.ts::gateBlockCause` reads those three back off the persisted
log — pairing the newest `RUN_BLOCKED` with the transition that precedes it, and
never consulting `GateApplyResult` — and two verbs render it. `inspect --run`
prose adds `gate cause:`, plus `gate codes:`, `gate failed dimensions:` and one
`gate unmet criterion:` line per reported FAILED criterion when there are any;
`--summary-json` is unchanged, still exactly the four frozen `INSPECT_SUMMARY`
keys. The blocked report adds one trailing `note:` naming the same cause. The
`RUN_BLOCKED` payload, the gate, and the four routed lines above are untouched:
the unknown-is-not-unmet rule of `tracking/from-child.ts::unmetCriteriaOf`
applies to what is named, so an `UNOBSERVED` or absent criterion stays open.

Ordinary `RUN_UNBLOCKED` keeps exactly its three signed-off keys
(`blockedEventId`, `reason`, optional `retryNodeId`) and cannot discard
executed descendants. The stronger `--discard-executed` authorization has the
distinct exact-keyed event `RUN_UNBLOCKED_WITH_DISCARD`; it is neither a
fourth ordinary-unblock key nor a two-event sequence. The implementation
computes its required retry target and complete, canonically ordered consequence
set under the lifecycle lock. Each executed entry cites its durable route and
child-run records; charged estimates are sums over exactly the cited
`MODEL_ROUTED` rows, never best-effort invocation telemetry or invented zero
usage. The producer re-derives those sums before one append, restore recomputes
the consequence set and fails closed on mismatch, then audits the recorded
route ids, child-run ids, and charged sums against the cited log rows before
resuming. The consequence-set check deliberately precedes the charge audit.
The audit reads only cited rows, so later log growth cannot change its verdict.
Its recorded completeness limit remains: an internally consistent payload
citing only a subset of a task's routes passes; completeness is enforced by
the sole producer, `chargedAttempts`, which takes every row. Both clearing
events use the same replay/gate block matching. History and evidence survive,
superseded control-state outcomes clear, pending approval is released when its
waiter is rewound, and no budget is refunded. The authorization applies to one
block, not to the rest of the run.

> Round 15 sole docs-slot working-tree census (2026-08-25 02:15:43 UTC): HEAD
> was `3793ea4`, with a clean tree and no sibling landing in flight. Round 14's
> landings are committed: `25a3c2f` adds the scoped laundering coda at
> `replay.ts:95-101` (the mechanics at `:85-93` are unchanged) and, as a
> ride-along, retires the spent pointer in `option-a-preconditions.test.ts`;
> `a1ea5f2` is the Round 13 docs truth-up. The hazard is bounded to a node
> neither source records. A recorded node's substituted spec is restored before
> the resumed node runs, while an unvouched logged-empty is detectable as
> unknown, not the caller's known-none.
> The `:89-91` counterfactual remains motivation prose bounded by the coda, not
> a current-state bug. ADR-006 remains Proposed. This census is current at HEAD
> because no sibling is in flight. Subsequent rounds need a new census note
> only when a landing changes what these surfaces describe.

`pi-sparkle delete --episode <id>` removes both episode file shapes while
holding the operational `<id>.lock`, **and cascades into the adaptation
plane**: every feedback record bound to that episode has **both free-text
fields (`body` and `summary`) physically stripped from disk** and its id
persisted to `adaptation/feedback/tombstones.json` (the record's audit shell —
including its persisted `redactionClasses` — is kept). `readFeedback` filters
tombstoned ids at the first layer, so a lingering shell is never re-surfaced
**through that API**, and dataset exports keep listing tombstone ids without
payloads. The episode delete also **discloses residual copies it is leaving
in place**: it reports every run whose records still hold the episode's text
(`residualEpisodeTextRunIds`; the CLI prints one
`residual episode text: run <id> …` line per run with the `delete --run`
remediation). Only runs that *name* the episode are scanned; reasons are
`episode-opened` (the run log carries the `EPISODE_OPENED` snapshot),
`objective-copy` (objective/acceptance text found elsewhere in the run's
event log or `track-questions.json`), and `unreadable-log` (a corrupt line
names the episode, so the log cannot be declared clean). Run event logs are
append-only evidence and are deliberately **not rewritten**; a repeat delete
of an already-deleted episode still re-discloses the copies. The CLI fails
closed: missing/ambiguous target flags exit 1, an unknown id ("nothing
found") exits 1 rather than reporting success. The delete does not unlink or
report the lock as an episode record; normal owned lock release removes the
sidecar. An abandoned lock is not stolen, so acquisition times out and the
episode files remain for manual lock cleanup and a retry.

### Known limits of the current delete commands (2026-08-24, Round 3 audit; revised Loop 2 Round 1)

Honest gaps that remain after the Round 2 cascade, Round 3 disclosure work,
and the Loop 2 Round 1 invocation-lock fix
([Round 1](reports/2026-08-24-sota-isolation-privacy.md),
[Round 2](reports/2026-08-24-sota-r2-isolation.md),
[Round 3](reports/2026-08-24-sota-r3-isolation.md),
[Loop 2 R1](reports/2026-08-24-sota-loop2-isolation.md) reports); none of
these are covered by the claims above:

- **Episode text still physically survives inside attached runs** until each
  reported run is itself deleted. `delete --episode` now *names* those runs
  (see above) but never edits their append-only event logs. The residual scan
  covers run event logs and `track-questions.json` only — a copy quoted in
  `checkpoint.json` (flowchart snapshot) or `pause.json` (free-text reason)
  would not be reported.
- **Preferences are not cascaded — a documented non-goal, not an oversight.**
  Observations whose `evidenceEpisodeId` references a deleted episode keep
  their payload and the (now dangling) episode link; the id is not episode
  text. The three-reason rationale lives in `src/privacy/deletion.ts`, and
  the deletion suite pins that an episode delete leaves
  `adaptation/preferences.json` byte-identical. Use `pref delete` per
  observation.
- **Delete after termination remains the supported flow.** Since Loop 2
  Round 1 both writers of the shared invocation log go through the same
  cooperative lock (`src/telemetry/invocation-log.ts`): the live appender uses
  `appendInvocationRecord` and the delete's read-filter-write cycle runs
  inside `withInvocationLogLock`, so a live append lands wholly before or
  wholly after the rewrite (test-pinned, including the cannot-clobber case
  and the append-times-out-instead-of-writing-unlocked case). The run-plane
  lifecycle lock now prevents the locked M0, parent, flowchart, and supervised
  paths and their deletion from overlapping: deletion waits for teardown or
  times out having removed none of the run's own records — the rows this
  rewrite already dropped stay dropped, and are disclosed on stderr rather
  than restored. The subtree removal still verifies once
  while holding that lock and once after release. Event appends and checkpoint
  writes remain lock-free for measured end-to-end cost reasons, so a
  direct/out-of-lifecycle writer can still make deletion refuse with
  `RUN_RECORDS_SURVIVED`; a write after the final check is a new row and may
  recreate the directory after success. Invocation rows appended after their
  rewrite likewise survive. The live invocation sink retries a typed lock
  timeout with a bounded default of three attempts and then drops the telemetry
  row without failing the run, emitting one warning through its `onDrop` hook.
- **The feedback log's mirror of that race is closed under its own lock.**
  `cascadeFeedbackTombstones` and `appendFeedback` share
  `adaptation/feedback/records.jsonl.lock`, so the cascade cannot clobber a
  concurrent append. A row appended after the cascade is a new row and retains
  text until deletion is repeated. The auto-adapt persistence path uses
  `appendFeedbackWithRetry` (three attempts by default); terminal contention is
  counted and disclosed in `feedbackDropped`, `feedbackDropReasons`, and the
  result reason rather than aborting the already-completed run.
- **`model-invocation` deletion is a filter-rewrite, not an unlink.** The
  class declares `delete-files`, but the log is one global file shared by all
  runs, so a run-scoped delete rewrites it without the run's rows instead of
  removing the file. The CLI output makes this visible
  (`removed: …/invocations.jsonl (N invocation row(s))`).

Closed in Round 2 (2026-08-24, verified on-disk against a scratch state root):
the cascade previously stripped only `body` and left derived user text in
`summary`; `delete --run` previously never touched `invocations.jsonl` or
`catalog-observed.json`; episode record unlinking moved inside the cooperative
`<id>.lock` (the delete no longer hand-unlinks or reports that sidecar); and
`record-classes.ts` previously declared an unimplemented `run-event → episode`
propagation (now reconciled — `deletionPropagatesTo` is a behavioral claim).

Closed in Round 3 (2026-08-24, verified on-disk against a scratch state
root): episode deletes previously left run-log copies **silently** (now
disclosed per delete, with remediation); the preference gap previously had no
stated rationale or pin (now both); the cascade's interaction with persisted
`redactionClasses` is verified (classes survive the strip).

Closed in Loop 2 Round 1 (2026-08-24): the delete-vs-live-appender race on
`invocations.jsonl` — the appender previously wrote without the lock the
rewrite takes; both writers now share it (see the revised bullet above).

Closed in Loop 3 Round 1 (2026-08-24): the corresponding feedback append vs
episode-cascade rewrite race and the adaptation-plane transitive value-import
gap (see the revised sections above).

## Completeness audit (2026-08-22)

Every `writeFile` / `appendFile` call under `src/` was audited against the
state root. Findings and resolutions:

- **5 previously unlisted durable paths** were found and added as classes:
  `runs/<runId>/pause.json` (user free-text reason — same sensitivity class as
  episode events), `runs/<runId>/track-questions.json` (objective + contract
  text — same), `adaptation/evals/*.json` (paired aggregates only, no episode
  bodies), `learning/projects/*/bandit.json` (PASS/FAIL reward aggregates
  only, no task text), and `learning/projects/*/routing.json`
  (learned-routing-policy; model ids and avoid-list patterns only).
- `.doctor-write-probe` (doctor preflight) is written and unlinked within one
  call — transient, not durable; no class needed.
- Pause and checkpoint atomic writes use unique same-directory temp names:
  `pause.json.<pid>.<random>.tmp` and
  `checkpoint.json.<pid>.<random>.tmp`. The shared writer opens a new temp
  exclusively, fsyncs it, then renames it over the destination. A handled
  failure removes its temp; an abrupt process exit can leave a stale temp, but
  later writes generate a different name and never adopt it.
- Other rename sidecars currently below the state root are
  `providers.json.tmp`, `auth.json.tmp`, and
  `registry.json.<pid>.<random>.tmp`; they are transient and do not get their
  own durable classes.
- Operational lock files currently written below the state root are:
  - `runtime/runs/<runId>.lock`, held by M0, parent, flowchart, supervised, and
    clarification run lifecycles and shared with run deletion, pause writes,
    and track-question writes (not per-step event/checkpoint writes);
  - `runtime/invocations.jsonl.lock`, shared by invocation appends and the
    run-deletion filter rewrite;
  - `runtime/episodes/<id>.lock`, shared by CLI `episode close` and run-side
    episode settlement;
  - `runtime/auth.json.lock`, guarding credential changes;
  - `adaptation/feedback/records.jsonl.lock`, shared by feedback appends and
    the episode-deletion cascade rewrite;
  - `adaptation/preferences.json.lock`, shared by `pref correct` and
    `pref delete`;
  - `adaptation/registry.json.lock`, guarding registry changes; and
  - `adaptation/learning/projects/<stableProjectKey>/bandit.json.lock`,
    guarding each project's bandit update.
  These are transient operational sidecars, not durable record classes and not
  entries in the completeness list above.
  Normal release removes an owned lock; an abandoned lock is not stolen
  automatically and may require manual cleanup. `pi-sparkle doctor`
  recursively inventories every `*.lock` under the state root without
  acquiring, stealing, or deleting it — which is why adding the preferences
  lock needed no doctor change. Prose output and the additive
  `DoctorJsonReport.locks` field report each lock's metadata status
  (`valid`, `empty`, `invalid`, or `unreadable`), age and age source, recorded
  PID, advisory PID liveness, and a per-entry `remediation`. A recorded dead
  PID advises inspection and manual removal, never automatic removal; other
  cases remain conservative because PID liveness cannot prove staleness. The
  `lock-inventory` check also reports unreadable files and scan errors.
  Doctor additionally exposes additive `runStates`: PLANNING/RUNNING event
  logs with age, path, and inspect/resume/delete guidance. They are advisory
  crash candidates, not proof of abandonment; `run-state-inventory` fails only
  when a run-log scan fails. Command failures carrying the frozen
  `LOCK_TIMEOUT` or `RUN_RECORDS_SURVIVED` code route their `next:` line to
  `pi-sparkle doctor --json --state-root <the command's root>` and name the
  answering `locks[]` and/or `runStates[]` inventory. Routing is by code
  through a depth-bounded `cause` walk, never by message text; other failures
  retain the generic `next:`.
  Doctor also exposes frozen-additive `learnedState`: entries for every
  discovered project-key `bandit.json`, plus `preferences.json` and
  `catalog-observed.json`. Each entry carries `kind`, `stateClass`
  (`learned` or `derived`), `projectKey`, `path`, `status` (`present`,
  `absent`, `readable`, or `damaged`), and `remediation`; the inventory also
  carries `advisory` and `scanErrors`. Typed snapshot damage is advisory and
  does not fail doctor; only inventory scan/read errors fail
  `learned-state-inventory`. The frozen route map has three typed entries:
  `BANDIT_STATE_UNREADABLE` says repair or move aside to relearn the project
  from zero, `PREFERENCE_SNAPSHOT_UNREADABLE` says repair or move aside to
  start from an empty store, and `CATALOG_OBSERVED_CORRUPT` identifies derived
  state that may be deleted and rebuilt from `runtime/invocations.jsonl`. The
  catalog entry is defense-in-depth for a future command producer. No CLI
  producer exists today: doctor is the only command-path reader and absorbs
  the typed error into this inventory instead of propagating it.
- `test/**` fixture writes are outside the state root and out of scope.

## Snapshot integrity and recovery

- `runtime/routing/catalog-observed.json` is crash-atomically published. Invalid
  JSON throws `CatalogObservedCorruptError` with code
  `CATALOG_OBSERVED_CORRUPT`; it is derived from
  `runtime/invocations.jsonl`, so it can be rebuilt with
  `buildCatalogObservedFromStateRoot` plus `persistCatalogObserved`, or deleted
  to deliberately start from no observations. ENOENT is the only silent path;
  parseable shape skew still degrades to empty observed stats. Its frozen CLI
  route remains defense-in-depth; doctor absorbs this error into
  `learnedState`, and no CLI producer currently reaches the route.
- `adaptation/preferences.json` is also crash-atomically published, but it is
  learned behavior-bearing state with no source log from which to rebuild it.
  Invalid JSON or a damaged top-level snapshot shape throws
  `PreferenceSnapshotUnreadableError` with code
  `PREFERENCE_SNAPSHOT_UNREADABLE`. Persistence binds only after a successful
  load, so the unreadable file is not silently replaced by empty state. Repair
  it from a backup, or move it aside only as an explicit decision to start
  over.
  Its two writers — `pref correct` and `pref delete` — each rewrite the whole
  snapshot from the whole loaded state, so since Round 16 each holds
  `adaptation/preferences.json.lock` across load, mutation and republish, with
  the load performed inside the lock. Unsynchronized, the pair was
  last-writer-wins with no error either way, and the losing side could be the
  delete: a `pref correct` that bound before the delete's write put the
  tombstoned observation back on disk under a delete that had already reported
  success. Acquisition is bounded by `--lock-wait-ms` (default 5000, ceiling 24
  hours) and fails closed with the frozen `LOCK_TIMEOUT` code having written
  nothing; locks are never stolen. The synchronous store API in
  `src/preferences/store.ts` remains in-process-only — any new writer of this
  snapshot must take the lock over the same span. `pref list`, `pref export`
  and doctor's `readPreferenceSnapshot` are deliberately lock-free: the file is
  published by rename, so a reader sees one whole version or another.
- `adaptation/learning/projects/<stableProjectKey>/bandit.json` is learned
  state too and is crash-atomically published. ENOENT is the only silent
  absence. Empty, invalid JSON, or invalid core counters throw
  `BanditStateUnreadableError` (a `DomainValidationError`) with code
  `BANDIT_STATE_UNREADABLE`; the damaged bytes are left untouched because
  pulls and rewards cannot be recomputed. Repair the file, or explicitly move
  it aside to relearn that project from zero. A readable core with unknown
  extra keys is version skew rather than damage: it loads, and unknown keys
  are dropped at the read boundary. Under `run --children`, the automatic
  post-run wrapper reports this as `adapt skipped: …` without changing the
  run's own result; `adapt auto` and the tracked-run path propagate the typed
  error to the CLI's `stage: "validation"` failure surface.
- `runtime/runs/<runId>/checkpoint.json` remains a crash-atomic materialized
  view. `CheckpointStore.read()` returns `undefined` only for ENOENT; malformed
  JSON throws `DomainValidationError` and names the damaged checkpoint path
  instead of leaking a raw `SyntaxError` or treating damage as absence.

> Round 16 R16-1 landing census (2026-08-25 02:57:20 UTC): HEAD was `9c58b90`.
> Two changes above ship in this landing's own diff because the landing changed
> what they describe — the operational-lock list gained
> `adaptation/preferences.json.lock`, and the preference bullet in this section
> gained the writer-side locking contract. This is the landing-triggered census
> note the Round 15 terminator prescribes, not a reopened treadmill. Sibling
> slots were in flight in the working tree at the time (R16-2 on
> `src/episode/store.ts`, R16-4 on `src/cli/migrate-legacy.ts`); their file sets
> are disjoint from this one and neither touches this document, so nothing here
> is contingent on them. Everything else in this document is unchanged and
> current at `9c58b90`. Subsequent rounds need a new census note only when a
> landing changes what these surfaces describe.

The completeness guard lives in
`test/unit/privacy/record-classes.test.ts`: any durable path added to `src/`
must be added to `knownPaths` and to a record class together, or the suite
fails. Lock sidecars are not durable paths and are not listed there; the list
of them lives in the completeness audit above.

## Rules

- Raw prompts, response bodies, secrets, and hidden reasoning are excluded from
  optimization datasets. Invocations store hashes and optional usage only.
- The persisted `redacted: true` flag on a feedback record means the redaction
  pass **ran** over it (the write-path policy sets `redactPII: true`
  unconditionally), not that sensitive content was necessarily found and
  removed. Since 2026-08-24 (Round 3) the record additionally persists
  `redactionClasses`, which does distinguish the cases — three states, all
  meaningful: **`undefined`** = the row predates the field (unknown, not
  "clean"); **a list without `secret`/`path`/`oversized`** (the store's shape
  is `["pii"]`) = the pass ran and found nothing; **`secret`/`path`/
  `oversized` present** = that class was found and removed. Readers fail
  closed on an unrecognised class string and never hand back a `body` on a
  row whose classes say it was dropped (`oversized`). The feedback class
  keeps `migrationVersion: 1`: the field is optional and legacy rows stay
  valid, a compatibility choice the pending P0 re-review should ratify. The
  declared `prompt-injection` class is deliberately never emitted
  (see the rationale in `src/feedback/redaction.ts`).
- The auto-adapt kill switch (`SPARKLE_AUTO_ADAPT=0|false|off`) gates the
  **automatic post-run loop only**: with the switch off, signals are still
  collected into `adaptation/feedback/records.jsonl` (observation), but the
  `learning-bandit` file is not written and no candidate is proposed
  (verified on disk, 2026-08-24 Round 3). Explicit commands (`adapt learn`,
  preference tooling) are user intent and are not gated by it. Any value
  other than the three listed strings leaves the loop enabled.
- Missing provider usage is `undefined`, never `0`.
- Preference dataset export always lists tombstone ids and never the deleted
  payloads (`exportForDataset`).
- Closed 2026-08-21 (M3-T1/M3-T6): cross-stream references and multi-run
  attach fail closed in the episode reducer; tombstone propagation covers
  dataset exports (`exportForDataset`) and authorized exports, and
  materialized views exclude tombstoned ids. See
  `test/integration/m3/redaction.test.ts`.

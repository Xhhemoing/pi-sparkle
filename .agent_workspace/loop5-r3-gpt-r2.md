# Loop 5 Round 3 — GPT challenge of Round 2 landings

Slot: GPT-r2-challenge (`gpt-5.6-sol`). Independent review at
`cursor/pi-sparkle-sota-opt-0da8` @ `07ffa00`. Report only: no `src/` edits and
no commit.

Reviewed the landed track clarification refusal (`232a617`), `adapt
show`/`adapt dataset` (`0ba0dce`, source commit `3d9f013`), and delete
partiality honesty (`9872d93` + `390a38a`), plus the Fable same-episode design.

## Verdict

| Landing | Verdict |
|---|---|
| Track inspect + refuse-answer | **KEEP, blocking follow-up required.** It fixes the ordinary corruption path, but a missing sidecar still falls through to the exact bad append it claims to prevent. Its generated replacement command is unsafe to copy. |
| `adapt show` | **KEEP.** It closes a real operator gap without changing policy. Clarify that `--content-file` is policy-read-only, not filesystem-read-only. |
| `adapt dataset` | **SELECTIVE ROLLBACK / HOLD before merge unless fixed.** It adds a durable user-text copy with a demonstrated redaction-boundary leak, raw workspace paths, no deletion route/cascade, and an arbitrary output path that defeats the stated plane layout. It also turns tasks from one run into purported independent “episodes.” |
| Delete honesty | **KEEP, follow up.** The docs and run-lock disclosure are materially more truthful. Episode failures still hide their completed half, and one run partial-failure window escapes the new disclosure hook. |
| Fable Variant B same-episode continuation | **DEFER; do not implement the current design in Round 3.** Same-episode is the right eventual identity model, but the proposed “small branch” cannot attach with current project IDs and lacks a race-safe continuation reservation. Literal same-run-id remains rejected. |

There is no case for reverting the whole Round 2 batch. If one selective
rollback is needed, remove/disable only `adapt dataset`; retain `adapt show`,
the track guard, and the delete changes.

## 1. Track refusal: correct containment, incomplete classifier

### T1 — Missing `track-questions.json` reopens the phantom-RUNNING bug (high)

The refusal predicate is only `readTrackClarification(...).kind !== "absent"`
(`src/track/questions-file.ts:52-88`, `src/cli/main.ts:1735-1755`). But the
writer appends `RUN_WAITING_FOR_USER` before writing the sidecar
(`src/track/loop.ts:311-323`). A crash in that interval, manual loss, or partial
restore therefore produces a genuine clarification wait with no sidecar.
`answer` classifies it as an ordinary run and appends `USER_ANSWER`.

Live reproduction against the landed CLI:

```json
{"code":0,"recorded":true,"stdout":"Recorded answer for msg_...","stderr":""}
```

The existing test named “answer still records a plain question on a run with
no clarification file” protects an ordinary non-track run, but does not
distinguish it from this crash state. The fix should not require the sidecar:
before generic append, correlate the message to a persisted pending child
`QUESTION`. A non-flowchart `WAITING_FOR_USER` with no correlatable question
must refuse. A readable sidecar selects the track-specific message; a missing
or malformed sidecar selects a generic fail-closed message.

This is more robust than both current positions in the prior reports:
Round 2 GPT correctly required deleted/missing-sidecar refusal, while Fable
§6.3 said absence should fall through. Falling through is observably unsafe.

### T2 — The printed “next” command is a shell-injection/correctness hazard (high)

`trackContinuationCommand` inserts `projectRoot` and `stateRoot` unquoted and
uses `JSON.stringify` as shell quoting for the persisted objective
(`src/cli/main.ts:1051-1058`). JSON string quoting does not suppress shell
command substitution. A direct formatter probe produced:

```text
next: pnpm cli run --track --project /tmp/project; echo PROJECT_INJECTED \
  --objective "fix $(echo OBJECTIVE_INJECTED)" ... --state-root /tmp/state root
```

This is persisted user/project data presented as a copy-paste command. Do not
emit it as executable shell text. Print argument facts/placeholders, or use an
explicit platform-specific quoting layer with tests for spaces, quotes,
semicolons, `$()`, and PowerShell.

### T3 — Inspect still does not show a usable answers contract (medium)

The sidecar records full question objects, including options at runtime, but
the reader retains only `id` and `question` (`questions-file.ts:6-42`).
Inspect does not print options or the required top-level map shape. It also
says `--assume-defaults` uses “recorded defaults,” although the sidecar has no
default field and the planner proceeds with its own absent-answer behavior.

Show an inert JSON template keyed by every question id, retain/render options,
and say “planner defaults” unless explicit defaults are versioned in the
sidecar. The replacement-run guidance should also disclose that executor/model/
thinking flags are not recovered.

These defects do not justify rolling back the guard: the common path now
correctly leaves the event log byte-identical and the run waiting.

## 2. Dataset privacy and evaluation integrity

### D1 — Truncate-before-redact leaks a secret fragment at the 500-char boundary (P0)

The exporter does:

```ts
redactSensitiveText(objective.slice(0, OBJECTIVE_MAX_CHARS))
```

(`src/learning/eval-dataset.ts:115`). If truncation cuts a quoted secret before
its closing quote, neither the quoted nor unquoted keyed-secret rule matches.
Probe result:

```json
{"clippedTail":"xxxxxxxxxxxxxxx api_key=\"SUPER","redactedTail":"xxxxxxxxxxxxxxx api_key=\"SUPER","classes":[],"leakedPrefix":true}
```

Redact the complete objective first, then take a bounded excerpt of the
redacted result. Add boundary cases for keyed secrets, bearer tokens, PEM
blocks, emails, and paths. Regex redaction remains best-effort, so docs must
not imply that the remaining objective is non-sensitive.

### D2 — `originalWorkspace` is raw identifying data but omitted from the privacy declaration (P0)

Every exported task row repeats `PROJECT_DISCOVERED.project.rootPath`
unchanged (`eval-dataset.ts:117-125`). The test explicitly asserts this raw
path survives, while only checking that a home path embedded in the objective
was redacted (`eval-dataset.test.ts:196-200,244-281`). The record-class entry
calls the objective “the only user text” and lists only that field as
sensitive (`src/privacy/record-classes.ts:239-256`). That claim is false:
workspace paths commonly contain usernames, customer/repository names, and
organization layout.

Either avoid persisting the path (for example, bind isolation metadata
separately under controlled state), or classify and protect it as sensitive.
At minimum store it once per manifest rather than once per task.

### D3 — The new durable copy has no deletion workflow (P0)

The default record lives at
`adaptation/eval-datasets/<runId>/manifest.json`, but neither run nor episode
deletion reaches it; `src/privacy/deletion.ts` and doctor contain no
`eval-datasets` handling. There is also no `adapt dataset delete` command.
The class says `delete-files` and `until-deleted`, but the supported operator
tooling cannot perform that deletion. Deleting the source run therefore leaves
its objective excerpt and raw workspace path indefinitely.

For the default path, `delete --run` should remove the derived dataset or
explicitly enumerate it as a surviving sensitive derivative with a supported
remedy. Custom exports need an explicit external-export warning and a deletion
story; an arbitrary path cannot be rediscovered later.

### D4 — `--dir` defeats the “records can never be co-located” plane guarantee (high)

The isolation check only rejects lexical overlap with the recorded project
workspace (`eval-dataset.ts:135-137,197-204`). It accepts a path under
`<stateRoot>/runtime/`, so an adaptation dataset can be written into the
runtime plane despite `state-layout.ts` and the data dictionary saying the two
record classes cannot be co-located. The lexical `path.resolve` guard also
does not resolve symlinks.

Keep default writes under `adaptation/`. If external export remains, reject
the runtime state tree and use realpath-aware containment checks. The output
contains sensitive text and should be written with an explicit restrictive
mode rather than relying on the process umask.

### D5 — One run’s tasks are mislabeled as independent episodes; no holdout is enforced (high)

`episodeHash` is actually `hash(runId, taskId)`, so five tasks from one run
become five `rawCounts.episodes` and clear the comparison layer’s
`minPairedSamples: 5`. The source `runId` is present, but no real episode id is
exported. This is pseudo-replication, not five independent episodes.

The advertised workflow also permits:

```text
run produces feedback -> candidate is proposed from that feedback
-> adapt dataset --run the-same-run
-> adapt eval candidate on that dataset
```

No candidate provenance records which runs/episodes proposed it, so the tool
cannot enforce the repository’s own rule: “Avoid training and validating on
the same episodes” (`docs/specs/adaptive-agent-work-loop.md:536`).

Further, replay assigns the observed PASS/FAIL utility equally to baseline and
candidate (`eval-routing.ts:389-410`); it does not observe the candidate model’s
counterfactual outcome. This can be a useful routing/cost replay fixture, but
it is not independent validation evidence. Export actual episode identity,
count/split by episode, record candidate source provenance, and refuse overlap.

The privacy and evidence defects together are why `adapt dataset` is the one
Round 2 surface that should be held or selectively rolled back. `adapt show`
does not share them.

## 3. Delete honesty: improved, with two remaining hidden partials

### X1 — Episode lock failure still hides the already-completed cascade

`deleteEpisodeRecords` strips feedback and writes tombstones before taking the
episode lock. If that lock times out, `deleteCommand` receives no
`DeletionResult`; unlike the run branch, it has no `disclosePartial` hook
(`src/cli/main.ts:2059-2069`). Help/docs now describe the partiality, but the
operator looking at the failed command sees only `LOCK_TIMEOUT` and the doctor
route, not which feedback ids were tombstoned.

Add the same failure-path disclosure for episode deletion, including ids/count
and the fact that episode files remain.

### X2 — A failure invalidating `catalog-observed.json` escapes run disclosure

`deleteRunRecords` awaits `dropRunFromInvocationLog` before entering its
`try/catch` (`deletion.ts:321-349`). Inside that helper the invocation rewrite
can succeed and then `invalidateCatalogObserved` can throw
(`deletion.ts:854-880`). In that window rows are already dropped, but the helper
never returns an `InvocationRewrite`, so the new disclosure hook is never
called. A malformed filesystem shape such as `catalog-observed.json` being a
directory is one concrete trigger.

Move the catch boundary around the whole mutation or split “rows dropped”
from snapshot invalidation so the partial state remains available to the
reporter.

The usage text should also distinguish a timeout on the first invocation-log
lock (no telemetry half completed) from a later timeout on the run lock
(telemetry half completed). These are follow-ups, not rollback reasons: the
new lock-option propagation, run-lock disclosure, and corrected docs all move
the contract in the right direction.

## 4. Same-episode continuation: later, after redesign

Fable’s middle choice is directionally right: one episode may contain a
clarification run and an execution run, while literal same-run-id continuation
would disturb the most fragile flowchart/checkpoint machinery. But Variant B
is not ready to implement as specified.

1. **Project identity makes the proposed attach fail.** The clarification
   episode stores the first discovery’s generated `projectId`.
   `startFlowchartRun` performs a fresh `discoverProject`, generating a new
   `projectId` (`flowchart-run.ts:1358-1369`), then would call `attachRun` with
   it. `attachRun` rejects any id unequal to the episode’s project id
   (`episode/manager.ts:50-60`). Passing only `existingEpisodeId` is therefore
   not a ~15-line branch; the design needs an explicit stable-project/snapshot
   policy.
2. **`USER_ANSWER` is not clarification-neutral.** The learning signal reader
   classifies any answer containing `yes`/`no`/approval words as
   `userAcceptance` (`learning/signals.ts:44-62,175-192`). Fable’s canonical
   clarification JSON will commonly contain `"q-tests":"yes"` and can become
   false acceptance if the old run is learned from. A marker inside the answer
   string is useless unless the signal reader recognizes and excludes it.
3. **Double continuation is not prevented.** Phase 1 releases the old-run lock
   before phase 2. A second command can observe “completed answer, no episode
   successor” while the first command is between those phases, and both can
   create successors. A read/check is not a reservation; check-and-attach must
   be serialized under the episode lock with durable idempotency state.
4. **`RUN_COMPLETED` overstates the old run.** Its durable objective is the
   user’s requested work, not “produce a clarification contract.” Marking it
   completed before any execution successor exists makes `list` hide a
   “completed” run whose objective was not delivered. The terminal meaning
   needs an explicit decision rather than an empty-payload convenience.
5. **The plane classifier prerequisite is still broken** by T1, and the
   proposed sidecar schema does not version explicit defaults.

Recommendation:

- Keep refuse + replacement-run guidance as containment after fixing T1-T3.
- Defer same-episode implementation until a revised design specifies stable
  project identity, an episode-locked continuation reservation/idempotency
  protocol, clarification-aware learning semantics, and an honest old-run
  terminal.
- Continue to reject literal same-run-id continuation.

This is a sequencing correction to `docs/agent-progress.md`’s “Round 3
implements” expectation: same-episode should remain design-only in this round.

## 5. Verification

- Focused landed suites:
  `track-clarification`, `eval-dataset`, privacy deletion unit, and delete CLI
  integration — **77/77 pass**.
- Independent negative probes:
  - missing clarification sidecar -> `answer` exit 0 + `USER_ANSWER` recorded;
  - truncation-boundary quoted secret -> fragment survives, no redaction class;
  - generated continuation text -> unquoted project/state paths and active
    `$(...)` objective syntax.
- Environment warning only: host Node `22.14.0` is below package engine
  `>=22.19.0`; all focused suites passed.

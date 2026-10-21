# Active implementation plan

## Follow-up: interpret and replicate the Soul comparison (2026-10-21)

Owner: coordinating agent. The user requested durable interpretation plus further verification/analysis. [PR #64](https://github.com/Xhhemoing/pi-sparkle/pull/64) contains the first corrected pair and its raw-metric reconciliation; head `9d17bcca` passed quality and Ubuntu/Windows CI (4,064 pass, 0 fail, 2 skip). PR #63 is merged; #64 remains open.

Interpretation before replication: both paths produced a usable helper, but only direct Pi completed the first corrected run's functional acceptance within 300 seconds (88.3 seconds versus native cancellation at 300.2 seconds). Native tokens are lower bounds because the interrupted request has no final usage. Direct required later formatting; native required later acceptance takeover. This supports a bounded workflow-completion concern, not a universal speed/cost/product ranking. The 69.7-second compilation overlap, one task and provider/cache variability prevent a causal speed claim. No production Soul defect, full race coverage or overall readiness was established.

Pre-registered follow-up, before execution:

- Question: does the same native cancellation recur when host integration compilation is absent during both arms, and where does recorded elapsed time accumulate?
- Run exactly one additional pair, native then direct, from the same clean `4f53b8f5` input and unchanged objective/checker/model/tools/300-second budget. Fresh sessions/candidates; no prior implementations or corrective hints. No integration builds or other task-controlled model runs during either arm. Retain failures; do not retry to obtain success. Provider cache remains uncontrolled.
- Add timestamp-only host observations for model events/tool completion; do not alter runtime prompts, acceptance, timeout or source code. Analyze the earlier timeline independently. Do not infer provider thinking/network timing from end events alone.
- After both arms finish, run the existing seven-case host check where necessary, real-target offline compilation and formatting checks serially; independently review candidate changes. Separate measured outcomes from rescue work. No automatic application or host semantic repair.
- Record a small result/decision summary here and exact metrics/commands in PR #64; local artifacts under `.agent_workspace/soul-comparison/replication/`. Update the existing checklist and generated STATUS, without adding reports/gates or runtime functionality.
- Acceptance: report both attempts, complete versus lower-bound usage, in-run and post-run interventions, actual stage observations, replica limitations, original-Soul write count and a defensible next action. Keep the 15-task evaluation deferred and P4/P5 frozen. Original Soul remains outside the write/apply/publish scope.

### Follow-up result and decision

The single pre-registered replication is complete. No task-controlled integration compilation overlapped either arm; runtime, objective, checker and source input were unchanged. Both arms passed the seven-case functional check inside budget, and both later passed offline real-target compilation and rustfmt.

| Observed run | Direct Pi | pi-sparkle |
| --- | --- | --- |
| First corrected pair | 88.3s, functional pass | 300.2s, cancelled; later host check passed |
| Replication, reversed order | 72.6s, functional pass | 97.8s, COMPLETED with independent acceptance |
| Replication input / cache-read / output tokens | 13,441 / 58,240 / 3,476 | 21,536 / 183,680 / 3,417 |
| Replication tools / in-run operator interventions | 7 / 0 | 15 / 0 |
| Replication independent review | One cleanup race regression, not repaired | No blocking finding in selected scope |

Independent review found that the second direct candidate permanently treats kill failure as cleanup failure even after successful reap, contrary to the original race-tolerant behavior. A post-hoc deterministic fault probe includes unchanged candidate modules with injected process types: original and native accept kill-error then successful-reap; direct rejects it. Four probe cases pass and the direct case fails. This validates the branch behavior, not occurrence/frequency of a real OS race. Neither measured candidate was edited. Thus functional completion is not final acceptance; direct has one pending correction, not a silently successful result.

Earlier native timing: about 3.2s preparation, about 1s expected missing-module check, successful file tools, then long agent/model-stage intervals; final tool to cancellation was 63.4s. No evidence of repeated real tool failures or rejected completion reports. The replication disproves inevitability of the timeout; it does not identify provider/network/context/CPU contributions. Native event timestamps can reflect buffered delivery, not HTTP request duration. Token details reconcile with invocation totals; never add both representations. Monetary rates remain unknown.

Decision: keep P4/P5 frozen; do not raise timeouts or redesign runtime based on this single task. Direct Pi showed less elapsed time/context usage here, but its review defect prevents a quality-superiority claim. Native completed the repeat with more context/tool activity; added workflow cost still needs demonstrated benefit on independent tasks. This bounded replication is finished; the broader 15-task campaign remains deferred. If a retained Soul patch is adopted later, resolve the reported defect and include the new edge case before application. Original Soul received zero task writes; raw results and the unchanged candidates remain local under `.agent_workspace/soul-comparison/replication/`. Exact commands, failed probe, review and current hosted CI belong in [PR #64](https://github.com/Xhhemoing/pi-sparkle/pull/64).

## Current work: matched Soul development comparison (2026-10-21)

Owner: coordinating agent. The user explicitly authorized review/merge of PR #63 and a direct-Pi versus pi-sparkle development comparison in disposable Soul copies. PR #63 was independently reviewed with no remaining blocker and merged as `c40e0607`; candidate `e053eb66` had all three hosted checks green (4,064 pass / 0 fail / 2 skip). Original Soul remains outside the write/apply/publish scope. The comparison PR's verification section owns current execution outcomes, failures, usage and review; the protocol below does not itself claim a successful outcome.

Pre-run question: for one real bounded development task, does the existing pi-sparkle native candidate workflow improve accepted completion or reduce measured execution time/tokens/operator intervention versus a direct Pi coding-agent SDK session? This is one exploratory paired sample, not the deferred 15-task evaluation or statistical evidence of general benefit.

- Task eligibility/evidence: Soul's current `docs/design/2026-10-20-research-experiment.md` save-cancel supplement explicitly leaves the independent reader's success/timeout branches unexecuted. Refactor that actual test helper into shared standard-library Rust support, reconnect the original caller, and exercise normal/nonzero exit, timeout/reaping and bounded stdout. Do not claim a discovered production defect or complete cancellation/publication-race coverage.
- Input: selected current Soul source including relevant dirty files, root workspace manifests/lockfile, schemas and three required synthetic fixtures; no database, credentials, desktop state or original target copy. Local disposable input snapshot `4f53b8f5` is prepared solely for this authorized trial. Workers may modify only `crates/soulcore/tests/research_save_cancel_probe.rs` and `crates/soulcore/tests/research_reader_support/mod.rs`.
- Matched conditions: existing configured provider/model and thinking level, fresh sessions from identical input, same restricted file tools and host test command, no shell/network tools, one initial candidate per arm, provider retry disabled, 300-second cooperative deadline per arm, starting before worktree/session preparation and including verification; cleanup tails are recorded separately. The initial random order was pi-sparkle then direct Pi. That pair was invalid for effect comparison: native execution exposed its inner 300-second limit, and direct SDK authentication failed before a model request. Both records are retained. After correcting only host authentication/deadline setup, a fresh pair from the same input reverses the order (direct Pi then pi-sparkle); no candidate implementation or hints are reused. Pi means direct `createAgentSession` from the installed coding-agent SDK with matched restricted tools; this is not an unrestricted interactive CLI comparison. Native role/completion prompts differ as part of the workflow.
- Acceptance: original diagnostic behavior and 120-second run / 5-second cleanup / 64-KiB stdout defaults preserved; host-owned synthetic process tests pass against the actual shared module; the real integration target compiles offline; independent review finds no remaining defect. A missing-module precheck is expected before this refactor, not a production bug. No original Soul writes or candidate application.
- Measurement: record elapsed time from per-arm worktree/session preparation through final host check, provider-reported input/output/cache usage when available, test calls, tool failures, operator prompts/code edits/restarts, and any post-run review/rework separately. Keep timeouts and failed runs in the denominator. Shared setup, Cargo warm-up and independent review are separately identified, never silently charged to one arm. Unknown token/cost values are not zero.
- Verification: host Rust process tests via an external Python driver, `cargo test -p soulcore --test research_save_cancel_probe --locked --offline --no-run --target-dir <isolated target>` serially, targeted format/review, and byte comparison of copied input against original source at handoff. Original Soul may change concurrently; distinguish external changes from our writes. Local raw artifacts stay in `.agent_workspace/soul-comparison/`; only sanitized scope/results belong in the follow-up PR and this plan.

P4/P5 and new runtime features remain frozen. The prior pilot below is historical evidence only; its already-known task is excluded from this comparison.

## Historical scope: documentation cleanup and first pilot (2026-10-21)

Owner: coordinating agent. State: local cleanup and bounded Soul pilot verified; current delivery/CI is recorded in PR #63. The owner requested deletion of completed low-value documentation, simpler project management, then actual pi-sparkle-assisted development of Soul's test version. Soul replaces AIstudy as the immediate pilot; the broader 15-task comparison is deferred, not completed. Package publication remains private.

## Completed integration

[PR #61](https://github.com/Xhhemoing/pi-sparkle/pull/61) and [PR #62](https://github.com/Xhhemoing/pi-sparkle/pull/62) are merged; #60 is superseded and main is protected. PR #62 records the owner's one-time authorization for independent agent conflict review. Main `3058626e` has the same tree as tested head `0bde5984`. [Candidate CI](https://github.com/Xhhemoing/pi-sparkle/actions/runs/39616470517): 4,064 pass / 0 fail / 2 skip; seven successful hosted jobs across workflows, including Ubuntu/Windows smoke. A separate post-merge CI run is not claimed.

## Problem, scope and non-goals

- Delete completed repetitive optimization-round documents; preserve implementation evidence, safety decisions, exclusions and unfinished obligations. Git retains deleted material; surviving links must resolve to published history.
- Maintain one current plan, an open-only checklist of at most 25 lines, and generated STATUS. Update entry points; no new report, gate or framework.
- Trial a bounded task against an isolated source copy of Soul's current research/test version, including relevant uncommitted source. Original `E:/Project/Soul` stays untouched. Never read/copy real databases, chat exports, credentials, ignored caches or installed app data.
- Initial task: extend the standalone research archive reader's CLI rejection tests for missing/directory paths, wrong argument counts and invalid UTF-8 ZIP members. Synthetic ZIPs and Python standard library only. Change production behavior only after a failing regression demonstrates a defect.
- Use the existing pi-sparkle coordinator/executor for real-model read-only assistance and, after the owner authorized one local input snapshot, a native candidate-development replay. Record failures, elapsed time, usage and interventions; unknown cost is not zero. This known task does not establish comparative benefit.
- Only the disposable input slice may receive the explicitly authorized local snapshot commit. No original Soul commit/push/merge, install, collection, real-data experiment or publication. P4/P5, new experiments/adaptation/learning features and hotspot splitting stay frozen until an explicit owner decision based on comparative evidence; this pilot does not unfreeze them. Existing safety maintenance remains allowed.

## Acceptance and implementation

| Work | Files / owner | Acceptance |
|---|---|---|
| Documentation pruning | `docs/reports/sota-opt/round-08` through `round-39` and surviving references; delegated writer | 352 repetitive documents removed; rounds 1–7, exclusions and unfinished round 40 retained; historical links resolve |
| Project management | AGENTS, README, task entry points, workflow, archive index, generated STATUS; coordinator | Current facts agree; todo within 25 lines; prior unresolved obligations remain linked |
| Soul pilot | Isolated test source and retained candidate only; coordinator and pi worker | Privacy-safe CLI rejection tests and existing seven tests pass; original Soul unchanged; actual result and limits recorded |

## Verification and delivery

Delivery: [cleanup PR #63](https://github.com/Xhhemoing/pi-sparkle/pull/63); its verification section owns current hosted CI and the eventual pilot result. No automatic merge.

Documentation needs no failing test. Run `pnpm workflow:check`, `git diff --check` and changed-link checks. No runtime change is planned. The read-only pilot exposes only two copied files. The native replay restricts writes to the assigned test file in a disposable candidate worktree and exposes no shell; the host owns independent verification. One local input snapshot was explicitly authorized; source application remains outside this trial. Review deletion/reference handling and candidate diff independently. Logs and temporary scripts remain in pi-sparkle `.agent_workspace/`, outside Soul.

Cleanup is published in PR #63; do not merge automatically. Removed 352 redundant reports (271,929 lines, 18,121,043 bytes). Independent review confirmed retained obligations/history targets; its freeze-wording finding was fixed. Workflow/diff checks and 226 changed-file local links passed before final handoff text; current checks/results belong in the PR.

## Soul pilot result and limits

A narrow local slice copied the current reader/tests and instructions from Soul HEAD `6a56d852` plus its untracked research-reader files. This is not a whole application snapshot. Original seven tests passed. The selected existing model performed read-only review through pi-sparkle, identifying seven missing CLI rejection cases and incomplete mutation assertions. The coordinator added four test methods and one helper only in the test copy; original seven tests and production reader remain unchanged.

Verification: candidate `python -B -m unittest discover -s scripts/tests -p test_research_retention_reader.py` passed 11/11; the external host verifier also passed seven rejection cases. Independent read-only review found no defect and separately reran 11/11. The pre-addition verifier failed for missing test methods, a coverage gap, not a demonstrated production bug. The two original Soul files still match the untouched input copy byte-for-byte. No original Soul commit, push, application, install, real data or collection occurred.

Four real runtime runs were retained: timeout, completed but review text not captured by the first host adapter, timeout, then a completed captured review. Runtime durations total 81,761 ms, excluding setup/coordinator work/review. Successful runs report 6,601 input / 2,244 output tokens; both timeouts have unknown usage. USD cost remains unknown. Enabling existing process-level proxy handling allowed a successful run but did not eliminate the later timeout; no proven single root cause is claimed. The host captures TEXT_DELTA and TASK_RESULT for usable findings; coordinator event summaries alone were insufficient. No runtime or global configuration was changed.

The owner subsequently authorized one local snapshot in the disposable input slice: `49d0e518177b14861c9639472259018da048ec59`. A native candidate-development replay uses that same input; the already-known task is a workflow test, not a blind or comparative evaluation. The first native run was rejected by the host because Git converted the untouched reader from LF to CRLF (147 line endings); its content otherwise matched exactly and Git showed only the assigned test file changed. Only the temporary input repository's `core.autocrlf` was set to false before retry; the strict byte comparison remains in place. The second native run completed with host acceptance: 11/11 tests plus seven independent CLI rejection cases passed, the production reader matched byte-for-byte, and only the assigned test file changed (+66 lines). Native runtime durations were 77,244 ms (rejected) and 53,961 ms (accepted), with 35,607 input / 5,083 output tokens across both; cost is unknown. These runs required a host configuration correction and are not an unattended success-rate estimate. Detailed verification is in PR #63. No candidate was applied to original Soul.

The retained candidates, patch and raw run records are local under this worktree's `.agent_workspace/soul-pilot/`; Soul source/transcripts are not committed or uploaded to GitHub. Selected copied source was sent to the authorized model provider for the trial. No full Soul validation or direct-Pi A/B was run. Next: use PR #63 for current CI/merge review; the owner may inspect the local patch, then choose whether to expand a comparable real-task sample.
## Retained obligations

[Previous plan](archive/2026-10-21-pre-integration-plan.md) and [previous checklist](archive/2026-10-21-pre-integration-checklist.md) preserve F6 custody/holdout, S0-min, R10/R11, PR #36 artifacts, privacy, containment and production conditions. [Status matrix](../docs/status-matrix.md) retains scoped claims. This pilot does not close these or the deferred 15-task comparison. Repetitive SOTA rounds remain retired; unfinished historical items do not authorize restarting scans.

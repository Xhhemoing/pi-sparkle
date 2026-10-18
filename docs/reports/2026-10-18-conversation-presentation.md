# Conversation/presentation implementation evidence — 2026-10-18

- Task: `TASK-20261018-conversation-presentation`; [plan](../superpowers/plans/2026-10-18-conversation-presentation.md).
- Baseline: local `541868a5377d8ee3bda2e6c7eac1582de4e68cd1`; remote PR #60 `2a3dd47043efdb53dacff5e3f2c08feb79427958`, confirmed by current connector metadata.
- State: bounded source independently reviewed and local full gate verified; external publication remains blocked. No model-benefit/production claim.
- Linux / Node 24.19.0 / genuine pnpm 10.17.1; existing frozen dependency/build policy retained.
- Owners: conversation builder / presentation builder (file-disjoint); root integration; source-disjoint reviewer.

## Publication boundary

The user's “执行计划” continues local implementation. The connected GitHub
create-tree upload of the prior 22 reviewed files was attempted again, and
automatic approval review rejected it, explicitly stating that this general
instruction did not approve that exact payload and destination. No remote tree,
commit, branch ref or PR description was updated. No alternate transport/upload
was used. Explicit approval to upload the reviewed payload to
`Xhhemoing/pi-sparkle`, existing PR #60 branch
`codex/architecture-agent-loop-20261015`, remains the unblock condition.

The first publication-preparation command exceeded the tool text-output budget,
so its JSON could not be parsed; it made no API call. Independent per-file reads
then prepared the exact Git contents successfully before the above rejection.
These preparation failures are not runtime/test failures or behavioral evidence.

## Scope and current checks

C1/C2-A supplies an experimental structured host facade: known host bindings,
read-only project facts, existing direct-task execution, focus references and
in-memory generation/CAS/deduplication. It adds no shell/parser/model call,
automatic apply/accept/queue continuation or durable task success authority.

M4-A supplies explicit user/project/task presentation snapshots only. Language,
detail and format can change a cloned profile's reporting instructions; task
objective, checker, acceptance, tools, execution limits and global preference
storage remain separate.

Actual RED/GREEN, independent review and full gate results will be appended after
commands finish. Cross-session focus, complete natural-language tool registration,
M1 CodeMap, #60/#61/main integration and existing production/learning gates remain
open.

## M4-A implementation and focused checks

Implemented pure `snapshotTaskPresentation`, `prepareTaskPresentation` and
`formatTaskPresentation` plus optional native/direct `presentation` input.
Own-data validation precedes async work and input spreads. Scope/value snapshots
are copied/frozen, language canonicalized with a 64-character BCP47 bound, and
detail/format drawn from fixed enums. The cloned profile adds fixed reporting
instructions only. No overlay returns the prior profile unchanged; prompt tests
normalize only each actual ephemeral candidate path between separate runs.

| Command / phase | Actual result |
|---|---|
| Initial new presentation unit/integration RED | 1 pass / 7 fail: absent module, native prompt lacked presentation, malformed input was accepted |
| First focused implementation GREEN | 14 pass / 0 fail / 0 skip |
| Direct wrapper accessor/inherited RED | 1 fail: both direct calls fulfilled instead of rejecting because rest destructuring evaluated/dropped presentation fields |
| Root wrapper fix + 3-suite focused check | 22 pass / 0 fail / 0 skip; `.agent_workspace/presentation-wrapper-green.log` |
| Final presentation/native adjacent group | 46 pass / 0 fail / 0 skip; command below |
| Changed-file ESLint and diff check | PASS |

Root fixed `startDevelopmentTask` before destructuring: reject accessor/inherited
presentation, capture the pure snapshot, exclude original presentation and pass
only the captured data. The regression asserts zero getter/factory calls and
zero candidate allocation. The integration group also covers per-field
precedence, concurrent tasks, call-time mutation across same-candidate repair,
no later-task leakage, adaptation disabled, unchanged preference/tombstone bytes
and unsuccessful host checks remaining unaccepted.

```sh
node scripts/run-tests.mjs --test-concurrency=1 test/unit/preferences/task-presentation.test.ts test/integration/development/task-presentation.test.ts test/integration/development/start-task.test.ts test/integration/native/write-session.test.ts test/integration/native/write-loop.test.ts test/unit/native/write-loop.test.ts
```

An early typecheck found only not-yet-created conversation module imports and
resulting implicit types; it is not final typecheck evidence. Initial test fixture
prompt comparison was corrected to account for the actual candidate path changing
between independent runs; no task authority or source assertion was removed.

## C1/C2-A implementation and focused checks

New experimental deep modules: `conversation/focus` and `conversation/session`.
The facade snapshots known host project/task bindings before work; request data
can only choose registered references and the closed operation vocabulary.
Frozen task snapshots retain genuine trusted-verifier capability and factory
identity while copying argv/criteria/presentation. Query binds the actual
`status` method and never calls `next` or a task selector.

Focus is a generation/revision pointer and optional one-level suspended mainline,
not a second completion store. Real returned run references attach only to the
captured current focus; stale results retain their actual result and disclose
`staleFocus`. Direct request IDs and message references are consumed before the
first await, bounded without eviction (128 default / 1024 hard maximum). One
active direct call remains reserved through the existing shutdown. Thrown
execution and returned unsettled effects fence further dispatch, with read-only
queries still available. Host must reconcile underlying facts before starting a
new session; new session creation is not an effect-replay permission.

| Command / phase | Actual result |
|---|---|
| Initial C1/focus RED | 2 module-missing failures after new tests were written |
| First focused GREEN | 12 pass / 0 fail / 0 skip |
| Strict-null reviewer regression RED | 3 failures: null args/tasks/maxRequests were silently defaulted |
| Final focus/session focused | 17 pass / 0 fail / 0 skip, including delayed actual status and unsettled checker effect |
| Adjacent four-suite group before final coverage additions | 35 pass / 0 fail / 0 skip |
| TypeScript, owned ESLint and diff check | PASS |

```sh
node scripts/run-tests.mjs --test-concurrency=1 test/unit/conversation/focus.test.ts test/integration/conversation/session.test.ts
```

Real-Git tests verify byte-identical status/question behavior, retained candidate
with untouched source, duplicate and conflicting provenance refusal, unknown
references/extra authority fields/stale tokens, caller mutation and genuine
trusted capability identity, capacity without eviction, and cancellation waiting
for actual worker completion. Delayed status and direct results cannot overwrite
a switched focus. A real host checker `exit(3)` registered as unsettled returns
`effectsSettled:false`; a fresh request for a different focused task is then
refused, worker count stays one, retained evidence remains readable and status
still works.

## Frozen combined source and independent review

Source/test checkpoint: `294375722fa6058b865f1c30df510e20573aa5b8`, tree
`537960739be22eb0cf6c747bff6c9c134283a2a6`. Review base: local `541868a`.
The source-disjoint `review_tools` reviewer returned **PASS**, no remaining
blocking finding, after inspecting the final runtime/tests and usage API.

Independent actual command on this checkpoint:

```sh
node scripts/run-tests.mjs --test-concurrency=1 test/unit/conversation/focus.test.ts test/integration/conversation/session.test.ts test/unit/preferences/task-presentation.test.ts test/integration/development/task-presentation.test.ts test/integration/development/start-task.test.ts test/integration/native/write-session.test.ts test/integration/native/write-loop.test.ts test/unit/native/write-loop.test.ts
```

**63 pass / 0 fail / 0 skip**, 20.07 seconds. Independent
`git diff --check 541868a5377d8ee3bda2e6c7eac1582de4e68cd1 294375722fa6058b865f1c30df510e20573aa5b8`
PASS; clean worktree at the reviewed checkpoint. Reviewer confirmed host binding
snapshots, no-effect status queries, stale-result containment, non-evicting replay
bounds, cancellation/unsettled fences, presentation isolation and wrapper getter
refusal. Review was Linux / Node 24.19.0, not an independent full gate/probe,
Windows/live-provider run, human/policy approval or cross-session acceptance.

Final integrated gate PASS; post-build results follow below. Closeout changes
are restricted to documentation, with source/test/package/CI identity checked
against this checkpoint before delivery.


## Final integrated gate

```sh
PATH="$PWD/.agent_workspace/tooling/bin:$PATH" taskset -c 0 pnpm gate
```

PASS, exit 0: workflow, TypeScript, lint, **3,691 total / 3,689 pass / 0 fail /
2 skip**, then build. Test duration 353067.24297 ms; complete current log is
`.agent_workspace/conversation-presentation-gate.log`. The two conditional skips
are real-provider opt-in and the Windows-only raw executable-tree comparison on
Linux. They are not passes, live-provider qualification or Windows verification.
Node 24.19.0 / genuine pnpm 10.17.1 / inherited one-CPU serial execution;
package/lockfile/dependency build permissions were not modified.

A changed Markdown scan checked 359 local links with no missing file before final
closeout. Final workflow, diff, link and exact reviewed-source checks are recorded
below; the former gate's 3,657 passes are historical M1-B evidence, not this new
source's result.

## Final probes and delivery

| Command | Actual result |
|---|---|
| Pinned `pnpm security:probe` | PASS, status ok / 26 checks / zero open or waived findings / no refused waivers |
| Pinned `pnpm pi:probe` | PASS, 4 pin/import checks |
| Pinned `pnpm kernel-reuse:probe` | PASS, 3 stream/facade/steer checks |
| `node .agent_workspace/conversation-built-smoke.mjs` | PASS, built module imports, focus/question/unsupported request behavior and scoped presentation; zero worker/provider calls |

Post-build logs: `.agent_workspace/conversation-security.log`,
`.agent_workspace/conversation-pi.log`, `.agent_workspace/conversation-kernel.log`.
Temporary built smoke imports the emitted modules, not TypeScript source. It is
an internal deep-import probe, not packaged external SDK or live conversation
benefit qualification.

All runtime/test/package/CI bytes remain equal to reviewed checkpoint `2943757`;
final closeout is documentation only. The exact current branch/ref and complete
34-file change set against remote PR #60 baseline `2a3dd470` are supplied in
`.agent_workspace/pi-sparkle-upload-manifest.txt` and
`.agent_workspace/pi-sparkle-plan-execution.patch` for review. This includes the
prior M1-B tools and this session's C1/C2-A/M4-A work, not just a partial new diff.

Automatic approval rejected the attempted *previous 22-file* upload, explicitly
ruling that the user's general “执行计划” was insufficient exact-payload/target
consent. The expanded 34-file delivery has not been uploaded or retried via any
alternate transport. Remote PR #60 remains `2a3dd470` at the last actual read;
main and PR #61 were untouched. Required next authorization is explicit approval
for these reviewed 34 files to `Xhhemoing/pi-sparkle`, existing PR #60 branch
`codex/architecture-agent-loop-20261015`. After approval, refresh the remote head,
reconcile any new changes, publish with an expected-head non-forced update,
read back the exact tree and report fresh hosted CI separately. Existing CI does
not verify this local source.

Next implementation: M1 task-local CodeMap input/selection and natural-language
host/extension integration, followed by fact-bound cross-session recovery. Retain
current single-writer/unknown-effect guards; persistent focus or recovery must
re-read actual task/run/candidate facts, not turn these pointers into a competing
completion database. Remaining M0/platform, main/#61 integration, managed Pi/SDK,
shared strict budgets, S0-min/R10/R11/F6/F-PROD and measured policy improvement
remain outside this accepted bounded source slice.

Final documentation checks PASS: pinned `pnpm workflow:check`, `git diff --check`,
exact reviewed source/test/package/CI equality, and 363 local Markdown links with
zero missing files. No additional runtime or test edits followed the frozen
source review/full gate.

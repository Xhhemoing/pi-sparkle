# Status matrix (Developer Preview)

## Phase 0 adopted; Phase 1 in progress (2026-10-24)

The owner authorized [PR #77](https://github.com/Xhhemoing/pi-sparkle/pull/77) and it merged as `2f87ca313fdf372897bc0119116f0accabb9ff3e`, with contents equal to verified candidate `9e8ff23a`. Its complete local validation, built-package checks and hosted compatibility checks passed; merged-main CI and recovery checks also passed. Earlier failed and reboot-interrupted Windows runs remain retained in the PR evidence. Phase 0 is complete; the whole v1.2 plan is not.

[Draft PR #78](https://github.com/Xhhemoing/pi-sparkle/pull/78) implements a shared literal write/protect policy for Controller and direct task entry, including committed out-of-scope changes and raw protected bytes. Candidate `2fe99acb` has five applicable green hosted jobs and completed its pinned local Windows gate, security and Pi probes successfully on 2026-10-24. The subsequent fixed host check plan and visible-only repair feedback have passed focused execution, independent review and all seven applicable hosted jobs at `b6fc7a7f`. Their complete local acceptance is combined with the next TaskSpec candidate; earlier candidate results do not validate later changes.

The experimental TaskSpec path parses strict JSON, enforces shared write/protect and required checker inputs, and runs actual zero-model preparation/base checks before bounded repair on the same isolated candidate. One total deadline never renews; optional worker/check pools charge actual elapsed time across attempts. Standalone preflight retains unsettled candidates and otherwise confirms disposal. Hidden diagnostics remain private, and historical acceptance does not apply a candidate. See [TaskSpec](taskspec.md) for supported inputs and limits.

Pushed candidate c2e47b26 has all nine hosted jobs green. Both full Linux Pi 1.2/1.4 lanes report 4553 passed / 7 conditional skips / no failure or cancellation; logs confirm real Rust linking, poisoned-output rejection, missing-cc refusal and cumulative TaskSpec cases. Earlier 01e5d3f6/a67e4c81 Rust failures remain retained; the diagnostic run identified missing linker lookup, corrected by selected-tool PATH only on POSIX. The pinned c2e47b26 Windows gate was interrupted without a final summary or surviving process; security/Pi probes were not reached, and the cause is unknown. Its partial log is retained. Complete Windows validation remains pending for the next integrated candidate. Earlier 98105e1b completed its local gate/build (4412 passed, 52 conditional skips) and security/Pi probes; that result does not validate later code.

The privately installed package passes all four Windows TypeScript/Express, Python/FastAPI, Rust CLI and Go service examples through real preflight, one owned scripted worker, independent acceptance, persisted prepared target, explicit reverified apply and current-source checks. Independent evidence review confirms protected/source/Git assertions. The first long-path run failed before tests or workers at Git worktree creation; the identical package succeeded at a shorter private path. These are mechanism observations, not cross-platform example qualification, publication or real-Pi quality equivalence.

Later local commits add preflight resource observations (three actual CLI and four adjacent regression passes) and a settled Pi execution-cost callback (18 new cases; 68 related pricing/lifecycle/invocation passes). Both have independent review and combined typecheck/lint success. Resource counts cover selected task inputs; cost coverage describes observed model reference usage, not HTTP counts, tool charges or a provider bill. The working read-only Verdict CLI passes 18 cases after five independently reproduced contradictory-record false accepts were corrected and the original probe passed. Those later edits and the public schema work are outside c2e47b26's pinned/hosted results; complete combined acceptance remains open.

The public TaskSpec input schema now passes all 55 schema/parser tests and independent review; it is an authoring aid and does not replace strict parsing/runtime checks. The explicit real-compiler fixture passes on Windows with fresh preparation taking 2298.87 ms and compiled checks 534.09 ms under a separate 750 ms check allowance. This measured case is not a default timing gate or cross-platform/cache-safety claim. Current combined typecheck passes after correcting the fixture-only missing normalized worker field; the failed typecheck remains retained. Package installation and complete validation of these additions still follow.

Candidate ce0d4ac0 has seven hosted jobs passing and two full Linux jobs failing only the existing Pi import-boundary assertion (4598 passed / 1 failed / 7 conditional skips each). The schema definition is now relocated to the Pi adapter without weakening that test. Pushed candidate bb616fec additionally implements the real `/sparkle-task` user command and strict per-execute reference-cost dispatch; independent reviews and actual host/strict regressions pass, including repair of a sub-microdollar rounding bypass. Explicit objective file references and required permitted output locations have 66 passing parser/schema/execution cases plus 19 independent edge probes. These declarations do not infer arbitrary prose/checker semantics. Combined typecheck/full lint pass after two fixture typing corrections. All nine bb616fec hosted jobs pass; both full Linux Pi 1.2/1.4 lanes report 4662 passed / 7 conditional skips / no failure or cancellation. The later Native task-wide USD pool now passes 142 cost/strict/schema/parser cases with no skips and independent admission/publication review. Missing/foreign usage cannot renew allowance, actual overruns refuse, and live admission blocks later dispatch after a fault. Current combined typecheck/full lint pass; hosted and full Windows qualification of this later code still follow. The unchanged ce0d4ac0 Windows gate ended with 4547 passed / 1 schema-boundary failure / 58 conditional skips; build/probes/package were not reached.

The active [Phase 1 plan](../tasks/plan.md#phase-1-language-initialization-and-execution-examples-2026-10-24) retains complete current-candidate acceptance, final five-fixture preflight qualification, task-wide USD, explicit lifecycle/configured CLI/bounded resume, YAML compatibility, all six configuration comparisons, final public-entry examples/GIF and beta version as unfinished. Three-platform CI remains Phase 2. Four installed-language Windows mechanism examples have passed; full Pi-session equivalence has not been demonstrated. Fresh informational source analysis measures the direct entry closure at 21,638 physical lines and native core-session at 15,725, both without lab imports; neither establishes the below-10,000-line target. This analysis is not executed-module measurement or a size gate. Full Pi-session equivalence, general process containment, the old evaluation, paid/release approvals and quality targets remain open. Defect reduction >=50% and cost <=1.3x remain targets, not observed results.

The dated sections below are historical snapshots. Their pending work and claims describe those candidates; this section and the active plan govern current delivery state, while unresolved safety and approval obligations remain binding.

## Controlled SDK worker candidate (2026-10-23)

The [active plan](../tasks/plan.md#evidence-bound-changes-for-pi-2026-10-22) supersedes earlier implementation-order and package-version descriptions below. PR #75 delivered the revised direction and reconciled #67/#70/#71/#74; PR #76 has green hosted Pi 1.2, Pi 1.4 and mixed-host compatibility checks. Its interrupted Windows gate and failed complete rerun (4053 pass / 5 fail / 52 skip: four Git timeouts and one loopback resume failure) remain recorded; focused passing reruns do not establish the cause or complete acceptance.

`PiAgentExecutor` now calls the real coding-agent session through one controlled adapter. Session/settings/credentials remain in memory; the host owns provider dispatch, tools, selected model/thinking, retries and cost accounting. SDK background retry/compaction/cache warming and default resource discovery are disabled. One owned public before-agent-start handler preserves the exact host prompt, including empty text; real 1.4 and mixed 1.2 regressions cover text and tool schemas. The installed SDK is a required peer copied into managed candidates under the existing module boundary. Lifecycle, steering, retry, budget, cancellation and observed delivery-boundary regressions pass locally. Independent review found and closed a retry/steer/cost-stop interaction and cached-cost omissions/underreporting. Budget references include cached usage and retain unknown pricing coverage; they are not provider bills. Complete candidate verification remains pending. Full host skill/context inheritance and equivalence to the user's complete Pi session are unfinished. These changes establish no outcome superiority or general shell/MCP containment.

The native extension now captures the host model and working directory before host resource callbacks or asynchronous setup. Static eligibility may refuse that model but cannot choose another. Its shared core does not load learned routing or run adaptation; explicit legacy callers retain those paths. Approved context/skill bodies are host-selected and bounded, not automatically discovered. Focused native and mixed SDK checks pass; complete candidate acceptance is pending. The core import closure is still 15,725 physical lines, above the long-term 10,000-line target. Arbitrary parent context/provider-payload handlers are not inherited.
## Delivery reconciliation snapshot (2026-10-22)

PRs #65/#66/#69 are merged at main `9f883e4100bef61782e3aaab54bfebf8f541eb3a`; merged-main [CI](https://github.com/Xhhemoing/pi-sparkle/actions/runs/39757666467) and [recovery regression](https://github.com/Xhhemoing/pi-sparkle/actions/runs/39757666477) passed. #67 remains open. This is delivery evidence, not adoption of a Soul candidate, a general outcome benefit or a freeze decision. Later dated sections below retain their original scoped evidence.

The owner authorized bounded multi-stage blocker repairs and dependent-stage end-to-end verification. The [active plan](../tasks/plan.md) owns its acceptance and current results; prior failed native stages remain failures until this new candidate is independently verified. P4/P5, adaptation/learning, production and the broader 15-task evaluation remain open/frozen as applicable. Original Soul is outside the writable and trial-input boundary; this continuation uses retained isolated synthetic copies.

> Current direction (2026-10-21): integration through PR #62 is complete. The [active plan](../tasks/plan.md) now prioritizes completed-document cleanup and an isolated Soul test-version pilot with synthetic inputs; original Soul remains untouched. The broader 15-task comparison is deferred. P4/P5 and new experiments/adaptation/learning features remain frozen until an explicit owner decision based on comparative evidence; this pilot does not unfreeze them. Historical scoped claims and unresolved safety/approval conditions remain binding.

## P3 controlled-driver combinations accepted locally (2026-10-21)

The user-requested P1/P2 commit is 683c620a; fresh precommit focused36/36 and workflow/diff checks passed, with a clean postcommit worktree. P3 now adds held-tool and deferred-agent-end composition through the actual fixed driver/CLI/Agent with loopback, using explicitly instrumented private staged candidates. Current [plan](superpowers/plans/2026-10-21-controlled-combinations.md) and [evidence](reports/2026-10-21-controlled-combinations.md). Final focused34/34, independent spec/quality reviews, gate3997/0/48 conditional skips plus build and security26/Pi4 pass. The two new cases passed again in the full gate. Earlier fixture failures and one unconfirmed historical missing-aborted timeout remain in the report. No expanded containment follows; P4/P5 remain separate. Entries below retain their earlier dated stage evidence.

## Conversation reference recovery accepted locally (2026-10-20)

After P1 acceptance, P2 delivered an explicitly host-bound, read-only recovery session through the actual Pi tools. Saved current/suspended references receive a fresh focus generation; each status request re-reads bounded selected facts. All recovery execution is refused. Saved references do not prove an unrecorded execution never began. [Accepted bounded plan](superpowers/plans/2026-10-20-conversation-recovery.md) and [exact final evidence](reports/2026-10-20-conversation-recovery.md#final-local-p2-acceptance-2026-10-20): focused36/36, typecheck/lint, independent specification/quality reviews; final Windows Node24 gate3995/0/48 conditional skips plus build, security26/Pi4 pass. P3 was subsequently accepted locally in the 2026-10-21 record above. Durable writable recovery, broader C3, P4/P5 and other-platform qualification remain open.
## Pi conversation tools accepted locally (2026-10-20)

P1 now has an explicitly configured host factory and actual Pi conversation/focus handlers. Current focused verification: **28 pass / 0 fail / 0 skip**, typecheck/lint and independent specification/quality reviews pass. An actual offline Anthropic request regression found and closed R1 parameter loss; its RED and first interrupted gate remain recorded. Final serial gate passes: 3987/0/48 conditional skips plus build; security26/Pi4 pass. P1 was accepted locally before P2 began; P2 has its separate final acceptance above. [Current evidence](reports/2026-10-20-conversation-tools.md). The following sync-only and cloud entries are historical stages, not the current implementation state.
## Local sync and planning correction (2026-10-20)

Current source is 26808ad2 on the matching local/remote continuation branch; the two new commits contain documentation only. Fresh Windows Node24 conversation/native-loader regression: **19 pass / 0 fail / 0 skip**. No new full gate, feature wiring or recovery acceptance is claimed. [Evidence](reports/2026-10-20-sync-next.md) and [sequence](superpowers/plans/2026-10-20-sync-next.md) separate executable local conversation work from the earlier cloud Linux dependency/matrix blocker. The cloud section below describes that earlier environment attempt, not missing dependencies in this Windows checkout. Conversation tools/C3 remain planned; public managed dispatch still requires containment qualification.

This is the executable map of what is implemented, wired, exercised, and
outcome-supported. It is **not** a production readiness certificate.

## Earlier cloud candidate verification (2026-10-20)

Source `d6a3032a` is present on the requested continuation branch. Current Linux Node24 `pnpm gate` exits 1 at missing `tsc`, after workflow passes and before product tests/build. Dependency installation is blocked by automatic approval review for unknown telemetry egress; an offline/scripts-disabled alternative fails for a missing locked tarball. Node22.19.0 is available but product verification is NOT RUN; Windows is unavailable. No current full-gate, probe, packed-consumer or new implementation acceptance follows. [Exact commands, independent investigation and unblock condition](reports/2026-10-20-cloud-validation.md). Historical scoped results below remain historical.

## Staged ADR-009 implementation (2026-10-19)

Final local acceptance (2026-10-20), runtime 3d3dcdc5: pinned gate3978 pass/0 fail/48 conditional skips and build PASS; security26/Pi4/kernel3 and two actual packed SDK consumers PASS. [Exact commands, reviews and limits](reports/2026-10-19-staged-continuation.md#final-local-acceptance-2026-10-20). The following scoped slices are locally verified; whole M0-M7 and external conditions are not accepted by this result.

[Current evidence](reports/2026-10-19-staged-continuation.md) separates source, command checks and independent review. M1-C task context is now wired through native/direct/conversation host entry to the final executor prompt. Root integrated focused checks: 57/57; independent service/integration specification and quality reviews PASS. Two explicitly authorized synthetic real-provider tasks accepted exact candidate edits while leaving source unchanged. This is basic execution smoke, not comparative model benefit. Final local gate/probes passed; selected source may contain private data and is sent only under host selection.
M2-B now supplies additive `sdk/host.js` and `sdk/testing.js` entries, bounded lazy read-only contributions and actual packed consumers. Integrated 32/32 and consumer compile/run pass; independent spec/quality reviews pass. Same-process plugins remain trusted code. No automatic native registration or broad stability claim; final local gate/probes passed. See [SDK guide](sdk.md).

M3-A exposes historical revision/generation-bound findings from actual trusted checks. M3-B now adds host-opted bounded single-flight advisory analysis with per-attempt history and supported ordinary-Promise settlement ownership. Root26/26, independent spec/quality27/27 each and architecture11/11 pass. Unsupported async metadata remains host-owned; there is no sandbox or hard timeout. Analysis does not change repair/acceptance authority. Final local gate/probes passed; automatic correction remains separate. See [findings guide](check-findings.md).

M4-B reported usage coverage includes all outcomes, missing usage/prices and identity conflicts. Integrated 20/20, typecheck/lint and independent spec/quality reviews pass; final local gate/probes passed. Known-cost subsets are not settled bills. See [usage guide](usage-coverage.md).

M4-C preference replay now ignores deleted IDs and recomputes recurrence from surviving history after load/delete. Root45/45 and independent spec/quality PASS (including128 snapshot combinations). Original snapshot format, writer lock and unreadable-data behavior remain; raw diagnostic snapshots do not become sanitized exports. Final local gate/probes passed.

M5-A now stages a fresh build and physical runtime dependency graph into distinct opaque directories, with a builtin-only fresh-child loading boundary. Root/spec19/19, quality17/17 and independent boundary/lifecycle probes pass; architecture11/11 passes. Windows/Node24 actual copied Pi Agent execution is verified, not OS containment or Node22/other-platform qualification. Candidate metadata is not qualification. M5-B now executes five actual copied-runtime scenarios and validates bounded process observations before private issuance; root/spec/quality20/20 each pass. Input snapshots and credential-free isolated attempt state are verified. M5-C now persists retained qualification before locked approved selection and preserves ambiguity on failed restoration; root/spec/quality17/17 each and author A/B/C52/52 pass. M5-D1 now validates, snapshots and propagates durable run binding with event-authoritative resume refusal and metadata-only exceptions; root36/36, independent154 pass/1 existing Windows skip, typecheck/lint0 and architecture9/9. M5-D2 controlled offline driver is now independently reviewed after the cancellation repair: root104/104 adjacent and14/14 actual process tests, independent63/63 plus5 filesystem-window probes. Final combined gate/probes passed; public real-project containment acceptance remains pending. [Guide](managed-pi.md).

M6-A thin project continuation now delegates one operation to the existing controller with detached progress and cancellation settlement. Root 10/10 and independent spec/quality reviews pass; final local gate/probes passed. [Usage](advance-project.md). M6-B now supplies opt-in read-only GitHub current-fact drafts and separate bounded transport receipts; author/root/independent22/22, typecheck/lint0. Actual loopback and unrelated local runNext coexistence pass. No remote requests/writes or background activation; final combined gate/probes passed. [Connector guide](github-drafts.md).

M7-A legacy replay now excludes partial/cancelled results and stale model-version bindings. Root and independent reviewers each ran 54 pass / 1 existing Windows skip. This preserves historical self-report provenance; the actual host publisher is now independently reviewed and integrated20/20. One corrected live smoke confirms unknown-version exclusion after retained timeout/harness failures. Offline preparation is now integrated28/28 with independent spec/quality PASS, preserving genuine usage and task-disjoint temporal splits. Final local gate/probes passed. [Host attribution usage](host-attribution.md).

M0-D planned-item readiness now skips unresolved overlapping effects while selecting disjoint work through existing atomic claims. Root22/22, independent quality68/68 and2 actual lock/cancellation probes pass. Post-claim checks and final atomic admission remain authoritative; queue-to-ledger metadata locks retain their existing ownership. Final integrated gate passed. Scoped fresh-ledger archival is locally accepted; containment remains open. [Usage](advance-project.md).

## Generic command-tool uncertainty follow-up (2026-10-19)

[Plan](superpowers/plans/2026-10-19-command-uncertainty.md) and [verification](reports/2026-10-19-command-uncertainty.md): host-wired generic tools notify Native before model-visible cleanup errors; sticky uncertainty retains existing effectsSettled/ledger/claim fencing. Focused 23/23 and independent specification/quality reviews pass; build, security 26 and Pi 4 pass. Fresh full gate: 3646 pass / 1 Windows fixture-cleanup EPERM / 48 skip. The cleanup failure was reproduced and corrected without relaxing product assertions; affected file 25 pass / 0 fail / 2 platform skips. The later final integrated gate passed; see the current staged acceptance above. Arbitrary host effects, OS containment, arbitrary old writers, existing-root migration, publication and production/outcome acceptance remain open.

## Conversation host/focus and task presentation (2026-10-18)

[Bounded plan](superpowers/plans/2026-10-18-conversation-presentation.md) and
[actual verification](reports/2026-10-18-conversation-presentation.md) track the
experimental structured host facade, generation/revision focus, direct-request
dedupe/fencing and per-task presentation-only overlay. Focus/session 17/17 and
presentation/native adjacent 46/46 passed; independent combined source review
PASS with 63/63; actual pinned full gate 3,689 pass / 0 fail / 2 conditional
skips plus build. No natural-language frontend, persistent focus,
CodeMap, policy activation, live-provider benefit or main integration is inferred.
GitHub publication remains separately blocked by automatic approval review.

## Latest direction / M1-B candidate tools (2026-10-18)

[Adjusted roadmap](superpowers/plans/2026-10-18-direction-completion.md) continues
ADR-009 from PR #60, keeping #61 and main integration separate. Candidate tools
are implemented in host-neutral execution services, wrapped by Pi, and wired to
direct/native/strict-development entries. [Dated evidence](reports/2026-10-18-direction-completion.md) records author
focused 83/83, controller 16/16, independent source review PASS with 90/90, and
actual pinned full gate 3,657 pass / 0 fail / 2 conditional skips plus build.
This is source/local validation, not real-model benefit or production acceptance.
Task-local CodeMap, C1/C2 conversation/focus, presentation preference overlays,
stable SDK/Pi generations and measured policy improvement remain follow-ups.
No new model-benefit or production claim follows from file-tool validation.

## Framework migration continuation (2026-10-17)

Current task entry: [migration checklist](../tasks/migration-todo.md).
Implementation boundaries and current commands: [dated verification](reports/2026-10-17-framework-migration.md).

| Capability | Present | Wired | Exercised | Outcome-supported |
|---|---|---|---|---|
| M0-A cooperative process ownership | Published PR #60 `e6f6a5b`, tree `73e74bc2` | Existing command/recipe/native/controller paths | Prior exact-tree full gate and probes; current publication readback | no |
| M0-B atomic effect admission/scoped readiness | PR #60 `51cf50d` | Existing ActionLedger/WorkItemStore/controller, schema 1 | Focused 49 real controller/process and 61 final adjacent tests; integrated gate 3630 pass / 0 fail / 2 skip | no |
| M1-A direct task entry | Experimental `development/start-task` module on PR #60 | One NativeWriteSession, inherited verifier/repair/cancel/evidence | Six real temporary Git/scripted-executor tests plus integrated gate; no provider used | no |
| M2-A module boundaries | Canonical CLI options/routing catalog/persist layout, old import forwarding | Native/track and existing layout consumers | 98 focused tests, integrated gate; exact moved bytes and export/error identity guards | no |

The earlier M0-A publication rejection below is historical: the user explicitly
authorized pushes and the exact tested tree has now been read back from GitHub.
Full M0 containment/Windows qualification, old-writer isolation, command-tool
uncertainty and terminal-ledger archival remain open. Shared roots must exclude
old controller binaries using the previous non-atomic admission path. Remaining M1
context, stable SDK, main/PR #61 integration and existing policy/live/production
gates remain separate. Current test results are not model-benefit evidence.

## Current architecture design and explanation (2026-10-16)

The user accepted the lightweight adaptive **design**, now maintained in
[ADR-009](decisions/0009-lightweight-adaptive-framework.md), the
[framework](framework.md), [algorithm contracts](architecture-algorithms.md),
[migration plan](architecture-migration.md) and [interactive HTML](architecture.html).
The documentation source baseline is PR #60 `7407674`; main is `44db4b1`, and
PR #61 remains a separate unmerged candidate. Earlier sections below retain their
dated evidence; the framework link now points to the maintained explanation.

| Scope | Current state | Evidence / next condition |
|---|---|---|
| Lightweight architecture, four responsibilities and optional extensions | Accepted design; this delivery changes documentation only | User design acceptance; [documentation verification](reports/2026-10-16-current-architecture-guide.md) |
| Light entry, dynamic findings, managed Pi generations, stable plugin facade and preference overlay | Migration targets; existing pieces are mapped separately | Bounded M0–M7 slices in the migration plan; no new runtime wiring claimed |
| Routing, cost optimization and long-term learning | Existing proposal/shadow paths retained; new policy and settlement work planned | No live-model benefit, strict root dollar guarantee or Outcome-supported claim |

**Reliability correction:** the earlier bounded-verifier-cleanup row does not prove
whole-process-tree settlement. A POSIX nested detached-runner reproduction can
continue writing after the outer timeout has settled; this is an open P0. The evidence is
an equivalent nested-runner experiment, not a real `develop` end-to-end run.
The subsequent [M0-A implementation](reports/2026-10-16-process-ownership.md)
now reproduces this on the real develop path and addresses cooperative nested
groups plus unresolved-effect ownership. That dated evidence supersedes the
equivalent-only reproduction boundary; full containment and platform acceptance
remain open and must not be inferred from signal delivery or pipe closure.
M0 must verify the real path, complete descendant settlement and prevent lease or
workspace reuse while effects remain unresolved before adding parallel writers or
the process-based Pi backend. Existing tests remain scoped evidence.

Design acceptance does not close S0-min, R10/R11, F6/F-PROD, shared root budgets,
live-provider, independent implementation review, production or outcome gates.
Explicit task preference overlays do not mutate active learned-resource snapshots,
runtime generations, authority or checker bindings. ADR-008's opaque versioned IDs
and exact bytes continue to govern identity; no replacement hash is introduced.

## M0-A cooperative process ownership (2026-10-16)

| Present | Wired | Exercised | Outcome-supported |
|---|---|---|---|
| Local source checkpoint `482dabb` (tested runtime `ed97692`) plus final evidence/comment correction | Command runner, internal recipe checker, strict/native verification, controller check/write action fences | Linux real develop abort/repeated abort/deadline/grandchild, retained source view, escaped uncertainty and parent crash/replay; full gate 3594 pass / 0 fail / 2 skip, security/Pi/kernel probes PASS | no |

[Plan](superpowers/plans/2026-10-16-process-ownership.md) · [full evidence and publication block](reports/2026-10-16-process-ownership.md). Existing strict successes and repair semantics retain their tests. Interrupted trees are conservatively unconfirmed; they retain ownership rather than granting acceptance/replay. Main and separate PR #61 are unchanged. Hosted/Windows qualification, OS containment, old-writer isolation, concurrent checker admission, terminal-check archival and the remaining M0/production/experimental gates remain open. The prepared GitHub push was rejected by automatic approval review and was not retried through another endpoint.

## Framework and host verifier limits (2026-10-16)

Current source baseline: PR #60 `167a5404`; main remains `44db4b1`. The [framework map](framework.md)
distinguishes merged foundations, the DP/B3/TA candidate and separate PR #61. The [RL plan](superpowers/plans/2026-10-16-development-recipe-limits.md)
and [report](reports/2026-10-16-development-recipe-limits.md) govern this continuation.

| Capability | Present | Wired | Exercised | Outcome-supported |
|---|---|---|---|---|
| Host recipe timeout/output limits and immutable recipe set | RL source candidate | WorkItemRecipe/prepareWorkItemRecipes, recipe-check and DevelopmentController; validator included in trusted checker dependencies | RED 7 pass / 8 fail; focused 52/52 PASS, including real >5-second / >2-KiB commands and Git run/review/accept | no |

Defaults remain 5000 ms and 2048 bytes per stream. Optional timeouts are 1..40000 ms, with all
effective recipe timeouts together at most 40000 ms; optional stream caps are 1..1048576 bytes each.
Legacy omitted fields retain their serialized shape. Invalid complete definitions refuse before any
checker runs. Existing outer 60000 ms check windows and unavailable-versus-functional-failure meanings remain unchanged.
This is author verification; current aggregate/hosted results are in the dated report, and independent
review, main integration, live effectiveness, root cost settlement and production remain separate.

## Architecture and development candidate (2026-10-15)

Additional isolated P2 candidate: pure child recovery extracted from
`flowchart-run.ts` on `codex/continuous-quality-20261015`, based on PR #60
`c2b802c`. No run/event/checkpoint/acceptance/budget contract changed.
Independent review and actual pinned local `pnpm gate` PASS (3321/0/1),
security/Pi/kernel probes PASS. Dedicated Ubuntu/Windows recovery checks are
configured; hosted evidence and publication are recorded separately in the
[recovery verification record](reports/2026-10-15-flowchart-recovery-refactor.md).

The next bounded candidate separates normal terminal recording into
`flowchart-terminal.ts`; finish, crash, checkpoint and writer-lock ownership
remain in the orchestrator. Four runtime function bodies are unchanged; seven
new awaited-order/refusal tests and transferred live-owner pins pass.
Independent review and combined actual pinned gate PASS (3328/0/1), with
security/Pi/kernel probes PASS. [Terminal evidence](reports/2026-10-15-flowchart-terminal-refactor.md).
Neither extraction changes terminal vocabulary or claims new recovery semantics.

[PR #60](https://github.com/Xhhemoing/pi-sparkle/pull/60) contains the reviewed
candidate from main `44db4b1`; it is not a claim of main integration or
production acceptance. [Architecture, research and verification](reports/2026-10-15-architecture-agent-loop.md).

| Capability | Present | Wired | Exercised | Outcome-supported |
|---|---|---|---|---|
| Bounded native candidate repair | PR #60 | opt-in `NativeWriteSession.execute` SDK; one retained candidate, finite attempts/time, immutable check, failure feedback and explicit stop reasons | real Git/command integrations, scripted two-attempt demo and independent agent review | no |
| Provider fallback correctness | PR #60 | existing Pi executor; retryable-only fallback, shared known-priced spend, one settled task result | focused retry/abort/attribution/cap regressions and independent review | no |
| Bounded verifier cleanup | PR #60 | shared command runner; TERM/KILL/deadline; raw exit/signal evidence | stubborn-process regressions; Windows descendant containment remains outside scope | no |
| Supervisor verdict and round settlement | PR #60 | existing supervised run/resume path | rejection/final-round regressions and independent review | no |

These additions do not wire native writing into the default CLI, resume a
repair loop after a crash, apply a candidate automatically, settle a
cross-attempt dollar budget or enable adaptive live routing. Existing
R10/R11, S0-min, F6/F-PROD and production/outcome boundaries remain separate.

## Host development control plane and continuation (2026-10-15)

The original four architecture rows above describe stage one. Stage two is independently reviewed and saved at PR #60 `726e5e55`; stage-three batch/review continues on the same source candidate. These are PR capabilities, not main integration, production approval or model benefit. [Stage-two verification](reports/2026-10-15-development-control-plane.md) · [stage-three plan](superpowers/plans/2026-10-15-development-batch-review.md).

| Capability | Present | Wired | Exercised | Outcome-supported |
|---|---|---|---|---|
| Host work queue and durable action reconciliation | PR #60 | WorkItemStore/ActionLedger and explicit develop CLI | queue/persistence/concurrent-process/crash-window integrations and independent review | no |
| Named native criteria and exact bounded verification | PR #60 | NativeWriteSession and host development controller | real commands, same-length changes, protected checker, authentic descriptor and independent review | no |
| Candidate historical review | stage-three candidate | reviewDevelopmentCandidate / develop review | bounded reads, real one/two-attempt artifacts, stale/corrupt/contradictory refs, read-only regressions and independent review | no |
| Finite serial development batch | stage-three candidate | runDevelopmentBatch / develop batch | independent candidates, no auto-accept/dependency bypass, shared cooperative deadline, first-failure/unknown-effect stops and independent review | no |
| Selection/claim/publication cancellation | stage-three candidate | optional operation signal plus controller await fences | committed-token preservation, resolver-tail settlement, inherited-signal refusal and independent review | no |

Batch serialization applies within one invocation; there is no new global lifecycle lock or cross-worker cost quota. The deadline requests cooperative cancellation and waits for actual settlement; synchronous Git and cleanup/persistence tails may overrun it. No dollar ceiling or automatic source integration is added. Review reports historical observations with reverified=false, not fresh acceptance authority. Legacy receipts without new refs remain unavailable; explicit invalid refs refuse. [Continuation guide](development-agent-loop.md). LIVE-01 still requires configured model/provider and a host trial budget; real model effectiveness remains unobserved.

## SHA-256 removal gate (2026-09-21)

A repository-wide census found SHA-256 in runtime identity, persistence, integrity, evaluator/apply, holdout, migration, and active-contract surfaces. Removal is authorized by [ADR-008](decisions/0008-remove-sha256.md). All runtime removal groups are implemented on the uncommitted worktree with the G5 gate green as of 2026-09-22 (author-run; evidence: [removal report](reports/2026-09-21-remove-sha256.md), Session 5): zero active SHA-256 computations remain in runtime surfaces; only legacy-refusal detectors remain. Legacy SHA-bound records are quarantined historical/read-only evidence, never rehashed or reclassified. Migration execution, live-provider runs, production apply/rollout, holdout/F6, and independent review remain separate open gates.

Definitions (ADR-004):

- **Present** — code or candidates exist.
- **Wired** — a runtime or CLI path can invoke it.
- **Exercised** — tests or local fake runs have used that path.
- **Outcome-supported** — held-out or comparable later benefit, no guardrail
  regression. Nothing in this repo is Outcome-supported.

Notes cells below state current posture only. The full evidence text,
round-by-round census notes, and contract wording live in the
[verbose notes archive](reports/2026-08-27-status-matrix-notes-archive.md)
(linked per row as `archive §N`).

## Report execution candidates (2026-10-01 reconciliation)

Merged-source facts: PR #47 (mandatory context admission + stratified task diagnostics) is merged into main as `4df5baff7f2ed3cec1dbc5fe8db3562b4eb61cf7` (2026-09-29); PR #48 (C2-evidence-1 command-evidence provenance) is merged into main as `b114255bd815617068b3b46bfb3848eac0b8e6e5` with exact head `f856b2973548aced684671654a50ec98e1403dba` (2026-09-29). [Plan](superpowers/plans/2026-09-29-report-execution.md) and [exact verification/handoff](reports/2026-09-29-report-execution.md). "Source merged" below is a main-merge fact only; **independent acceptance is not claimed and not PASS**, and all owner, experiment and outcome gates remain in force.

Per-capability columns follow ADR-004 definitions; "Source merged" names the exact merge commit that carried the code, "Wired"/"Exercised" keep the pre-merge automated-fact wording, and independent acceptance / live verification / outcome support stay open.

| Capability | Source merged | Present | Wired | Exercised | Outcome-supported | Notes |
|---|---|---|---|---|---|---|
| Mandatory context admission | PR #47 `4df5baff` | yes | existing packet/child-grounding paths | unit, parent-dispatch integration and recorded gate | no | Invalid budgets and over-budget mandatory payloads refuse; non-goals/instruction references retained; conflicting mandatory keys refuse. Estimates cover packet payload, not the full prompt or a calibrated tokenizer. First parent launch now shares terminal recording. C2 evidence invalidation remains separate. Independent acceptance open. |
| Stratified task diagnostics | PR #47 `4df5baff` | yes | existing auto-loop diagnostics | learning regressions and recorded gate | no | Project/family/role/available versions stay separate; task replay dedupes and conflicting bindings/outcomes exclude that task; unbound groups cannot become actionable. Primary diagnostics remain visible. Role/version-qualified evidence is not widened into legacy avoid rules. Persisted observation keys and live selection are unchanged; a typed candidate bridge remains open. Independent acceptance open. |
| Project learning-key isolation | library (`stableProjectKey`, 2026-10-01) | all key/identity/learned-state derivation paths | case-collision RED regression + adjacent learning/routing/doctor suites | no | 2026-10-01: whole-path lowercasing collapsed case-differing roots onto one key/identity/directory; now only the volume prefix (drive letter, `//host/share`) folds. Legacy lowercase-key dirs are not migrated and stay doctor-visible; previously-keyed projects get a fresh registry baseline by design. POSIX-only on-disk sibling test (win32 skip documented). [Evidence](reports/2026-10-01-project-key-isolation.md). Independent review open. |
| Command-evidence provenance (C2-evidence-1) | PR #48 `b114255` (head `f856b29`) | yes | existing `CheckAdapter` evaluation path | evaluation regressions incl. RED-first unbound/mutable evidence cases | no | PR #48 bounded sub-slice only: a command result without a recorded revision or change set returns **UNOBSERVED** (zero and nonzero exit alike) — missing provenance is never inferred from the current context; actual vs expected attribution stays distinct; malformed exit/duration/revision/cwd/changeSet abstain; returned change-set metadata is a snapshot. C2 artifact/contract/evaluator-definition version binding and host portions still wait for B2. Independent acceptance open. |

## Runtime line (M0–M2.5)

| Capability | Present | Wired | Exercised | Outcome-supported | Notes |
|---|---|---|---|---|---|
| Fake executor `run` / `inspect` / `resume` | yes | yes | yes | no | Default local path. Merge gate `pnpm gate`; preview-tag gate `pnpm prerelease`. `inspect --run` surfaces latest stall/block required evidence; opt-in `--summary-json` prints one frozen-additive `INSPECT_SUMMARY` object, deliberately outside the `Event` union and mutually exclusive with `--json`. `resume --primary-model/--thinking` configure this resume only (nothing persisted). `run --max-cost-usd` stamps a per-run ceiling into `RUN_CREATED.limits`; unpriced models warn once and run uncapped; refused on `--flowchart`/`--track`. Full contract wording: archive §1. |
| PS-06 run status/recovery projection | yes, merged main `dd9699b` (PR #54) | opt-in `inspect --run --status-json` | behavior head `ebc8d8fd` local prerelease 3272/3253/0/19 + build with preview/security/Pi probes PASS; decision-head hosted CI 5/5 PASS; merged-main CI run `37465254859` PASS. Prior transient gate failure retained in report | no | Separate additive projection, not Event/INSPECT_SUMMARY/RunStatus changes; verification is child-report, cost is own-run eligible/fully-priced subset with gaps, no automatic recovery. Merged under recorded owner-delegated integration; independent PASS is still not claimed and dispatch had failed HTTP 403. Candidate lookup, UI, PS-03/04, B2/S0-min and production remain open. [Plan](superpowers/plans/2026-10-01-ps06-status-projection.md); [evidence](reports/2026-10-02-ps06-status-projection.md). |
| `migrate-legacy` | yes | yes | unit (`test/unit/cli/migrate-legacy.test.ts`) + integration (`test/integration/cli/migrate-legacy.test.ts`) | no | Copies pre-plane flat state into `runtime/` + `adaptation/`. Dry-run default; `--apply` copies, never moves/deletes/overwrites; corrupt JSONL (non-tail) refuses the copy. Archive §2. |
| `--children` parent coordinator | yes | yes | yes | no | Fake child executor by default; the spec is compiled through `compileChildrenToFlowchart` and executed on the flowchart engine with `ChildCoordinator` semantics. Plain `--children` deliberately starts contract-less (`skipContract: true`) — use `--track` for a coverage-gated start. `--max-cost-usd` is recorded and forwarded per child but not enforced by the fake; there is no cross-child spend ledger. Archive §3. |
| Cluster undelivered-mail reporting | yes | parent + flowchart outcomes and CLI stderr; host API | unit + `test/integration/cluster/undelivered-mail.test.ts` | no | Both cluster embedders pull a `ClusterMailReport` after settlement; exactly one frozen stderr warning when pending/dead-lettered mail remains. Same-role late delivery deliberately unavailable; `pending=` flags unclaimed roles (no TTL). Archive §4. |
| `compileChildrenToFlowchart` | yes | yes | library tests | no | Wired at the CLI children path and the track loop. Real-provider coverage of this path is still open. Archive §5. |
| `--flowchart` supervisor | yes | yes | yes | no | Public orchestrator, incompatible with `--children`/`--track`. BLOCKED settlements print the recorded reason/evidence plus exactly four routed lines (`inspect`, `inject`, `unblock`, `note`); `unblock --reason` records `RUN_UNBLOCKED` against the exact active `RUN_BLOCKED`, reopens without executing, and refuses stale/wrong-node requests. Archive §6. |
| Event log + checkpoint + resume | yes | yes | yes | no | Truncated JSONL tail recovered; corrupt middle fails closed. Flowchart resume restores node specs from logged `TASK_REQUEST`s and durable checkpoint records (`taskCriteria` monotone first-write-wins; absence is unknown, never synthesized). Run-level cost ceilings restore only from the run's own `RUN_CREATED.limits`. Terminal replay is shared by all writers with `RUN_UNBLOCKED` as the explicit BLOCKED-interval exception; crash terminals share `src/run/crash-terminal.ts` (one best-effort `RUN_FAILED`, no overwrites). Archive §7. |
| Episode bind / `inspect --episode` | yes | yes | yes | no | Reducer is fail-closed on duplicate open/attach, terminal replay, and dangling cross-stream refs. Archive §8. |
| Privacy delete cascade (`delete --run` / `--episode`) | yes | `delete` CLI | unit (`test/unit/privacy/deletion.test.ts`) + integration (`test/integration/cli/delete.test.ts`) | no | Filter-rewrites the shared invocation log and invalidates observed rates. Record-writing lifecycles hold `runtime/runs/<runId>.lock`; deleting a live run waits (bounded, `--lock-wait-ms`) or fails `LOCK_TIMEOUT` having removed nothing; SIGKILL lock recovery is doctor-guided manual removal (crash probe case 9). Episode text copies in append-only run logs are detected and reported, not rewritten. Archive §9. |
| Cost calibration (observed rates) | yes | catalog load path | unit (`test/unit/routing/cost-calibration.test.ts`) + integration (`test/integration/track/track-loop.test.ts` — invocations.jsonl → calibrated cost in `MODEL_ROUTED`) | no | Only `callOutcome === "ok"` rows move a rate; excluded rows are counted for diagnosability; missing/zero usage is skipped, never read as zero tokens. Archive §10. |
| Catalog/preference/bandit integrity | yes | catalog load + preference persistence + post-run adaptation | unit (`test/unit/routing/catalog-observed.test.ts`, `test/unit/preferences/preferences.test.ts`, `test/unit/learning/bandit-store*.test.ts`) | no | All three snapshots publish atomically; recovery follows the state class: catalog `CATALOG_OBSERVED_CORRUPT` (rebuildable), preferences `PREFERENCE_SNAPSHOT_UNREADABLE`, bandit `BANDIT_STATE_UNREADABLE` (bytes survive for repair). Does not wire the bandit into live selection. Archive §11. |
| Coverage gate | yes | `--track` / library starts with a contract | unit + integration | no | Enforced by `assertCoverageAllowsStart` when a contract is provided; `--track` builds one, plain `--children` deliberately does not. The deterministic verifier is the sole gate; the Pi executor's `sparkle_report_task_result` provides live `PASSED`/evidence-backed `FAILED` verdicts, including the per-criterion `unmet-acceptance-criterion` hard gate. Archive §12. |
| Real Pi executor | yes | `--executor pi` | offline loopback HTTP integration; opt-in `PI_SMOKE=1`; fake-backed `cluster-tools` + `auth-session` units | no | Every attempt exposes `sparkle_report_task_result` (leased identity, protocol v1, evidence-backed `FAILED`, optional per-criterion results). Loopback integration drives the exported CLI through run → approval → resume and proves model/thinking wire behavior plus a two-tier cascade over a local SSE server. Real-provider coverage remains opt-in smoke only. Archive §13. |
| Provider retry (429/5xx) | yes | inside `--executor pi` only (opt-in path) | unit (`provider-retry`, `executor-retry`) + integration (`test/integration/pi-adapter/steer-retry.test.ts` — 429 through the real executor retry path) | no | Classifies thrown SDK errors and flattened `errorMessage` strings; honors `Retry-After` / `remedy_hint` up to 30s, exponential backoff capped at 8s, max 3 attempts; 401/403 never retried. Failed calls record usage as `undefined` with `callOutcome` attribution. Archive §14. |
| Executor model pinning/fallback | yes, merged main `98af1b59` (PR #59) | `run`/`resume` `--executor-model`; `--executor pi` fallback chain | unit (`test/unit/pi-adapter/executor-fallback.test.ts`) + CLI config/usage regression | no | 2026-10-07 author verification on main `98af1b59`: focused 12/12 PASS, lint/typecheck/full suite/build PASS (3274 / 3255 / 0 / 19). A fast-model fallback entry is added only when `providers.json` declares a fast alias and that alias differs from the selected `--executor-model` (or `--primary-model` fallback); fallback entries resolve through the model catalog and skipped entries are not invoked. Primary and fallback attempts are separately recorded by model and call outcome. Independent review, live-provider verification, explicit opt-in/consent semantics, and production/outcome claims remain open. |
| Persist file lock | yes | bandit/preference/feedback writes | unit tests (`test/unit/persist/file-lock.test.ts`) | no | Exclusive `wx` lock. Stale locks are timeout-only (no PID-reuse steal by design): an abandoned lock means timeout + manual cleanup. Archive §15. |
| `doctor` | yes | yes | unit (`test/unit/cli/doctor.test.ts`) + integration (`test/integration/cli/command-error-doctor.test.ts`) | no | Read-only recursive inventories: `locks` (with per-lock remediation), `runStates` (advisory crash candidates), frozen-additive `learnedState` (bandit/preferences/catalog with plane-correct remediation). Doctor never repairs and never acquires/steals/deletes a lock. `LOCK_TIMEOUT`/`RUN_RECORDS_SURVIVED` failures route their `next:` line to `doctor --json`. Archive §16. |
| Retention bounds | yes | `retain` CLI | unit (`test/unit/privacy/retention.test.ts`, 14 cases) + integration (`test/integration/cli/retain.test.ts`, 5 cases) | no | `retain` applies a 90-day default age policy to `runtime/invocations.jsonl` and `runtime/episodes/`; dry-run-first, deletes only with `--apply`, reusing the `delete` lock/cascade surfaces. Operator-triggered, not a background timer. Archive §17. |

Round-by-round truth-up notes (Rounds 9–13) and current runtime postures
(contract/checkpoint invariants, `sparkle_report_task_result` sweep results,
frozen `RunStatus`, `RUN_UNBLOCKED_WITH_DISCARD` authorization, crash-probe
case list) are archived verbatim at
[archive § Rounds 9–13](reports/2026-08-27-status-matrix-notes-archive.md#rounds-913-truth-up-and-current-runtime-postures).

## Pi compatibility line (pin + auxiliary tooling)

Everything below is developer preview and, like the rest of this matrix, not
Outcome-supported. Flag spellings match the CLI USAGE in `src/cli/main.ts`.
ADR-006 was revisited and Accepted on 2026-09-18. The native extension registers
`sparkle_delegate` (read-only scout/reviewer tasks) and `/sparkle-status`.
The host supplies coding-agent; 0.86.1 is a development dependency and the
optional peer range is 0.84.4–0.86.x. Loader paths were exercised locally on
0.84.4, 0.85.1, and 0.86.1 (the 0.86.1 loader check ran with the 2026-09-20 pin
bump's extension tests); live-provider and full interactive compatibility remain
unverified.
See [native Pi plan](superpowers/plans/2026-09-18-native-pi.md).

| Capability | Present | Wired | Exercised | Outcome-supported | Notes |
|---|---|---|---|---|---|
| Native Pi delegation | yes | `sparkle_delegate` → `NativeSession` → existing parent coordinator / child tracking / terminal auto-loop; per-task routing over one eligible host-registry snapshot, credential-free frozen capability snapshots, host-object dispatch after identity-drift validation, optional canonical-path-safe large-read projection, and bounded read-only evidence-gap inspection | fake lifecycle tests + routing/canonicalization/capability matrix + two-provider HTTP/SSE secondary dispatch + corrupt-registry refusal + actual-model attribution + canonical junction secret-path refusal + D1 bounded/foreign-run/empty-evidence tests | no | **2026-09-25 corrected current slice is present, wired, author-gate green (2879 / 0 / 18), and independently reviewed PASS at `7d7cd59b` (90 focused tests, no findings).** This is not the post-L2 final review or Stage 0 approval. Credentials stay host-owned; aliases never persist as routed ids; no worker writes/shell/spawn; child results remain self-report and D1 defaults host acceptance to `UNOBSERVED`. Live-provider execution, owner Stage 0 freeze, pilot/data approval, production apply, F-PROD, and Outcome-supported gates remain open. [Implementation record](reports/2026-09-25-controlled-improvement-implementation.md); [independent review](reports/2026-09-25-integrated-review.md); [Stage 0 owner package](reports/2026-09-25-stage0-owner-freeze-package.md). |
| Native isolated write session | yes | library API `NativeWriteSession` → retained detached worktree → parent run → async host `runClosedLoopCheck`; candidate command tool and verification share signal-aware shell-less runner | 2026-10-02 focused execution/native checks 58/0/0, write cancellation 9/0/0; previous native reliability suites retained | no | Candidate-scoped read/write tools only; host command/argv are snapshotted and independent acceptance is required. Pre-abort, in-flight verification cancellation, timeout and output-limit paths retain failure evidence and candidate; source remains untouched. No automatic application/disposal, live-provider acceptance, or independent reviewer PASS is claimed. [Cancellation evidence](reports/2026-10-02-native-cancellation.md). |
| Native candidate application | yes | library API `NativeApplySession` → accepted-only apply of a retained, realpath/common-Git-dir/registration-checked candidate; signal-aware in-candidate re-verification; two-tree checkout then guarded ref updates; no automatic rollback; issued-receipt disposal with host-only `/sparkle-dispose-candidate`; host-facing handle-only `sparkle_apply_candidate` with host-only `/sparkle-issue-candidate` issuance | 2026-10-02 apply/disposal focused suite: 59 pass / 0 fail / 0 skip; previous apply evidence retained | no | **Present and wired, but not production-authorized:** source must be a clean, unchanged named branch; invalid/foreign/replaced candidates are refused before verification. Cancellation during verification refuses before staging/checkout; hook/concurrent user changes are preserved; partial/ambiguous checkout/ref failures retain candidate and evidence rather than resetting source. Cross-instance disposal now works through a run-scoped receipt, is idempotent after successful removal, rechecks issued filesystem identities, and refuses candidate edits, locks, replacements, or ignored files without recursive fallback. A 2026-10-06 author-verified slice reconciles completed Git removal before receipt persistence only for the exact authorized absent path, with a bounded prunable-stale-record repair; it is not a claim that the full apply/removal pipeline is crash-atomic. Independent review and R10/R11 remain open. R10/R11 evaluator-definition, candidate-snapshot, and production owner-authorization boundaries remain open; worker-write registration and automatic write-to-apply chaining remain absent. [Cancellation evidence](reports/2026-10-02-native-cancellation.md); [Disposal evidence](reports/2026-10-02-native-candidate-disposal.md); [current reliability evidence](reports/2026-09-27-reliability-implementation.md). |
| Evidence invalidation (C2-evidence-2) | PR #51 `cd47a753` (2026-10-01) | library-only; no runtime caller yet | RED-first regression + evaluation/adaptation/experiments suites | no | Stored `EvaluationRecord`s are classifiable as `valid` / `invalidated` (reason names the changed artifact/rubric/evaluator/dependency reference) / `foreign` (unaffected artifacts retained); unbound records and non-exact dependency snapshots fail closed; additive optional `dependencyVersions` snapshot on records. Advisory only — no PASS/UNOBSERVED redefinition, no frozen-DTO edits, host wiring waits for B2. [Evidence](reports/2026-10-01-evidence-invalidation.md). Independent review remains open. |
| Pi pin 0.86.1 | yes | `src/pi-adapter/` only (ADR-001) | typecheck + adapter tests + `test/unit/pi-boundary.test.ts` specifier tripwire | no | Exact matching pair `@earendil-works/pi-agent-core` / `@earendil-works/pi-ai`, no ranges. Bumped 2026-09-20 from 0.85.1: transcript-context system messages (`SystemMessage.toolsAdded`), `ToolCall.arguments` narrowed to `JsonObject` (one test-side cast), no adapter product change. `pi-compat --online` status `current`. Bump playbook: [how-to-adapt-to-pi](how-to-adapt-to-pi.md). |
| `pi-compat` CLI | yes | `pi-sparkle pi-compat [--json] [--offline]`; online opt-in via `pi-sparkle pi-compat --online [--json]`; script alias `pnpm pi-compat` | unit tests (`test/unit/cli/pi-compat.test.ts`, `test/unit/pi-compat/`) + local runs | no | Offline default; online fails closed to `status=unknown`, exit 0. Exit 1 only on adapter-contract breakage. Legacy-identifier probe reads adapter sources only, never docs. Sibling probes: `pnpm pi:probe`, `pnpm pi:latest`. |
| doctor `pi-packages` / `pi-compat` checks | yes | appended `doctor` checks | unit tests (`test/unit/cli/doctor.test.ts`) + local run | no | `pi-packages` prints the pinned pair; `pi-compat` always uses the offline report (no network). Inherits doctor's unfrozen output contract. |
| `run --thinking <level>` | yes | all three `run` forms (plain, `--track`, `--flowchart`) | `test/unit/cli/thinking-flag.test.ts`; clamp characterization in `test/unit/pi-adapter/thinking-clamp.test.ts` | no | Levels `off\|minimal\|low\|medium\|high\|xhigh\|max`; flag > `PI_THINKING_LEVEL` > `off`; per-run, never persisted (headless counterpart of Pi's session-scoped TUI `/thinking`). Google models silently clamp `xhigh`/`max` — provider behavior, not rewritten by the CLI. |
| `resume --primary-model/--thinking` | yes | supervised and flowchart Pi executor reconstruction | resume-disclosure + sink-wiring units; loopback default-rebuild warning | no | The flags configure the executor being rebuilt now; no persisted executor configuration is restored. Pi resumes disclose requested-now versus default rebuild, while no-executor and non-Pi resumes disclose ignored flags. An invalid ambient `PI_THINKING_LEVEL` is refused with the same validation as `run`. |

## Adaptive library line (M3–M6)

| Capability | Present | Wired | Exercised | Outcome-supported | Notes |
|---|---|---|---|---|---|
| R0 / static `ModelRouter` | yes | live flowchart + `--children` assign | yes | no | Live path. `routeFlowNode` runs `analyzeTask` and persists compile-time `agentRole` (`flowchart-v5`). When `agentRole` is persisted, recorded complexity matches assign-v5 (no MEDIUM floor on scout/tester). Vision is scoped to implementer/debugger/worker; generic edit roles skip TEST_RE families. High-risk analysis arms `WAITING_FOR_USER`. `--assume-defaults` auto-selects default approval items and labels them `answeredBy: assume-defaults-auto` (absent field = legacy). Stage 2 explicit `--approve-high-risk` needs owner sign-off; see [strategy](reports/2026-08-23-algorithm-strategy.md). Posteriors keyed on assign-v4 / flowchart-v4 must not be reused. |
| Public prior snapshot | yes | `--public-prior` | yes | no | Hashed frozen file only; no HTTP leaderboard fetch. |
| R1 / bandit / topology | yes | **shadow / offline only** | module tests | no | Must not import into live execution until F-PROD. Enforcement (2026-08-24 R2, amended Round 7): `live-isolation.test.ts` walks the **transitive** import closure from four live entry points with a pinned two-entry allowlist — `routing/bandit.ts` is reachable as the post-run reward **writer** via `bandit-store`; `selectArm` still has no live caller, while doctor's `loadProjectBanditByKey` call is the sole signed-off read-only diagnostic exception, used only for `learnedState` inventory and never for selection. R8-9's deletion of the unused root-keyed `loadProjectBandit` landed in `ba0b2ce`; the keyed diagnostic reader remains. `routing/topology.ts` remains reachable only as the parked defined-but-unused `planTaskTopology` in `run/supervisor.ts`. R1/shadow/holdout modules must stay unreachable. |
| Auto-loop collect + propose | yes | after `--track` / `--children` | yes | no | Never CAS-promotes. `adapt promote --approve` (with `--candidate --expected --content-file --review-file`) required. Bandit/avoid consume model-attributed taskSuccess only (a FAIL needs `failureClass: model`); `failureClass` is derived, never accepted from extraSignals, and extraSignals prose can only exculpate — 429/transport and TASK_TIMEOUT stay out of the posterior. Kill switch (R3): `SPARKLE_AUTO_ADAPT=0` collects and diagnoses only — observation continues, everything that *learns* stops: no `bandit.json` update, no candidate proposal (`src/learning/auto-loop.ts:101–114`; the result reports `banditUpdated: false`). |
| Promotion CAS + rollback | yes | CLI | unit tests | no | Proposal-first. |
| Redaction as transform | yes | `appendFeedback` (every adaptation-plane feedback write) | unit + privacy + integration (`feedback/redaction`, `privacy/redaction`, `m3/redaction`, `feedback/store`) | no | 2026-08-24: value-removing transform, not label-only — secrets (PEM, Bearer, vendor keys, JWT, keyed assignments), email/IPv4/phone/Luhn-valid cards, home/UNC paths replaced with stable placeholders; ReDoS-hardened; oversized bodies dropped to reference-only. R3: the per-class decision is now **persisted** as `redactionClasses` on the record (`src/feedback/types.ts:54`, written at `src/feedback/store.ts`); the closed vocabulary is validated on read and an unknown class fails the read closed. Three states are distinct by design: `undefined` = legacy row (unknown, not "clean"), a list without `secret` = pass ran and found none, `secret`/`path`/`oversized` present = value found and removed. Known limits: `pii` in the list still means "the PII pass ran"; prompt-injection class deliberately unused. |
| Preferences + tombstones | yes | `pref` CLI | yes | no | Deleted-ID ingestion is ignored; adopted history/conflicts/views and recurrence exclude tombstoned rows (2026-10-19 focused45/45 and independent reviews). Dataset export lists tombstone ids and drops payloads; authorized export omits tombstones unless `includeTombstones`. Raw diagnostic reader preserves stored bytes; cooperative writer lock remains required. |
| Requirement provenance + critic | yes | extraction + critique path | unit + integration (`checkpoint-d`) | no | Every deliverable/constraint/criterion sourced or assumed; critic reports omissions and is immutability-tested; never mutates the accepted contract. |
| Context packet fidelity + grounding query | yes | packet compile path | unit + integration (`packet-fidelity`, `checkpoint-d`) | no | Mandatory items keep full fidelity under adequate budget; `queryPacketGrounding` answers from the packet without the parent transcript. |
| Run-scoped observation store + offline projection (PR-B) | yes | library origin; live native wiring is tracked separately in the Native Pi delegation row | unit + integration (`observation-store`, `observation-projection`, `observation-lifecycle`) | no | Opaque-id archive under `runtime/runs/<runId>/observations/objects/` (`obs_v2_` locators, exact-byte dedupe, byteLength-only recall per ADR-008); `delete --run` cascade clears it. The original PR-B slice was library-only; native live wiring landed separately on 2026-09-20 and remains default-off. |
| Trusted execution closed loop (G2) | yes | library API (`openClosedLoop` / `createConfiguredPiExecutor` + `createWorktreeCodingTools`); **not** default CLI | library + HTTP/SSE loopback integration (`test/integration/execution/pi-closed-loop.test.ts`); live-provider **not** verified | no | Scripted OpenAI-compatible loopback drives real Pi agent tool path (read→write→report); host `runClosedLoopCheck` is the independent gate. Marked `loopback / no live LLM`. Default CLI wiring and paid provider smoke remain out of scope. |
| Evaluation identity + independence | yes | `createEvaluationRecord` | unit + integration | no | Records carry target artifact/version and independence class; missing outcomes stay Unobserved, never fabricated. |
| Telemetry attribution | yes | `invocations.jsonl` round-trip | unit + integration (`pi-telemetry`) | no | Pricing catalog version separate from usage; retry/cache/timeout/cancel attributable; taxonomy versioning never rewrites history. Loop 2: every write to `invocations.jsonl` goes through the single locked writer surface `src/telemetry/invocation-log.ts` (validating append, fail-closed on a malformed record); `cost-calibration` re-exports the path from it so writer and reader cannot disagree on the location; reads stay lock-free. |
| Severe safety one-offs | yes | pattern detector | unit (`patterns.test.ts`) | no | Single explicit severe safety events surface as one-off readiness findings below the recurrence floor. |
| Checkpoint F-SIM | machinery | experiments | simulation tests | no | Must not close F-PROD. Paired utility is identically observed on both arms (`observedUtilityOnBothArms`), so utility delta is always 0. Selection disagreement rate and cost delta are the informative simulation metrics. |
| Checkpoint F-PROD | no | no | no | no | Sealed holdout still open (ADR-005). PS-P4 trusted-experiment machinery landed (equivalent arms / freeze / ledger dedupe / oracle / keep-raw evidence) — does **not** close F-PROD or claim Week-1 seal. |

## Policy gates (human)

Decision packages with per-gate evidence: [2026-08-21 gates readiness](reports/2026-08-21-gates-readiness.md).
Current F6 prerequisite reconciliation: [2026-09-18 delivery gate record](reports/2026-09-18-delivery-gate-unblock.md). Public drafts and ESTIMATE prices exist; custody completeness, validity ruling, key metadata, runner readiness and seal remain open. No F-PROD closure or live-adaptation permission follows from PR CI/merge.

| Item | Owner | Inputs | Exit | Verify |
|---|---|---|---|---|
| ADR-004 | product + privacy | this matrix, adaptive spec | Accepted 2026-08-21 | Status line in `docs/decisions/0004-controlled-adaptation.md` is Accepted |
| Six adaptive defaults | product | spec § Decision required | Approved 2026-08-21, unchanged | `docs/specs/adaptive-agent-work-loop.md` § Decision required |
| ADR-006 | product | native integration + owner scope B | Revisited and Accepted 2026-09-18: thin native adapter, no credential/permission mutation; live adaptation gates unchanged | Status line in `docs/decisions/0006-pi-extension-reverse-adapter.md` |
| P0 privacy dictionary | runtime + privacy | `src/privacy/record-classes.ts` (19 classes; plane layout + delete cascade implemented 2026-08-22, see [review package](reports/2026-08-22-p0-privacy-review-package.md) §7; cascade extended 2026-08-24 — `summary` strip, invocation-log rewrite, episode-lock removal, `catalog-observed` invalidation) | **Closed 2026-08-26** by [technical re-verification](reports/2026-08-26-p0-technical-reverification.md): Q1/Q2 tests green. An independent privacy-officer countersign remains welcome but no longer blocks the Developer Preview. | `pnpm test -- test/unit/privacy/ test/integration/cli/delete.test.ts` |
| Checkpoint D | adaptive | remaining M3 leftovers | Closed 2026-08-21: whole-checkpoint scenarios pass (`test/integration/m3/checkpoint-d.test.ts`), M3 leftovers closed | `tasks/adaptive-todo.md` |
| Checkpoint F-PROD | routing | sealed holdout, paired utility CI | 95% utility-delta LCB > 0 and cost-delta UCB ≤ 0 | ADR-005; do not start before P0 + Provider smoke |
| Checkpoint G Outcome-supported | routing | F-PROD | Held-out benefit without guardrail regression | Forbidden until F |

Live R1, bandit, and topology stay off the execution path until F-PROD closes.

## Fresh-ledger completed-check archival (2026-10-20)

Explicit host-only schema2 mode is integrated and independently reviewed. Root27 pass/1 existing Windows skip includes actual1026 filesystem check lifecycles; exact historical-source publication tests pass. Full records and unresolved effects remain, with finite1024/4096/8MiB bounds. No automatic migration, arbitrary-old-host isolation or containment claim. Final integrated gate/probes and packed consumers passed; see the dated final local acceptance. [Guide](check-archive.md) · [Evidence](reports/2026-10-19-staged-continuation.md).

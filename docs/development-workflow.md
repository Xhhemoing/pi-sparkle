# Development Workflow

Use this workflow for project-specific planning, integration, verification and delivery. General collaboration rules live in AGENTS; current scope and owner decisions live in `tasks/plan.md` and accepted ADRs. Historical plans, archived reports and generated STATUS do not authorize execution.

## 1. Intake and Classification

Confirm the effective workspace, branch/HEAD, relevant existing changes and the active plan's current execution checkpoint before implementation. If the checkout predates the integrated result, select a suitable clean checkout or reconcile the relevant changes before dispatch; keep active worktrees and their write ownership intact. Read the dated evidence only for the next unresolved question. Classify the work as analysis, documentation/process, behavior change, experiment or release; apply checks for that scope rather than every workflow step to every request.

For non-trivial implementation, update the existing plan with the user outcome, scope/non-goals, next usable end-to-end result, dependencies, observable acceptance, affected paths and relevant verification. Reuse the [plan template](templates/task-plan.md) as a content guide, not a new form or per-slice file. Read-only questions need no implementation plan or runtime gate.

Preserve original Soul, synthetic/private-evidence boundaries, frozen capabilities and all unresolved safety duties. Existing paid-provider, crash, benchmark, holdout, installation, release and main-merge authorization remains separate. Register any authorized experiment's inputs, model, permissions, order, independent acceptance and measurement boundary before running it.

## 2. Source of Truth and Persistence

Runtime and test PRs must not modify `tasks/plan.md` or `tasks/todo.md`. Put their scope, commands, outcomes and review evidence in the PR description. After merges, the coordinator updates plan/checklist state separately in a docs-only change, editing the current checkpoint rather than appending receipt paragraphs.

Resolve conflicts using accepted ADR/spec and explicit owner decisions, current plan/checklist for authorized scope, actual candidate/source/PR/CI for execution facts, and `docs/status-matrix.md` for scoped capability claims. A dated capability row cannot erase newer observed failures; tests cannot grant approval. Resolve discrepancies in existing authoritative records before claiming completion.

Keep current phase and next action in the active plan, unfinished work in `tasks/todo.md` (at most 25 lines), and exact validation/review in the PR and CI artifacts. Generated STATUS is an ignored local snapshot: run `pnpm status`. CI generates `.agent_workspace/ci/STATUS.md` and includes it in existing quality/CLI job artifacts; see [retrieval guidance](../tasks/plan.md#retained-evidence-and-unfinished-obligations). A fresh checkout does not require this file. Private logs, transcripts and triage belong in `.agent_workspace/`; no credentials or unredacted private data in Git or uploaded artifacts.

## 3. Plan Before Implementation

Choose the next result along the actual user flow, including its public entrypoint and integration dependencies. Build the required components toward that result; run the real seam early rather than leaving integration until every component is complete. A first usable path does not remove the phase's error, recovery, compatibility or safety exits.

Assign disjoint write ownership and explicit dependencies. Share only necessary context; serialize shared interfaces, schema/lock files, authorization and transactions. The coordinator integrates completed work before growing the implementation queue and alone schedules full builds/gates/packages.

In the existing task description, make the worker's actual tools and the host's checks explicit. A file-only worker edits the candidate and leaves unavailable verification UNOBSERVED; it must not invent PASSED/FAILED results. The host runs the declared exact-candidate checks. Select a check recipe that preserves the task's acceptance and fits its existing budget, using applicable baseline/preflight measurements. Reuse those measurements until the recipe, inputs or environment changes; this is not an additional probe before every task. If the recipe cannot fit, correct the task/check selection before model dispatch rather than retrying an unchanged worker, increasing the fixed cap or weakening coverage. See [TaskSpec preparation and execution](taskspec.md#run-with-configured-pi-from-the-cli).

Review high-risk seams early: authority, source/candidate identity, settlement, remaining budgets and recovery. Findings that violate existing acceptance, compatibility or safety are repairs; unrelated improvements return to existing deferred work. If a public contract or authorization must change, update the relevant plan/ADR and obtain the applicable owner decision before crossing that boundary.

## 4. Test-First Implementation

For a behavior change or bug fix, demonstrate the intended failure, make the smallest repair, then run its regression and affected neighboring checks. Include the directly related input boundaries exposed by the same cause before another model attempt or review; a passing narrow example does not settle that failure class. Preserve actual behavior assertions; mocks or startup smoke do not replace execution. Documentation and instruction edits use content/structural checks rather than invented runtime regressions.

When blocked, state a testable cause and choose the smallest experiment that distinguishes it. If the next retry cannot add evidence, retain the failure, unknown cause and condition for resumption, then advance independent authorized work. Rerun after an actual fix or changed condition; a focused pass does not erase a failed full run.

## 5. Verification Gates

Choose verification from changed behavior and risk; retain existing required checks:

| Change | During implementation | Integrated delivery verification |
|---|---|---|
| Docs/templates/skill instructions | workflow/diff, relevant content/links and changed skill validator | targeted review and current remote CI; no local runtime gate solely for prose |
| Pure logic | failing regression, focused units and typecheck | hosted CI complete suite |
| CLI/persistence/lifecycle | actual affected entrypoints and integration/negative cases | hosted CI; safety core (scope, candidate/apply/discard, Ledger, budgets, cancellation) also one serial `pnpm gate` and relevant probe |
| Real-task run (ADR-011) | registered task, budget, isolated copy for Soul | private task record; aggregated statistics at review |
| Privacy/security/adapter | boundary regressions and relevant independent review | `pnpm gate`, `pnpm security:probe`, `pnpm pi:probe` |
| Experiment/holdout | authorized preregistration, eligibility and actual observations | existing dedicated evidence; self-optimization only within the ADR-011 loop |
| Preview/release | applicable complete checks and probes | `pnpm prerelease` and separate release authority |

Run inexpensive relevant type, lint and boundary checks before an expensive complete run. Schedule the complete run when the intended integration is ready; a failing integrated candidate still needs its required complete revalidation after repair. Do not restart a full run for every small edit or treat a run of an older candidate as validation of later changes.

Reuse evidence only when the candidate, checked inputs, environment and coverage still apply. A new change, failure or unresolved concern determines what to rerun. Never stitch focused checks into a complete gate claim or weaken protected checks to manufacture green. Keep one full build/gate/package at a time and preserve shared dependencies while it runs.

PR results identify candidate/environment, exact commands, pass/fail/skipped/not-run/not-applicable, inherited failures and artifact links. Preflight is not runtime success; green tests or CI do not close human or experiment approval.

## 6. Review and Delivery

Complex cross-module, authorization, security and data-correctness changes require independent read-only review of the actual candidate/diff. Reviewers report concrete defects and counterexamples, without making unrelated product expansion a blocker. After a repair, verify the original counterexample and review affected changes when needed; no fixed rounds of unchanged whole-repository review.

Inspect final scope for accidental private data, conflict markers, generated artifacts and frozen-surface changes; use required pinning-test review. Agent-authored conflict resolutions still require line-by-line human conflict-hunk review before commit/push. Never invent an independent review or infer human adoption from green.

## 7. Closeout and Handoff

Close only the agreed scope after its acceptance and required review. Keep remaining phase exits, failed/unknown evidence and owner decisions explicit. Exact commands/results belong in the PR/CI; update the current checkpoint in the existing plan so it supersedes older pending/next-action statements, remove only completed checklist entries, and generate STATUS with `pnpm status`. No per-slice reports, receipt-only commits or automatic history deletion; owner-authorized cleanup must check dependencies and preserve needed Git-history references.

A delivered candidate has its remote branch and current green CI; retain a failed or missing CI condition rather than calling it delivered. Main merge, release and original Soul application keep their existing authorization. Leave the next executable action and necessary evidence links so another session can resume without replaying completed effects or reading chat history.

## 8. Process Health

Improve this workflow only for a concrete recurring failure or material risk. Prefer correcting stale guidance, execution timing, ownership or integration order before adding mechanisms. Use existing Git/CI/plan evidence to observe time to the first usable flow, late integration defects, avoidable complete reruns and manual rework. Do not claim a speedup or infer skill use from counts or missing telemetry; validate proposed benefits in actual subsequent work.

### Capture task-authoring and review time

Use the existing record script for ADR-011 attempts. Start timing before writing the TaskSpec, include `taskSpecMinutes` when creating the record, and backfill `phases.review` after review. Creation accepts seconds or timezone-qualified start/end timestamps for phases; `--update` accepts only review-phase timing, never replacement execution/cost observations or task-authoring time. Keep unmeasured phases `unknown`. The elapsed `task run` command includes preparation, worker and host checking: retain that wall time in existing `notes` if useful, rather than reporting it all as model time or adding overlapping measurements.

The following operator example uses a separate private synthetic root and no model calls. Keep the same PowerShell session. Start the clock before authoring; continue with the next block when the task description is ready. For real work, use the actual task identity/metadata and captured `--projection`/cost evidence described by `node scripts/real-task-record.mjs`'s source usage; do not mix this sample with the live attempts.

```powershell
$ErrorActionPreference = 'Stop'
$sampleRoot = Join-Path (Get-Location) ('.agent_workspace/efficiency-example/' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $sampleRoot -Force | Out-Null
$taskClock = [Diagnostics.Stopwatch]::StartNew()
```

After authoring, create the synthetic refused attempt, then start review timing:

```powershell
$ErrorActionPreference = 'Stop'
$taskClock.Stop()
$identity = @{ id = 'timing-example'; date = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::UtcNow, 'America/Los_Angeles').ToString('yyyy-MM-dd'); source = 'pi-sparkle'; arm = 'sparkle' }
$metadata = $identity.Clone()
$metadata.objective = 'Exercise task-authoring and review timing without a model'
$metadata.status = 'REFUSED'
$metadata.taskSpecMinutes = $taskClock.Elapsed.TotalMinutes
$metadata.phases = @{ prepare = 'unknown'; model = 'unknown'; check = 'unknown'; review = 'unknown' }
$metadataFile = Join-Path $sampleRoot 'attempt.json'
$metadata | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $metadataFile -Encoding UTF8
node scripts/real-task-record.mjs --root $sampleRoot --metadata $metadataFile
if ($LASTEXITCODE -ne 0) { throw 'Record creation failed' }
$reviewStart = [DateTimeOffset]::UtcNow.ToString('o')
```

Review the candidate and evidence, then stop the clock. This example retains a refusal; it cannot demonstrate a correct delivery. A real review update supplies its actual `reviewed`, `kept`, `interventions`, `escapedDefects` and evidence observations as appropriate. Omitting `notes` preserves any previously recorded wall-time note.

```powershell
$ErrorActionPreference = 'Stop'
$reviewEnd = [DateTimeOffset]::UtcNow.ToString('o')
$review = $identity.Clone()
$review.phases = @{ review = @{ start = $reviewStart; end = $reviewEnd } }
$reviewFile = Join-Path $sampleRoot 'review.json'
$review | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reviewFile -Encoding UTF8
node scripts/real-task-record.mjs --root $sampleRoot --metadata $reviewFile --update
if ($LASTEXITCODE -ne 0) { throw 'Review update failed' }
$localDate = [datetime]::ParseExact($identity.date, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
$monday = $localDate.AddDays(-(([int]$localDate.DayOfWeek + 6) % 7)).ToString('yyyy-MM-dd')
node scripts/real-task-summary.mjs --root $sampleRoot --week $monday --weekly-limit-usd none --json
if ($LASTEXITCODE -ne 0) { throw 'Summary failed' }
```

Read `week.taskSpecMinutes` and each `week.phases` entry as `{knownTotal, unknownAttempts}`. A partial known total is not complete elapsed time; retain missing observations and use later comparable tasks to evaluate any speed benefit. This example leaves preparation/model/check and total reference cost unknown.

## 9. Real-task resource proposals (development only)

`scripts/real-task-adapt.mjs` adapts existing private task records to the lab ResourceRegistry. Its `propose`, `materialize` and `evaluate` operations never execute commands or call a model. Only the explicit `execute` operation below runs a reviewed fixed model recipe through the original TaskSpec flow. The adapter does not change public routing-only `adapt learn/eval`, register baselines or promote resources. The owner must approve runtime adoption and exact resource promotion before use.

Select one failure class from an R2 review and save its existing record paths in a JSON array. `propose` builds a seeded proposal for the selected topic; it does not infer a cause from arbitrary successful records. Supported topics are `host-only-checks`, `input-validation`, `node-preparation`, `check-recipes` and `model-thinking`.

```powershell
$ErrorActionPreference = 'Stop'
$labState = Join-Path $PWD '.agent_workspace/resource-review'
$originalProject = 'E:/Project/pi-sparkle'
node --import tsx scripts/real-task-adapt.mjs propose `
  --state-root $labState --project $originalProject `
  --topic host-only-checks --input .agent_workspace/source-records.json |
  Set-Content .agent_workspace/proposal.json -Encoding UTF8
```

`--project` identifies the original project, not each disposable source clone. Soul uses its own original project identity and isolated copies; never combine its task count under a pi-sparkle resource. Keep inputs, outputs and registry state private. A `needs-baseline-approval` packet leaves the registry uninitialized. An approved empty-guidance baseline represents the unchanged TaskSpec; existing explicit registry/promotion/rollback APIs retain their authority and CAS rules.

Set `$sourceRevision` to the full registered source SHA and `$versionId` to the owner-approved resource version. After owner approval, `materialize` reads the active version once and returns an authoring artifact containing `baseSpec`, `spec`, and resource bindings. Save that artifact, review its `spec`, then explicitly execute that spec through the existing TaskSpec flow. Prompt materialization changes only the objective text. The check-recipe path below changes only explicitly authorized Node launcher wiring; neither path can rewrite scopes, reduce business coverage or change budgets.

```powershell
node --import tsx scripts/real-task-adapt.mjs materialize `
  --state-root $labState --project $originalProject `
  --input .agent_workspace/base-task.json --task-id P06 `
  --revision $sourceRevision --topics host-only-checks |
  Set-Content .agent_workspace/materialized.json -Encoding UTF8
$materialized = Get-Content .agent_workspace/materialized.json -Raw -Encoding UTF8 | ConvertFrom-Json
$materialized.spec | ConvertTo-Json -Depth 100 |
  Set-Content .agent_workspace/task.json -Encoding UTF8
```

Use the same logical ID as the later task record's `comparisonId`. Evaluate one resource delta at a time. The evaluation input is an array of objects naming `recordFile`, `inputFile` (saved materialization), `contractFile`, `eventsFile`, and the actual `checkFile`. All paths refer to existing private evidence. Keep failed and unknown attempts; changed operator labels cannot turn a repeated real run into a new attempt or task.

```powershell
node --import tsx scripts/real-task-adapt.mjs evaluate `
  --state-root $labState --project $originalProject `
  --topic host-only-checks --version $versionId `
  --input .agent_workspace/trial-files.json |
  Set-Content .agent_workspace/evaluation.json -Encoding UTF8
```

Evaluation binds actual task objectives, verifier definitions, source/run identities and later run events. Missing or conflicting checks cannot produce a successful delivery score. Model/thinking and non-check budgets remain operator-recorded comparison inputs, not independently reconstructed execution facts. Five distinct later applicable tasks permit a descriptive `better/worse/unclear` conclusion, not causal proof or ADR-010 benefit acceptance.

For a `check-recipes` proposal, provide `--check-launchers <JSON file>` with the exact conversions to review. Their values become part of the existing immutable candidate content and content hash; a mutable file path or authority label is not review evidence for new conversion values. For example, this conversion applies only to an original check whose command is already the bare `node`:

```json
[
  {
    "id": "explicit-node",
    "fromCommand": "node",
    "fromPrefixArgs": [],
    "command": "C:/Program Files/nodejs/node.exe",
    "prefixArgs": []
  }
]
```

Use the actual authorized Node path, rather than copying this example blindly. Do not weaken an already correct absolute launcher to manufacture a baseline failure. P06/P07's existing business-plus-unit checks and S06's combined UI check remain complete requirements; these preparation inputs are not later real-task adoption or improvement evidence. Preparation-only experiments, including a Windows native `--import C:\...` ESM scheme failure corrected to a `file:///...` URL, must not be relabeled as real model attempts or R2 task records.

The unchanged check-recipe baseline content is `{"topic":"check-recipes","mode":"preserve","launchers":[],"sourceRefs":["owner/existing-checks"],"expectedEffect":"Keep all original checks unchanged"}`. Baseline registration is still a separate explicit decision. A candidate uses `mode: "host-bindings"` and nonempty fixed `launchers`; `propose` never initializes that baseline or activates the candidate.

For materialization, provide `--check-bindings <JSON file>`. Its `authorityRef` identifies the host's prior authorization, `originalChecks` contains the complete original TaskSpec checks, and `selections` names exactly one approved launcher for every original check ID:

```powershell
$baseTask = Get-Content .agent_workspace/base-task.json -Raw -Encoding UTF8 | ConvertFrom-Json
@{
  authorityRef = 'private/authorized-check-launchers'
  originalChecks = $baseTask.checks
  selections = @($baseTask.checks | ForEach-Object {
    @{ checkId = $_.id; launcherId = 'explicit-node' }
  })
} | ConvertTo-Json -Depth 100 | Set-Content .agent_workspace/check-bindings.json -Encoding UTF8
node --import tsx scripts/real-task-adapt.mjs materialize `
  --state-root $labState --project $originalProject `
  --input .agent_workspace/base-task.json --task-id P06 `
  --revision $sourceRevision --topics check-recipes `
  --check-bindings .agent_workspace/check-bindings.json |
  Set-Content .agent_workspace/materialized.json -Encoding UTF8
```

This selection example requires every original check to match that conversion; mixed launchers need their own exact approved entries. Missing, duplicate or extra check IDs and new command fields in selections are refused. A conversion replaces only an exact leading Node `--import` pair (or the empty prefix), preserving the complete remaining business argv, IDs, expectations, visibility, dependency protection and all limits. Replacement `--import` modules must be absolute local file URLs, including on Windows; package names, relative specifiers and native Windows paths are not accepted as replacement modules. No shell, eval flags, test filters, arbitrary argument patch or omitted checks can be introduced through a launcher prefix. Materialization performs no execution or installation.

Check-recipe evaluation verifies each version's own exact actual checker. It compares the unchanged full original checks and other existing comparison inputs, rather than demanding identical launcher argv across versions. An existing promotion review with `reviewerKind: "independent"`, bound to the exact candidate ID, author and content hash, must review business equivalence of those fixed conversions; code does not infer executable equivalence from a Node filename or different argv. Without that review, consumption and outcomes remain visible but comparison is `unclear`. Changed import-module prefixes also remain `unclear`: current evidence binds consumed argv, not the imported module's stable implementation/version. Acceptance is never relaxed by this comparison logic, and failed, duplicate, missing or unknown evidence keeps the existing handling.

Node preparation is deliberately unproven here: materialization requires an already authorized fixed recipe in `TaskSpec.prepare`, but current preflight records do not bind its actual command/argv. Its evaluation remains `UNOBSERVED` and does not satisfy the five-task exit. No automation is enabled by these tools.

### Fixed model/thinking recipes

`model-thinking` is a fixed `workflow-template`, without conditions or routing rules. `propose --model-selection <JSON>` takes exactly `{ "providerId": "approved-provider", "modelId": "approved-model", "thinkingLevel": "high" }`; source records and an expected effect enter the existing candidate/review/CAS/rollback path. A provider timeout alone does not show another model is better. Dynamic routing policies retain their existing replay-review requirements and cannot be expressed through this recipe.

After specific promotion, materialize with `--topics model-thinking`. Its private `modelSelection` records the requested triple; `baseSpec`, `spec`, objective, checks, scope and budgets stay unchanged, and TaskSpec keeps `worker.model: "inherit"`. Materialization grants no authority and never executes. Use a separately supplied trusted host approval file with exactly `authorityRef` and `approvedSelections` (an array of the approved triples). A resource, TaskSpec or candidate cannot supply that authority or credentials.

```powershell
$ErrorActionPreference = 'Stop'
node --import tsx scripts/real-task-adapt.mjs execute `
  --state-root $labState --project $originalProject --source $isolatedSource `
  --input .agent_workspace/materialized-model.json `
  --model-authority .agent_workspace/host-approved-models.json
```

The host explicitly selects the isolated committed source separately from the logical project identity; original Soul remains protected. The state root must already contain the adopted registry and approved provider configuration. Execution rejects a changed active version/source, mismatched project, multiple worker attempts, missing or above-US$5 reference budget, disabled/unapproved selection or another provider. It reuses original task-run context, strict SDK pricing/budget, cancellation, sink flush, settlement and independent acceptance; candidates are retained with no apply/review stdin. Fixed selection overrides ambient model/thinking for that invocation, disables implicit fast fallback and changes no process environment, defaults or credentials. Normal task-run behavior stays unchanged.

For evaluation, include `loopFile` alongside the actual contract/events/check references. The complete supported native-attempt/report population, parent-child request/agent binding and every SDK dispatch index must match the version's fixed provider/model/transport-thinking; operator model labels are not evidence. Missing, duplicate, extra or mixed submissions remain `UNOBSERVED`. Observations show host transport submissions only, not the server's internal model/reasoning or a successful response. All native cost faults conservatively remain `UNOBSERVED`, including `incomplete-usage`/`unknown-reference`: the current producer stores only its first fault, which cannot exclude a later identity fault. No price calculation or complete-cost claim is added; failed outcomes and unknown fees stay in the denominator.

Only this family permits its declared model/thinking difference. Every logical task needs matched parent/candidate committed source and full original TaskSpec; independent review of the exact version remains required. An unchanged profile, altered controls, missing pairs or insufficient later tasks yields `unclear`. Conclusions describe correct-delivery observations, without a causal, speed or ADR-010 benefit claim.

This adapter covers prompt guidance, bounded check-launcher recipes and a single-attempt fixed model/thinking execution path. General TaskSpec defaults, actual context-rule consumption, Node preparation argv evidence, specific model/thinking resource adoption and later-task outcomes remain unfinished R3 work; synthetic checks do not complete those exits.

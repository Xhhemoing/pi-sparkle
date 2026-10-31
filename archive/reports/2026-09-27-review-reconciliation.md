# Optimization review reconciliation — 2026-09-27

## Identity

- Task: `TASK-20260927-reliability-optimization`.
- Scope: planning and review reconciliation; no runtime implementation.
- Inspected revision: `e1ce19c0f93d8e34e7ca25512c5d32d2743ba669`, branch `codex/controlled-improvement-20260925`; working tree was clean at intake.
- Environment: Windows, PowerShell 7, Node `v24.18.0`, pnpm `10.17.1`.
- Inputs: user-supplied “pi-sparkle 项目审阅与改进计划”, based on `a143aad9063cdc5d3dc969d606eae97125dcaf6e` (2026-09-20); prior conversational audit (2026-09-26); current source, tests, accepted ADRs and task records.
- The pasted report's download link and embedded citation markers do not provide an accessible evidence archive in this workspace. Its proposed tests and independent Git probes were not imported or represented as current repository tests.
- Evidence owner: current planning author. No new independent review or human acceptance was performed.

## Reconciliation of the supplied seven findings

| Finding | Current evidence | Planning disposition |
|---|---|---|
| R1 — destructive apply rollback | `src/native/apply.ts::apply` still runs `reset --hard` both after merge failure and after unexpected HEAD. Source cleanliness is checked before candidate verification. | P0 for the apply capability. Preserve user/index/ref changes on failure. Existing HEAD-drift integration test and rollback prose must be revised together; see O01. Current session confirmed source, not a fresh destructive Git reproduction. |
| R2 — singleton native execution catalog | Superseded: `createNativeExecutor` consumes `models[]`, publishes `supportedModelIds`, snapshots credential-free capabilities, and dispatches the actual host model through host `streamSimple`. `NativeSession` checks catalog coverage before persistence. | Keep the 2026-09-25 implementation. Current HTTP/SSE secondary-provider test passes. O06 adds only missing same-provider/two-active-provider/auth and model-parameter semantics coverage. No second credential store or generic execution-context rewrite. |
| R3 — candidate directory identity | `apply` checks candidate HEAD but does not establish distinct real paths, common Git directory and registered linked-worktree identity. Registration accepts `sourceRepo` without persisting it in `StoredCandidateArtifact`. | P1, paired with O01 pre-mutation checks; durable registration binding belongs to O03 and the existing R10/R11 boundary. A path remains a locator, not authority. |
| R4 — cancellation and synchronous subprocesses | Apply only observes cancellation initially; `stat(candidate)` is followed by synchronous verification/Git commands. `runIndependentCheck` has no signal and uses `spawnSync`; coding commands also use `spawnSync`. | P1, O02. Separate cancellation before source mutation from an update whose result must be reconciled. |
| R5 — disposal across fresh sessions | `applyIssuedCandidate` and `disposeIssuedCandidate` instantiate different `NativeApplySession`s; the latter's `managed` set is empty. Only foreign-path disposal is currently unit-tested. | P2 lifecycle bug, O03. Preserve ownership checks; test restart/reconstruction and actual removal. The helper exists, but no additional disposal tool should be registered implicitly. |
| R6 — read limit after allocation | `worktree-coding-tools.ts` still reads the complete file before checking its length; native limit remains 32,000 bytes with no paging parameters. | P1 resource bounding / P2 usability, O06. Limit actual bytes read and expose page semantics without promising immutable-file identity from metadata alone. |
| R7 — approximate observation counter key | Superseded: `store.put` uses exact-byte dedupe, returns an opaque `obs_v2_` ID, and `sendCounts` keys by `ref.id`. The middle-only-mutation regression passes. | No content-digest fix. ADR-008 forbids a replacement cryptographic hash. O06 addresses the separate remaining context-scope question: a run-shared counter does not prove a particular worker has seen the full text. |

Additional supplied concerns retained: quoted Windows paths in `/sparkle-issue-candidate` (`split(/\s+/)` remains); cancellation/process cleanup across platforms; candidate/evaluator authority; cross-child budget limitations; measured outcome evidence. These are assigned in the plan, not assumed newly authorized features.

## Reconciliation of the prior 16-item audit

The prior audit covered selected high-risk modules, not a line-by-line proof over every source file. Prior agent probes whose raw output was not archived are leads; the source checks and fresh commands below define this planning session's evidence.

| ID | Finding / source | Evidence and next step |
|---|---|---|
| A01 | Append rereads all JSONL; `src/persist/jsonl.ts::repairCrashTruncatedTail` | Source-confirmed. O07: bounded tail read, preserve recovery and fsync. Measure bytes, not only elapsed time. |
| A02 | Offset reader rereads/scans prefix; `readJsonlObjectsFromOffset` | Source-confirmed. O07: read boundary byte and suffix; count preceding lines only when required to report an error. |
| A03 | Projector bind outside NativeSession cleanup | Source-confirmed. O02: setup failure cancels and settles child, removes active entry/listener. |
| A04 | Control files sorted by random request ID | Source-confirmed ordering; FIFO intent is not established by the type. O08b must specify sequential-submit semantics and concurrent tie handling before changing persistence. A monotonic sequence is not automatically required. |
| A05 | Unbounded event array and `shift()` | Source-confirmed. O08a: indexed dequeue first; queue limits/coalescing only after measuring pressure and accounting for Pi settlement listeners. No silent event loss. |
| A06 | Logit reference depends on first-seen row order | Source-confirmed. O09: fix design/bootstrap ordering and reference contrast semantics. Sorting labels alone cannot remove the reference-as-zero diagnosis bias. Prior numerical probe is not a fresh result here. |
| A07 | Repeated paired episode inflates confidence | Fresh in-memory probe reproduced: one unique episode repeated five times gives counts 5, degenerate positive CI, `canCloseProductionCheckpointF=true`, validator valid. O05. This is a wrong eligibility result, not proof that a real F6/owner gate was closed. |
| A08 | Anchor-based cluster depends on input order | Source-confirmed. O09: specify deterministic clustering semantics and preserve severe one-off/negative-control rules. Average similarity below the anchor threshold alone is not proof of violating a documented pairwise threshold. |
| A09 | Unbounded canonical-string ledger/full rewrite | Source-confirmed. O10: measure and bound reads, preserve all dedupe identities; do not evict old IDs to manufacture boundedness. Storage redesign is contingent on measurements and crash-replay tests. |
| A10 | Auto-loop rescans directory and persists before dedupe | Source-confirmed. O10: duplicate ingestion, incomplete reads, feedback/bandit crash boundaries. No new cursor or fact store by default. |
| A11 | Registry duplicate IDs/partial restore | Source-confirmed. O04c: validate unique keys and relationships before replacing live maps; rejection must preserve previous state. |
| A12 | Provider config unlocked read-modify-write | Source-confirmed; prior Windows EPERM reproduction was reported in chat, not rerun here. O04b: use existing cooperative-lock facility around the full update; distinguish config lost updates from low-level atomic rename. |
| A13 | Privacy `statExists` swallows all errors | Source-confirmed. O04a: distinguish absence from inaccessible state, propagate or disclose partial failure. Cannot infer successful erasure after EACCES. |
| A14 | SECURITY_WAIVER bypasses documented expiry/release register | Source-confirmed against `docs/specs/release-gate.md`. O11: repair the existing release-boundary check. Do not add another gate. |
| A15 | Provider numeric fields accept invalid values | Source-confirmed. O04b: finite/range/duplicate-ID validation before writing; preserve valid zero pricing and absent pricing. |
| A16 | Workflow checker checks existence/headings/substrings | Confirmed limited assurance; lower-priority process issue. O11 first reconciles real contradictory active status text. A larger Markdown policy engine is not justified by hypothetical hostile edits to trusted repository files. |

## Contract corrections that affect the plan

1. ADR-008 removed SHA-256 and runtime integrity checks. Current artifacts and worktree fingerprints do not provide the older report's hash-based content integrity. Same-length replacement is explicitly undetected on some paths. New hashes, frozen contracts, baselines and gates are not authorized by this plan.
2. `validateComparisonReport(report)` has no underlying records and therefore cannot independently check episode uniqueness. Reject duplicates at construction and require records/recomputation at an acceptance consumer; a structural report validator must not be described as independent evidence verification.
3. The existing apply HEAD-drift test expects restoration of the old revision even after a third-party commit. Preserving user changes requires a dated contract correction, new adverse-interleaving tests, and revision of that expectation, not simply deleting the test.
4. Current controlling roadmap: B0 accepted at `dd8f13f7`; D1 author candidate unreviewed; S0-min owner package ready but not approved/frozen; L1/L2/final review planned. Older statements in `tasks/plan.md`, `tasks/todo.md` and adaptive records remain historical where inconsistent. This plan follows the dated controlling roadmap and does not close those tasks.
5. R10/R11 production apply authorization and F6 remain separate. Unit tests, local HTTP/SSE tests and an eligibility boolean cannot close them.

## Commands

All commands ran in `pwsh` with `$ErrorActionPreference = 'Stop'`. Captured logs use UTF-8 under `.agent_workspace/verification/2026-09-27-optimization-plan/`.

| Command | Result | Evidence / limits |
|---|---|---|
| `git status --short`; `git rev-parse HEAD`; `node --version`; `pnpm --version` | PASS | Clean intake; revision and versions above. |
| `pnpm test -- --test-concurrency=1 test/unit/pi-adapter/native-executor.test.ts test/unit/pi-adapter/observation-tools.test.ts test/unit/native/routing-catalog.test.ts test/unit/native/apply.test.ts test/unit/native/apply-registration.test.ts` | PASS | 32 pass / 0 fail / 0 skip, 41.44 s. `current-native-focused.log`. Existing refusal tests do not cover concurrent apply mutation or successful cross-instance disposal. |
| In-memory duplicate-pair probe using `node --import tsx --input-type=module` | Defect reproduced | `duplicate-pair-probe.log`; no repository or production data modified. Reproduction input below. |
| `pnpm test -- --test-concurrency=1 --test-name-pattern='seeded row mutations preserve pause-token decoder error discipline\|seeded row mutations preserve checkpoint parse and validation error discipline' test/unit/persist/row-fuzz.test.ts` | PASS | 2 pass, 2.65 s total. `row-fuzz-focused.log`. In the actual PowerShell command the `\|` displayed here is an unescaped `|` inside single quotes. |
| `pnpm gate` | NOT RUN this session | Prior 2026-09-26 run: 2877 pass, 0 assertion failures, 2 cancelled by 20 s timeout, 18 skip; gate failed and build was not reached. Concurrency/resource contention is a hypothesis, not a diagnosed cause. |
| `pnpm workflow:check`; `git diff --check` | PASS | Workflow: 10 required files, 16 required headings. Tracked diff: no whitespace errors; existing CRLF-to-LF notices only. New-file whitespace and link checks recorded in Closeout. |
| Live provider / holdout / benchmark / production apply | NOT RUN | No claim of cost benefit, F6 acceptance, release or live write authorization. |

Duplicate-pair reproduction (feed to Node through a PowerShell single-quoted here-string):

```js
import { computeComparisonReport, validateComparisonReport, DEFAULT_COMPARISON_REPORT_CONFIG } from './src/experiments/comparison-report.ts';
import { createEvaluationCard } from './src/experiments/evaluation-card.ts';
const row = { episodeHash: 'one-episode', taskFamily: 'bugfix', baselineUtility: 0.2, candidateUtility: 0.8, baselineCostUsd: 1, candidateCostUsd: 1 };
const card = createEvaluationCard({ domains: ['bugfix'], difficultyTiers: ['easy'], metrics: ['utility', 'cost'], baseline: { utility: 0.2, costUsd: 1, uncertainty: 0 }, candidate: { utility: 0.8, costUsd: 1, uncertainty: 0 }, guardrailViolations: [] });
const config = { ...DEFAULT_COMPARISON_REPORT_CONFIG, evidenceClass: 'production' };
const report = computeComparisonReport(Array.from({ length: 5 }, () => ({ ...row })), card, [], config);
console.log({ rawCounts: report.rawCounts, canCloseProductionCheckpointF: report.canCloseProductionCheckpointF, validation: validateComparisonReport(report, config) });
```

## Closeout

Planning state: `ready-for-review`; implementation tasks remain `planned`. `pnpm workflow:check` and `git diff --check` passed on 2026-09-27. New plan/report links resolve, and all referenced existing implementation paths resolve. Three paths are explicitly planned additions, not missing dependencies: `src/execution/command-runner.ts`, its unit test, and `test/unit/package/security-waiver.test.ts`.

The wider link inspection also found two pre-existing broken links in `tasks/todo.md`: `../reports/2026-09-22-stage0-boundary-correction.md` and `../docs/reports/2026-09-22-pi-self-review.md`. They were not introduced by this slice and remain O11 documentation follow-up; workflow-check does not validate these links. No global all-links-clean claim is made.

Only this plan, this reconciliation report, and dated links in `tasks/plan.md` / `tasks/todo.md` changed. No runtime implementation, commit, independent review, merge, live-provider call or production operation is claimed.

Handoff: [consolidated optimization plan](../superpowers/plans/2026-09-27-reliability-optimization.md), [active plan](../../tasks/plan.md), [active checklist](../../tasks/todo.md).

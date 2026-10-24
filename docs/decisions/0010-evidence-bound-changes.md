# ADR-010: Evidence-bound changes for Pi

- Date: 2026-10-22.
- Status: **Accepted direction; Phase 0 implementation authorized.** This does not declare the target runtime implemented, Pi 1.x compatibility verified, a release approved or quality superiority demonstrated.
- Decision source: the owner requested revision v1.2 with defect reduction **at least 50%** and cost **at most 1.3 times** direct Pi, then explicitly instructed implementation to begin.
- Active implementation and retained evidence: [plan](../../tasks/plan.md), [unfinished work](../../tasks/todo.md), [capability status](../status-matrix.md).

## Context

The isolated synthetic Soul trials exposed useful independent-check failures and substantial task-configuration, lifecycle and verification costs. They are small, heterogeneous workflow comparisons; they do not establish a general advantage over direct Pi. The current worker constructs a pi-agent-core Agent and does not yet reproduce a user's complete coding-agent session. Existing exact-byte verification, protected-path checks, accept/apply separation and unknown-effect handling are assets to preserve while reducing the product's responsibility.

## Decision

### Product and public concepts

Keep the package name `pi-sparkle`. Its target role is **Evidence-bound changes for Pi**: let Pi perform coherent coding work, while the host defines task scope, isolates candidates, independently checks the exact candidate, and controls explicit application and effect reconciliation. Use five public concepts: TaskSpec, Candidate, Check, Verdict and Ledger. This is a public vocabulary, not an instruction to erase internal ownership, identity, budget or recovery types.

TaskSpec and the unified coding-agent executor are planned interfaces. Current supported commands and the private preview remain as documented until their implementation is tested. Future npm distribution is a direction, not publication permission. Do not claim that these capabilities are unique to this package without a sourced comparison.

### Execution and authority boundaries

| Boundary | Intended guarantee | Limitation |
|---|---|---|
| Mediated write/edit tools | Refuse paths outside the permitted scope before the write. | Requires the call to pass through the controlled tools; policy is not merely prompt text. |
| Candidate and explicitly snapshotted protected paths | Compare the final candidate bytes and reject nonconforming delivery. | A final snapshot does not prove that no transient write ever occurred. |
| Files outside observed scope, arbitrary shell, extensions, MCP/network effects | No general detection, prevention or rollback guarantee. | Restrict capabilities or use an executor with explicitly verified containment when that guarantee is needed. A worktree is not an OS sandbox. |

A worker's self-report is not acceptance. Keep trusted evidence bound to the actual candidate/checker bytes; reject stale evidence. Acceptance does not imply application. Preserve apply authorization, source freshness, unknown-effect refusal, cumulative budgets, cancellation and actual resource settlement. Ledger records intents, receipts and host reconciliation; unknown cost or outcome is never silently zero or success.

Pi compatibility and worker migration are separate changes. First test the pinned candidate version against real stop/cancel/tool and lifecycle behavior. Then migrate toward a coding-agent session with explicit model, prompt, skills, tools, context, persistence and retry ownership. A matching configuration snapshot is necessary but does not prove equivalent capability or containment. Only tested Pi versions belong in compatibility claims.

### Scope reduction and durability

Research-only routing, learning, adaptation, experiments and evaluation move out of the default runtime dependency path into a repository-local lab. Do not publish a second package yet. Keep necessary model eligibility, permissions and budgets in the execution path. Preserve prior research and exclusions; moving it is not evidence that it failed or violated its authorization. Existing P4/P5 and live-learning/promotion freezes remain.

Freeze new general-purpose self-built scheduler/durability features. Safety and compatibility maintenance remain allowed. Pi Durable is the preferred candidate for later evaluation, not a committed runtime replacement. Validate recovery, cancellation and unknown effects before removing the old implementation. Submission de-duplication does not make arbitrary external effects exactly-once; external idempotency and Ledger reconciliation remain our responsibility even after migration.

Measure the actual default import closure to guide simplification. Do not add a 10,000-line failure gate, document-percentage gate, hashes, frozen contracts or other new process machinery. Existing safety checks remain. Delete unused modules only after verifying callers and preserving relevant evidence.

### Checks and preflight

Productize the five concrete historical configuration failures as zero-model regression fixtures: unavailable context, optional writable paths, missing test dependencies, mismatched worker/final checks, and cold preparation consuming the check budget. This is a bounded acceptance target, not a promise to detect all configuration failures.

Each check declares its expected base result where applicable. A target regression can fail while formatting and existing safety checks pass. An import/compile/dependency error does not substitute for the expected behavioral failure. Preparation has its own accounting and counts toward total time/resources even when excluded from the check-only budget.

### Public evaluation and preserved targets

Sparkle-Bench is a planned 30-task evaluation: 15 public SWE-bench Verified tasks plus 15 TypeScript/Rust/Go tasks. Public test data can be withheld from the execution environment but is not inherently secret or uncontaminated. The old 15-task obligation remains separately unfinished.

Use three explicitly defined workflows: direct Pi, the Sparkle core and a lightweight verification comparator. Match model/provider/version, thinking, base task information, tools, permissions, environment and budgets; disclose host-added work. Predeclare task selection, retries and failure classification. Repeated runs measure variability; resample at the **task** level with all arms/repeats together, not as independent extra tasks.

Host checks decide acceptance. Independent held-out scoring must be unavailable to workers, hosts and plugins, including its feedback; it cannot guide selection, repair or retries. Score after every arm fixes its final candidate. Published test sets become public regression evidence for later runs.

Report correct deliveries/all registered attempts, defective deliveries/all attempts, rejections/timeouts/failures, and defective deliveries/actual deliveries. Define delivery consistently across arms; zero deliveries make the conditional rate undefined, not zero. A failed scoring check measures failure under that evaluator, not proof of every possible residual defect.

The owner retains these decision targets:

1. Correct-delivery non-inferiority: the predeclared 95% interval lower bound for Sparkle minus direct Pi is at least **-3 percentage points**. This permits that margin; it is not a literal zero-loss guarantee.
2. Conditional defective-delivery rate: observed relative reduction **at least 50%**, with the predeclared difference interval supporting improvement. With zero direct defects or an undefined denominator, relative improvement is not established.
3. Cost per correct delivery: **at most 1.3 times** direct Pi. The numerator includes all attempts, failures, rejected candidates, reviews and retries. Report cost uncertainty/coverage separately; missing billing or zero correct deliveries cannot establish the target.
4. No protected/out-of-scope changes in delivered candidates within the declared observed boundary. Report time including preparation, interventions and the boundary limitations as well.

Distinguish targets met, evidence supporting a miss, and insufficient evidence. An interval crossing the non-inferiority boundary does not establish degradation; absence of detected quality improvement does not establish an ineffective checker. Conservative delay is allowed, but causes require diagnosis. Broad claims about quality require the complete predeclared comparison; a release of honestly described isolation/audit tooling is distinct from a superiority claim.

Start with fake/loopback verification. Paid calibration and important-release evaluations require confirmed real channel prices and an explicitly authorized cumulative spend ceiling. This implementation instruction is not standing authorization for nightly paid models or release benchmarks. No monetary estimate in the plan is a verified bill.

## Relationship to prior decisions

| Existing decision or plan | Treatment |
|---|---|
| ADR-001 and ADR-006 Pi boundaries | Preserve host authority, credentials isolation and verified version/ownership checks. Revise the design-only prohibition on all coding-agent imports in `src`: a future dedicated Pi adapter may import the SDK after its controlled session boundary is reviewed/tested. This slice changes no imports or runtime. |
| ADR-002/003 persistence and protocol | Preserve event/protocol compatibility, final states and cancellation. No new storage, writer migration or frozen public schema is enacted here. |
| ADR-004/005/007 learning and evidence | Preserve proposal/promotion boundaries, F6/holdout duties and unfinished acceptance. Offline synthetic #72 is not live learning or a freeze violation. |
| ADR-008 exact identity | Preserve its exact-byte and identity approach. Do not add replacement cryptographic digests. |
| ADR-009 lightweight architecture | Retain single coherent worker, modularity, explicit preferences and authority. Supersede investment in a broad self-built orchestration/adaptation product with the bounded core and deferred lab/Durable evaluation. |
| Prior A–F roadmap | Complete A's existing delivery. Defer B's new general orchestration while retaining authorization, total budgets, cancellation/settlement, effect admission and crash reconciliation as safety requirements. C–E stay deferred; F and the old 15-task evaluation remain unresolved. Detailed historical links remain in the active plan. |

## Delivery and review

Proceed through current-PR reconciliation, this decision, Pi version compatibility, unified worker/boundary verification, core separation, then defaults/governance cleanup. A later phase depends on demonstrated exit conditions, not only dates. Do not close unresolved PRs to reach a numerical WIP target. Preserve original worktrees and private evidence.

Use the existing plan/checklist and verification commands. Complex cross-module, authorization, security and data-correctness changes require independent review; simple low-impact changes use relevant checks. Existing human review of agent-authored conflict hunks and main/release authorization remain binding. The owner authorized implementation and scoped PR delivery, not automatic main merge, npm release or original Soul modification.

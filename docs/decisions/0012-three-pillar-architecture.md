# ADR-012: Three-pillar architecture and staged unfreeze

- Date: 2026-10-31.
- Status: **Accepted by the owner in conversation on 2026-10-31.** The owner proposed the three pillars, reviewed the recommended architecture and plan, and then delegated the listed decisions to the coordinator ("你自行确定并执行"). This ADR amends the freeze scope of [ADR-011](0011-real-task-improvement-loop.md). The purpose, real-task ranking, budgets and safety boundaries of [ADR-010](0010-evidence-bound-changes.md) and ADR-011 stay in force.
- Plan: [roadmap](../roadmap.md). The current queue is in [tasks/plan.md](../../tasks/plan.md).

## Context

The owner wants pi-sparkle to grow in three directions:

1. Single-task optimization, including self-improvement.
2. Long-task optimization, meaning task management.
3. Model routing and agent clusters.

Inputs to this decision:

- **Current state.**
  - The TaskSpec core already runs preparation → isolated candidate → independent check → explicit apply/discard.
  - Most queue, routing and multi-agent code sits on older run/flowchart/children paths, which have weaker safety.
  - Historical real tasks: 43 attempts, 12 correct deliveries, 20 interventions and 39 unknown fees.
- **External evidence.**
  - Fixed pipelines that validate by execution are strong (Agentless, SWE-agent, S\*).
  - Repair helps only when it is driven by external feedback (Reflexion; LLMs that self-correct without feedback often fail).
  - Self-improvement needs many automatically scorable tasks (DGM).
  - Routing saves cost, mostly shown on single-turn queries (RouteLLM, FrugalGPT).
  - Multi-agent gains are small on common benchmarks. Its failures cluster in system design, inter-agent misalignment and verification (MAST).
  - DeepSeek's Super-agent experiment gained throughput from concurrent tasks, not from better single tasks. Under a neutral prompt, the model never delegated, so separation must be structural.

## Decision

### 1. Structure

pi-sparkle keeps **one execution path**: the TaskSpec core. Around it sit three product pillars, a shared base and a shared feedback loop.

| Part | Responsibility |
|---|---|
| Pillar 1: single-task execution | Turn a request into a TaskSpec, then prepare, execute in a candidate, check independently, repair within limits and deliver. |
| Pillar 2: long-task coordination | Goal → milestones → work items (one work item = one TaskSpec). Choose the next item, continue when blocked, resume after interruption, deliver per milestone. |
| Pillar 3a: model assignment | Choose a model per role or task class, within host-set tiers and budgets. |
| Pillar 3b: worker pool | Read-only helpers, then parallel independent work items. |
| Shared base | Candidate/check/verdict/apply kernel. Host authorization policy. Budgets, cancellation and settlement. Attempt records. |
| Shared feedback loop | ADR-011 self-improvement: attribute failures → propose → approve → verify on later tasks → keep or roll back. First for single-task resources, then the same mechanism for long-task strategy and model assignment. |

The pillars are product responsibilities. They are not services, and they add no database or second scheduler. They interact only through:

- TaskSpec (down);
- candidate and verdict (up);
- attempt records (feedback).

### 2. Rules

1. New execution capability goes only into the TaskSpec core.
   - The older paths are maintenance-only: `run`/flowchart/supervisor/track/children, the cluster mailbox, bandit/R1.
   - Useful pieces move into the core on demand.
   - Code is deleted only after import-closure and caller checks show no consumer.
   - Nothing is bulk-restored.
2. Authority comes only from host policy and host UI confirmation. Model tool parameters, task text, issues, web pages and review text cannot widen scope, budgets or apply rights.
3. Required behavior is enforced by structure, not by prompts. For example:
   - a coordinator gets no write tools;
   - writes are redirected into candidates;
   - apply needs confirmation or policy.
4. Acceptance is external. Worker self-reports and reviewer opinions are advisory; the host's independent check decides.
5. Attention is a budget. Speak only for a decision or a usable result, and ask one concrete question at a time.
6. Every proactive capability has a host-set mode: `off`, `observe` (record what it would have done) or `auto`.
   - The default is `off` or `observe`.
   - `auto` requires ADR-011 step-2 evidence for that capability type plus owner authorization.
   - Permissions, credentials and security settings are never `auto`.

### 3. Maturity levels and entry conditions

| Pillar | L0 (now) | L1 | L2 | L3 |
|---|---|---|---|---|
| 1 Single task | Prepare → execute → check → apply | • Complete attempt records with failure classes.<br>• Pi in-chat entry without slash commands. | Class fixes as approved proposals, verified on later tasks | Proven proposal types auto-applied with rollback |
| 2 Long task | Bounded queue, atomic claims, dependencies, GitHub read-only import | • Goal-driven next item; continue when blocked.<br>• Resume by fresh verification, never by restoring authority from JSON.<br>• Watchdog that only pauses and notifies.<br>• Asynchronous checks. | Dynamic replanning; PR/CI loop (the agent never merges its own PR) | Interrupt the owner only for trade-offs or missing authority |
| 3a Models | Inherit host model | Host-set tiers per role; escalation only on named failure classes; record model, cost and outcome | Shadow recommendations compared with outcomes | Automatic routing after F-PROD |
| 3b Workers | Single worker plus read-only delegation | Cross-family read-only review as an advisory step | Parallel independent work items: separate candidates, disjoint write scopes, serial apply | Dynamic teams |

Dependencies between levels:

- Pillar 1 L1 precedes pillar 2 L1.
- Pillar 2 L1 precedes 3b L2.
- Every L3 needs real-task evidence and separate owner authorization.

### 4. Unfrozen now

The following L1 work is unfrozen. It extends existing modules and adds no new store or scheduler.

- **Pillar 1 L1–L2.** L2 is already ADR-011 step 1.
- **Pi in-chat entry:**
  - a model-callable draft tool that proposes only the objective and paths, while the host builds checks and limits;
  - host confirmation dialogs for run and apply;
  - status display.

  New tool or command surfaces and changes to frozen CLI/event/JSON surfaces still need the owner's interface review before merge.
- **3a L1.** Host role tiers. A TaskSpec model-field change also needs owner interface review.
- **3b L1.**
- **Pillar 2 L1.** It uses the existing work-item store.

### 5. Still frozen

- Learned or automatic routing (until F-PROD closes).
- Automatic promotion (ADR-011 step 2).
- Dynamic teams and a general multi-agent framework.
- Cloud-resident loops, device daemons and IM listeners.
- Unattended paid benchmarks.
- P4/P5.
- Cross-process write recovery B1/B2, as deferred by ADR-011.

### 6. Owner decisions recorded on 2026-10-31

- **#140 (prepared Node artifacts through apply)** merges after exact-head required CI succeeds.
  - Its runtime and test bytes equal `a5bc7e70`, which has 7/7 hosted CI and a matching Claude NON-BLOCKING review.
  - The incomplete Windows serial local gate is accepted as residual risk and stays on the checklist.
- **#138** is closed as superseded.
- **#103 (whole-candidate capacity 4096 files / 32 MiB) is needed for dogfooding.**
  - pi-sparkle itself tracks 1,766 files. On main `616ff427`, `captureExactSnapshot(<pi-sparkle checkout>, {}, {maxFiles: 1024, ...})` refuses it with "file count limit exceeded". The same call with 4096 / 32 MiB succeeds.
  - Main's unprepared retain/apply path uses the 1024 cap, so a real task on pi-sparkle's own backlog cannot be held or applied.
  - #103 is rebased onto main after #140. Its conflicts are in `retained-candidate.ts` and its test. It then follows the safety-core path: focused checks, one Claude review, exact-head CI and the owner-delegated merge.
  - #103 covers only the unprepared path. When fixed offline Node preparation is in use, the delivery tree plus the installed dependency graph share one 1024-file / 16 MiB budget (`src/execution/prepared-node-artifacts.ts`). pi-sparkle's own `node_modules` holds about 18,000 files, so a prepared run on pi-sparkle still needs a separate decision: either a larger artifact budget or running its checks against an existing installation.
  - Attempt 44 therefore uses a small Node repository, and it does not wait for #103.
- **Execution runtime.** Advancing it to the main that contains #140 is authorized after that main's CI succeeds.
- **Real-task attempts 44–49** are authorized within ADR-011 limits:
  - at most US$5 reference cost per attempt and US$50 per week;
  - on the owner's configured Pi model;
  - recorded in the canonical private ledger;
  - original Soul changes are still applied only by the owner.

## Consequences

- The roadmap uses stages A–E for time and levels L0–L3 for maturity. Older M/Phase/R numbering stays historical.
- The existing `scripts/real-task-record.mjs` and `scripts/real-task-summary.mjs` are the attempt-record base. No second record store is built.
- If later real tasks show no benefit over direct Pi, keep candidate isolation, checks and audit, and shrink the product. Do not add mechanisms.

# Active implementation plan

The previous plan, with every dated checkpoint from 2026-10-25 to 2026-11-02, candidate evidence and retained failures, is preserved verbatim in the [pre-tidy archive](../archive/tasks/2026-11-06-pre-tidy-plan.md). Its dated "current", "next" and wait statements no longer dispatch work; its unfinished obligations stay binding through [retained obligations](#retained-evidence-and-unfinished-obligations) below. [ADR-010](../docs/decisions/0010-evidence-bound-changes.md), [ADR-011](../docs/decisions/0011-real-task-improvement-loop.md) and [ADR-012](../docs/decisions/0012-three-pillar-architecture.md) remain binding; stage order lives in the [roadmap](../docs/roadmap.md).

<a id="current-execution-checkpoint-2026-10-26"></a>

## Current execution checkpoint (2026-11-06)

Rebuilt from observed Git, GitHub, CI and private-ledger state on 2026-11-06; the commands are in the records-tidy PR.

| Item | Observed state |
|---|---|
| Main | `eb40e447` after #148. Main CI [42172608270](https://github.com/Xhhemoing/pi-sparkle/actions/runs/42172608270) passed all five jobs. |
| Adopted since 2026-10-31 | #140 prepared Node artifacts through apply (`616ff427`); #143 ADR-012; #145 roadmap practices; #148 lets the host check decide after a worker stop (serial local gate exit 0 at `8afce3d4`, Claude NON-BLOCKING, owner merge). #138 is closed as superseded. |
| #140 residual risk | The accepted incomplete Windows serial gate was rerun at `a5bc7e70` and exited 0 (private coordination record). Closed. |
| Execution runtime | The ordinary E: worktree moved `280882b4` → `d15a9b1f` on 2026-11-05 (install, status and CLI help exit 0), then → `eb40e447` 23 s after #148 merged, before that main CI finished; the CI passed later. Dependency files are unchanged over `280882b4..eb40e447`, so the recorded installation applies. |
| New ledger | Attempts 44 and 45 used one TaskSpec: failure-class ranking in `real-task-summary.mjs`, in an isolated copy at source `eebd5c9`. Zero-model preflight passed both times. Both FAILED at the first model dispatch: the configured provider returned HTTP 502 with no usage, and the loop stopped as `cost-unavailable` without a second round or any host check. Candidates were unchanged and discarded. Fees are unknown (US$10 reserved this week); 0 correct deliveries. See [I-17](issues.md#i-17--new-ledger-provider-outage-before-host-checks). |
| Provider | A later private probe (2026-11-06 05:43 UTC) listed models with HTTP 200, but minimal completions on all five probed models returned 502 `upstream_error`. Current availability is unknown. |
| Open PRs | #144 (rebased #103, `692048e2`): seven hosted checks green; its body records a capacity test cancelled at 120 s and a typecheck OOM; no Claude review yet. #146 (draft, `d8aa044a`): five hosted checks green; local gate exit 1 with one cancelled test; Claude review pending. #147 is superseded by this records tidy. |
| Authorization left | ADR-012 attempts 46–49, at most US$5 per attempt and US$50 per week, on the owner's configured Pi model. |

## Next usable result (stage A)

One real Node task completes prepare → execute → host check → apply, and the original project's checks pass after apply.

- Dependency: a working provider. Before admitting attempt 46, rerun the private provider probe and admit only when a minimal completion on the configured model succeeds. The probe sends one minimal paid request; it is an operator check, not an attempt.
- Task: reuse the a44 TaskSpec, whose zero-model preflight passed. Reuse after a successful probe is a changed condition, not an unchanged retry. Apply in the isolated copy counts as delivery; porting the change back is one intervention through an ordinary test-first PR, whose CI is the original-project check. That PR also closes the stage B failure-ranking item.
- If the provider stays down, do not spend attempt slots. Switching provider/model is an owner decision. A bounded retry for zero-token HTTP-error dispatches would change strict-cost handling, so it needs owner approval, Claude review and owner merge; it would not help during a multi-hour upstream outage.
- Not blocking attempt 46: #144 (needed only for tasks on the full pi-sparkle checkout), the Git < 2.36 refusal (local Git is 2.54) and #146.
- Acceptance: the attempt record holds the final host-check result, apply status, interventions, phase times, cost coverage and failure class, and the port-back PR CI is green. Preflight, a worker report or hosted CI alone never establishes success.

## Stage B and later

- Stage B: five distinct real tasks with complete records, at least four with known cost; rank non-correct outcomes by count, then known cost, with no score when cost is unknown. a45 repeated a44's task, so it is not a distinct task. Once attempt 46 serves stage A, attempts 47–49 cannot supply five distinct tasks; continuing beyond attempt 49 is an owner decision.
- Rebuild the private task queue (lost on 2026-10-28; only the a44 input exists): at least five distinct tasks, three of them passing zero-model preflight, at most two editing the same file. Tasks with `node_modules` share the prepared 1024-file / 16 MiB budget; until the owner decides that budget, prefer zero-dependency tasks.
- Stages C–E follow the roadmap and do not unfreeze routing, learning or automatic promotion.

## Parked candidates

- [#144](https://github.com/Xhhemoing/pi-sparkle/pull/144) (`692048e2`, rebased #103): whole-candidate retention at 4096 files / 32 MiB on the unprepared path; the prepared-artifact budget is unchanged. It is needed for real tasks on the full pi-sparkle checkout, whose 1,766 tracked files exceed 1024. Remaining: Windows focused capacity tests and typecheck, one serial local gate (safety core), Claude review and owner merge. The original #103 `1dd83a8c` full gate FAILED (5024 pass / 1 fail / 2 cancelled / 58 skip) and stays retained.
- [#146](https://github.com/Xhhemoing/pi-sparkle/pull/146) (draft, `d8aa044a`): pure work-item → TaskSpec draft bridge, artifact byte-length fix and bounded Git failure diagnostics. Five hosted checks passed. The post-reboot local gate exited 1 (5,117 pass / 0 fail / 1 cancelled / 58 skip; build not reached); the cancelled parent-delegation test passed on one unchanged replay. Claude review, owner frozen-implementation review and runtime merge remain. Deferred until the stage A/B single-task records exist. Its detailed record text stays in superseded [#147](https://github.com/Xhhemoing/pi-sparkle/pull/147).
- Host-check draft: the uncommitted 18-path change in the `phase1-ts-validation` worktree is unadopted; preserve it.

## Owner decisions in force

- 2026-10-31: [ADR-012](../docs/decisions/0012-three-pillar-architecture.md) accepted (three pillars, stages A–E, maturity L0–L3). #140 merged; #138 closed; #103 must be rebased and merged for dogfooding (now #144); runtime advancement after main CI and attempts 44–49 are authorized.
- 2026-10-31: DevFest 2026 practices are folded into roadmap stages B–E only: rework count and per-phase tokens where observable plus failure-class ranking (B); C8 delivery walkthrough and C6 review that may only tighten, after ≥20 human-labelled agreements (C); circuit breaker after two same-class failures of one work item (D); ~10% canary with rollback and development-only synthetic variants (E). They do not unfreeze routing/learning/adaptation, change budgets or authorize runtime work.
- 2026-11-05: the owner authorized #148's one existing-assertion change and merged #148.
- Standing: docs-only PRs may self-merge on green current CI; every other main merge needs the owner.

## Real-task improvement loop (2026-10-25)

The essential goal is to make Pi deliver real changes more correctly and efficiently. Rank work by kept correct delivery, escaped defects, interventions, total phase time and reference cost over every attempt, including failure/refusal/timeout/unknown; test counts and green CI are not progress. ADR-012 maps the older stages onto the roadmap: R1 attempts → stages A/B, R2 class review → stage B ranking, R3 proposals → stage C1, R4 automation → stage E, still frozen.

### Owner boundaries

- Do not ask further questions or send approval prompts. Record unresolved matters in the [single issue log](issues.md) and continue independent authorized work under the existing boundaries.
- Spend at most US$5 per attempt and US$50 per week (ADR-012) with the configured approved models/prices; the earlier weekly `none` is superseded, although the operator example in `docs/development-workflow.md` still shows it until the owner merges a correction. Run the existing summary before admission and keep partial/unknown fees unknown, never zero. Gateway billing is unknown; use valid long-context rates or refuse.
- Main merges except docs-only self-merges, release, original Soul application and resource promotion require the owner's specific approval. New providers/models, budget overruns, frozen-interface/safety changes, R4/R5 entry and deleting worktrees/evidence retain separate authorization.
- Every agent-resolved conflict hunk is explained and sent to the owner for human review before commit/push. Keep candidate/checker/source ownership, protected paths, explicit apply, cumulative budgets, cancellation, settlement and refusal on unknown effects.
- Original Soul stays read-only. Use committed-only isolated copies and synthetic data; keep state, transcripts and records in `.agent_workspace/`. Do not copy uncommitted data/targets or expose private content. Stop heavy work below 2 GiB free on any used drive.
- Runtime/test PRs do not edit this plan or todo. The coordinator updates current state after merges in one records PR; dated evidence belongs in the archive, not appended checkpoint receipts.

### Method

- Every 10 attempts or weekly, aggregate failure class/root cause, interventions and phase time; choose the top 1–2 classes by frequency × known cost. A class is solved only when later real outcomes shrink it.
- Record every failure, rejection and timeout. A fixed infrastructure cause may be retried once; otherwise keep the failure/unknown and move on.
- Proposals (TaskSpec templates, context, check recipes, worker guidance, model/thinking) use the existing lab candidate/review/evaluation/CAS/rollback path, a reviewer different from the author and owner approval. Permissions, credentials and security settings are never proposed for automation.

### Retained evidence and unfinished obligations

- Historical ledger: 43 attempts (22 Pi / 21 Soul), 12 correct deliveries, 20 interventions and 0 escaped defects observed; complete fees are known for 4 attempts, with an observed floor of US$3.19506632 that is not a total. The original records were lost on 2026-10-28 ([I-15](issues.md#i-15--lost-private-real-task-evidence-and-recovery)); the new ledger starts at 44 and is never merged with these aggregates. Missing costs and times stay unknown.
- Outcome hypotheses H1 (worker 480 s / total 900 s removes deadline failures over five distinct new Native tasks) and H2 (zero preparation/environment/operator-input failures over the next five distinct eligible tasks, observed through the complete checker path) remain unverified. Attempts 44/45 passed preflight but never reached the checker, so they do not count toward H2.
- The [verbatim R1–R3 evidence](../archive/tasks/2026-10-26-r1-r3-evidence.md) and the [pre-tidy plan](../archive/tasks/2026-11-06-pre-tidy-plan.md) preserve old checkpoints, dated records, failed gates and unknowns.
- R3: prompt and check-recipe slices are adopted. Template/context/prepare/model-thinking consumption and the later-task exit (at least two proposals, each evaluated on at least five distinct later tasks) remain incomplete. The two exact promotions in [I-02](issues.md#i-02--r3-exact-manual-promotions-recorded-for-later-handling) need the owner; zero guidance trials have run.
- Original Soul packets S06/S07/S10/S11 in [I-03](issues.md#i-03--original-soul-candidate-packets-retained-for-later-handling) await owner-only application.
- [Phase 1 plan](../archive/tasks/2026-10-25-phase1-plan.md) and [exit traceability](../docs/evidence/phase1-exit.md): TS #83 and Rust #85 are adopted; B1/B2 resume stays deferred until real-task need. Phase 1 completion is the owner's decision.
- [Whole-plan obligations](../archive/tasks/2026-10-25-pre-maintenance-plan.md#whole-plan-completion-obligations): #68 waits for the owner; #72 stays deferred. Fix and retest the old direct helper kill-error/successful-reap regression before adopting that candidate.
- The old 15-task comparison and ADR-010 targets remain unproven: defects −50%, correct delivery within −3 points, cost per correct delivery ≤ 1.3×. R5 benchmark/publication/macOS/containment/onboarding keep their owner approval.
- Preserve [earlier duties](../archive/tasks/2026-10-21-pre-integration-checklist.md): F6, S0-min, R10/R11, PR #36 artifacts, privacy, containment and production approval.
- `pnpm status` generates ignored `STATUS.md`; CI uploads a generation-time snapshot in the existing quality/CLI job artifacts. Neither authorizes work.

### Owner decisions

| Item | Required decision |
|---|---|
| Provider | Wait for the configured gateway, switch provider/model, or approve a bounded strict-cost retry design for zero-token HTTP-error dispatches. |
| Attempts after 49 | ADR-012 authorizes 44–49 only; stage B's five distinct tasks need more. |
| Prepared dependencies | A larger prepared-artifact budget or checks against an existing installation, before any task with `node_modules` (including Soul). |
| #144 / #146 | Runtime merges after their remaining evidence; #146 also needs frozen-implementation review. |
| Operator guide | Merge a correction of `docs/development-workflow.md` to the ADR-012 weekly cap and the adopted #140 apply path. |
| R3 promotions, Soul packets, #68, Phase 1, R4/R5 | Unchanged; see I-02, I-03 and the retained obligations. |

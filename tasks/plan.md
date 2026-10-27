# Active implementation plan

## Current execution checkpoint (2026-10-26)

Resume from the actual workspace, branch/HEAD and dirty paths. Adopted main is `49bb84ad` (#99, reviewed `bd922974`). Coordinator docs live in `real-task-pricing-docs` / `codex/s-doc-consolidation-20261026`. E:/Project/pi-sparkle has separate uncommitted documentation that remains untouched. Status and CI are observations, not authorization.

| Result | Current state and next action |
|---|---|
| Maintenance | #88/#89 integrate the fixes from #80/#82; both originals are closed. #68 awaits the owner. |
| SDK cost evidence | #100, `5a8e147f`, nine files; no plan/todo/capacity changes. Independent accounting and frozen JSON/invocation reviews passed; exact-head CI40436694889 and root regression passed. Owner merge decision pending. |
| Capacity | Separate #103, `3bc12e28`, four files, unadopted. Existing gate41432 ended failed(exit1); build/probes not reached. No new gate. Owner decision pending; follow exact-head CI. |
| S-doc | Current docs-only candidate: compact checkpoint/acceptance/owner decisions, verbatim dated archive, separate coordinator updates and current-output rule. Content/link checks pass; independent review and exact-head CI pending. |
| Real tasks | Next: P06 → P07 → S06 (deadline + reminder together) → S07 → S08. Use adopted runtime only; preparation and dispatch follow capacity validation's termination. |
| R3 | #96/#98 are adopted. Two prompt contents are approved; resource promotion and matched later trials remain separate owner/evidence boundaries. No resource is promoted. |
| Parked work | #102 and the uncommitted host-check maintenance in phase1-ts-validation are unadopted and outside this ordered task batch. Preserve their changes and failures. |

### Run statistics

Latest verified canonical summary: 26 attempts (13 Pi / 13 Soul), 5 reviewed-and-kept changes, 12 interventions, 0 escaped defects observed. Original Soul is not applied by this work. Full reference cost remains unknown for all 26 attempts; observed lower bound US$0.69969432. Task-authoring/review time is sparse or unknown. Speed benefit remains unmeasured.

The first two R2 reviews are retained in the [evidence archive](archive/2026-10-26-r1-r3-evidence.md#earlier-verification-and-review-snapshots). Next review: attempt30 or weekly. Refresh the private summary before every paid admission; do not use this checkpoint as a live budget calculation.

## Real-task improvement loop (2026-10-25)

The essential goal is to make Pi deliver real changes more correctly and efficiently. Rank work by kept correct delivery, escaped defects, interventions, total phase time and reference cost over every attempt, including failure/refusal/timeout/unknown; test counts and green CI are not progress. [ADR-010](../docs/decisions/0010-evidence-bound-changes.md) and [ADR-011](../docs/decisions/0011-real-task-improvement-loop.md) remain binding.

### Owner boundaries

- Spend at most US$5 per attempt with the configured approved models/prices; weekly limit is `none`. Run the existing summary before admission and retain partial/unknown fees as unknown, never zero. Gateway billing is unknown; use valid long-context rates or refuse.
- Main merges except docs-only self-merges, release, original Soul application and resource promotion require the owner's specific approval. New providers/models, budget overruns, frozen-interface/safety changes, R4/R5 entry and deleting worktrees/evidence retain separate authorization.
- Every conflict hunk goes to the owner before resolution. Keep existing candidate/checker/source ownership, protected paths, explicit apply, cumulative budgets, cancellation, settlement and refusal on unknown effects.
- Original Soul remains read-only. Use committed-only isolated copies and synthetic data; keep state, transcripts and records in `.agent_workspace/`. Do not copy uncommitted data/target or expose private content. Stop heavy work below2GiB free.
- Runtime/test PRs do not edit this plan or todo. The coordinator maintains current state separately after merges; dated evidence belongs in the archive, not appended checkpoint receipts.

### R0 — close out and prepare

- Maintenance integrations and frozen CLI/pinning review remain scoped to their reviewed candidates; inherited failed/skipped/unknown evidence stays visible in the archive.
- Existing record/update/summary tools must count every attempt and preserve missing timing/fees as unknown. The private queue and isolated-copy procedure remain the task sources; new entries need an observable real gap.
- Keep complete input/output/cache/tier reference prices for the approved models and strict unpriced-dispatch refusal. No real task uses an unadopted runtime.
- Exit: Rust PR submitted; record/summary tooling usable with owner adoption; queue holds at least10 tasks; isolated-copy procedure verified once. Historical evidence is retained below, not revalidated by this docs change.

### R1 — real tasks

- Use both projects and the ordered P06/P07/S06/S07/S08 batch above. Preserve each comparison's committed source and original objective; verify relevant source/instruction freshness before dispatch.
- Time TaskSpec authoring, prepare → existing preflight/task-run → independent review → explicit disposition → record through `real-task-record`. Capture `taskSpecMinutes` and review seconds; missing measurements stay unknown.
- At least3 of the first10 tasks also receive matched direct-Pi model/input/budget runs. Their existing observations remain limited evidence, not proof of benefit.
- Record every failure, rejection and timeout. A fixed infrastructure cause may be retried once; otherwise retain the failure/unknown and move on. P01/P02 need a class correction or changed condition before retry.
- Exit:10 attempts recorded(any outcome) and a summary generated; original Soul unchanged; budget respected. Process exit is met; outcome benefit is not established.

### R2 — review and fix classes

- Every10 attempts or weekly, aggregate failure class/root cause, intervention and phase time; choose the top1–2 classes by frequency × cost.
- State the class hypothesis, measurable baseline/target and later-task evaluation window, and a general correction from real-task evidence. Build the minimal synthetic failing case without private data; validate the correction on later real tasks.
- A class is solved only after later outcomes shrink it. Update the current Run statistics and retain dated review evidence in the archive.
- Report measured speed evidence with limitations; before that review, do not claim speedup. Unknown timings and costs cannot become zero or a complete comparison.

### R3 — proposals, owner approval and verification

- Extend the existing lab candidate/review/evaluation/CAS/rollback path to TaskSpec templates, context selection, check recipes, worker guidance and model/thinking choice; do not build a parallel system.
- Prompt and check-recipe slices are adopted; template/context/prepare/model-thinking consumption and the later-task exits remain incomplete. Permissions, credentials and security settings are never proposed for automation.
- Each proposal needs source records, expected effect, scope and rollback. Use the existing explicit review/promotion path with a reviewer different from its author and the required owner approval.
- On applicable tasks compare the two approved prompts against their controls using the same committed source and original goal. Record all retries/refusals; differing controls or missing equivalence remain unclear.
- Exit: at least2 proposals evaluated on at least5 distinct later tasks each, with better/worse/unclear conclusions. Repeated attempts do not become different logical tasks.

### R4 — automation remains frozen

- Entry needs owner approval and outcome-supported improvement for the proposed types only.
- Before entry, test stop/rollback; the owner sets the approval-profile scope. Record every automatic change, roll back and stop on regression, and review every10 tasks.
- No general scheduler/durability or other frozen P4/P5 work is authorized by these records.

### Retained evidence and unfinished obligations

- [Verbatim R1–R3 evidence](archive/2026-10-26-r1-r3-evidence.md) preserves old checkpoints, dated records, failed gates and unknowns. Its dated next steps and old permissions are historical.
- [Phase 1 plan](archive/2026-10-25-phase1-plan.md) and [exit traceability](../docs/evidence/phase1-exit.md): TS#83/Rust#85 are adopted; B1/B2 resume remains deferred until real-task need under its original trust/budget/counterexample criteria. Phase 1 completion is the owner's decision.
- [Whole-plan obligations](archive/2026-10-25-pre-maintenance-plan.md#whole-plan-completion-obligations): #68 waits for owner decision; #72 remains deferred. Fix/retest the old direct helper kill-error/successful-reap regression before adoption.
- The old15-task comparison and ADR-010 targets remain unproven: defects−50%, correct delivery within−3 points, cost/correct delivery≤1.3x need matched data. R5 benchmark/publication/macOS/containment/onboarding retain owner approval.
- Preserve [earlier duties](archive/2026-10-21-pre-integration-checklist.md): F6, S0-min, R10/R11, PR#36 artifacts, privacy, containment and production approval. Unexplained Windows/Git/TS/Rust anomalies remain in the archive.
- `pnpm status` generates ignored STATUS; CI snapshots are generation-time observations only and never authorize work.

### Owner decisions

| Item | Required decision |
|---|---|
| #100 | Decide merge of the reviewed SDK-only exact head; current CI does not supply approval. |
| #103 | Review the four-file capacity candidate with its failed local gate evidence and decide merge. |
| R3 resources | Preserve approved prompt contents; explicit promotion remains an owner boundary. |
| #68 / Phase 1 / R4–R5 | Deferred to the owner; coordinator does not advance them from old plans. |

### R0 preparation candidate (2026-10-25)

Historical evidence moved [verbatim to the archive](archive/2026-10-26-r1-r3-evidence.md#r0-preparation-candidate-2026-10-25).

### R0.6 reference-price integration repair (2026-10-26)

Historical evidence moved [verbatim to the archive](archive/2026-10-26-r1-r3-evidence.md#r06-reference-price-integration-repair-2026-10-26).

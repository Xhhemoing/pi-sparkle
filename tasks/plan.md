# Active implementation plan

<a id="current-execution-checkpoint-2026-10-26"></a>

## Current execution checkpoint (2026-10-27)

Resume from the actual workspace, branch/HEAD and dirty paths. Verified main base is `16b1d60d` (#123 checkpoint), following #121/#117/#118; docs-only #123 merged non-squash after all five exact-head checks passed at b2c64914. Prior e76c41a5 Windows failure remains unresolved evidence in [I-10](issues.md#i-10--current-docs-ci-failure). Execution runtime remains adopted `faf788bc`; #100 is owner-adopted in `6a35824f` and #99 in `49bb84ad`. Coordinator docs live in `real-task-pricing-docs` / `codex/p12-direct-outcome-20261027`. E:/Project/pi-sparkle has separate uncommitted documentation that remains untouched. Status and CI are observations, not authorization.

| Result | Current state and next action |
|---|---|
| Maintenance | #88/#89 integrate the fixes from #80/#82; both originals are closed. #68 awaits the owner. |
| SDK cost evidence | #100 is owner-approved and merged non-squash as `6a35824f`; reviewed SDK-only `5a8e147f`, nine files, exact-head CI40436694889/root regression passed. No plan/todo/capacity changes. |
| Capacity | Separate #103, `3bc12e28`, four files, unadopted. Existing gate41432 ended failed(exit1); build/probes not reached. No new gate. Exact-head CI40439074326/root regression passed; local gate remains failed. Owner chose to keep #103 unmerged; no new gate or real-task use. |
| S-doc | Adopted through #104 (`fb13b4c8`), reviewed `ca9e419f`, exact-head CI40441624346 passed. Keep this compact checkpoint current; archive retains original evidence verbatim. |
| Real tasks | Ordered controls done: P06 cancelled; P07/S06 accepted and reviewed/kept; S07 blocked by worker false FAILED; S08 request timeout/no edits. All settled, failures retained. #105/#106 current CI green, merge items recorded in [I-01](issues.md#i-01--runtime-candidates-recorded-for-later-handling); P09 #113 is a later accepted/reviewed-kept candidate with current CI in its PR; S10 and S11 are accepted/reviewed-kept as private owner packets. P09/S10 preparation failures remain separate attempts. P10 #115 is a reviewed/kept manual salvage candidate after Native CANCELLED/accepted=false/settled=true; it does not increase correct deliveries. Soul apply is owner-only. |
| R2 | Review40 completed: newest10 have5 correct deliveries across6 logical tasks; this is not an improvement comparison with review30. Priorities are two worker-budget cancellations and three host-input/checker issues (one secondary overlap), with costs/timings incomplete. Later-task targets remain unverified; older host-only guidance still has zero promoted trials. Speed unmeasured. |
| R3 | Model/thinking #108 remains unadopted. Initial full CI exposed a lab-to-runtime import-boundary defect; the repaired pure-domain/explicit-CLI composition passed local regression and independent re-review. Repaired exact-head CI is green; retained failure remains in its PR. Matched-resource evaluation [#111](https://github.com/Xhhemoing/pi-sparkle/pull/111) is a separate unadopted six-file candidate stacked on #108; its current CI is separate evidence. #96/#98 are adopted. Two prompt contents and exact manual CAS packets are reviewed; specific promotions are recorded in [I-02](issues.md#i-02--r3-exact-manual-promotions-recorded-for-later-handling). Five ordered controls and later P09/P10 controls retain committed sources/goals; zero guidance promotions/trials. S10/S11 are ordinary tasks outside the R3 comparison window. |
| Parked work | #102 and the uncommitted host-check maintenance in phase1-ts-validation are unadopted and outside this ordered task batch. Preserve their changes and failures. |

### Run statistics

Latest verified canonical summary:43 attempts (22 Pi /21 Soul),12 correct deliveries,20 interventions,0 escaped defects observed. Original Soul is not applied by this work. Complete reference fees are S07 US$0.1080876, P09-a2 US$0.1455084, S10-a2 US$0.1843592 and S11-a1 US$0.1280292; the other39 remain unknown. The immutable canonical fee floor is US$2.93910152; P12's separately rederived partial observation addsUS$0.2559648, giving a combined observed floorUS$3.19506632. This is not total/gateway billing; the initial snapshot discrepancy is retained in [I-12](issues.md#i-12--p12-partial-cost-observation-and-immutable-first-snapshot). Authoring is missing for31 attempts and review for30; measured scopes differ. P02/P10/P11/P12 manual salvage does not relabel their original failures as correct deliveries. Paired arms are attempts, not distinct logical tasks. Speed benefit remains unmeasured.

The first two R2 reviews are retained in the [evidence archive](archive/2026-10-26-r1-r3-evidence.md#earlier-verification-and-review-snapshots); review30 remains in [#117](https://github.com/Xhhemoing/pi-sparkle/pull/117) and existing private records. Review40 uses the actual launch sequence and separates old P02 backfill from its newest10 attempts. Next review after this closeout: attempt50 or weekly. Refresh the private summary before every paid admission; do not use this checkpoint as a live budget calculation.

### Retained P10/S11 candidate handoff

- Scope: P10 refuses explicit blank preference state roots before binding/reading/writing/locking, preserving valid roots/defaults and existing locks/tombstones. S11 distinguishes unknown/pending/failed directory metadata from a successfully confirmed empty roots list. Each is a separate grounded public-entry defect, at most two product files, with a protected synthetic business RED before model dispatch; no permissions or backend widening.
- Dependencies: preserve P09 #113 and S10 results/packets; use clean adopted runtimefaf788bc and exact fresh committed task sources. Keep dependency/cache preparation in a separate verification copy or allocated candidate, never the clean source; host RED stdout follows the existing exact assertion/outcome protocol. P10 independent input review exposed legal-path trimming and lock-before-refusal coverage gaps; both are closed in the30-case protected check and its committed source. Formal preflight passed, then the240-second worker limit cancelled Native before final verification. Its two-file salvage candidate #115 independently passed business30/30, original-plus-regression39/39, frozen45pass/1existing Windows skip and type/lint; hosted exact-head CI and both recovery jobs passed; #115 remains unmerged. Native failure/partial fees remain unchanged. S11 is independently reviewed/kept with20/20 React, lint/type checks and read-only original compatibility; no original apply. No runtime-policy relaxation, unadopted runtime, promotion or new full gate.
- Acceptance: actual preflight/task-run/independent review and disposition record every failure, fee and unknown. P10 includes valid-default/relative-root and lock regressions plus frozen CLI/pinning review; S11 preserves authorized-root actions, scans and stale-response behavior. Source/task/checker identities remain bound; zero real private directory/chat reads.
- Matched results: S11 Direct completed/settled and independently reviewed/kept at source5c662710/exact Native TASK_REQUEST; S10 Direct likewise at0848ea16, with its one-line product diff identical to Native. Final checks20/20 and29/29 respectively; differing Direct tools/clocks remain descriptive comparisons, outside R3 guidance trials. Operator receipt/replay defects are corrected; inherited helper TS7030 remains red. P02 already had a Direct TIMEOUT at source1e7fcafd and actual Native request evidence; do not dispatch an unchanged retry. Its retained documentation required a manual projection-variable correction and current-main weekly-none update; [#118](https://github.com/Xhhemoing/pi-sparkle/pull/118) is docs-only manual salvage with independent isolated checks, not a new paid attempt or correct delivery.
- Measurement: time authoring/review with explicit scopes; per-attempt<=US$5/weekly none and refresh admission summary. P10 retains an empty host-only control; S11 is not an input-validation guidance trial. Review40 does not complete the later-task exits or establish speed benefit.

### R2 current hypotheses and next observations

- H1: two of six model-executed Native attempts in the newest10 exhausted worker240; both fees are unknown, with combined lower boundUS$0.5264096. Logged tool-active union is9.207s/6.042s; provider/individual-dispatch latency remains unknown. A genuinely new host-authored task may predeclare worker480/total900 within existing limits and US$5, targeting zero deadline failures over five distinct new Native tasks. This is an unverified input hypothesis, not a shipped resource or speed claim; never rewrite old240 comparisons or retry P11 to fill the window.
- H2: two preflight input failures plus the later P11 synthetic cost-fixture issue are overlapping operator/checker observations, not three PREFLIGHT_FAILED outcomes. Preserve clean committed sources, frozen dependencies in allocated/verification copies, exact RED output and a valid strict-cost test double before paid use. Target zero such issues through the full checker over five distinct later tasks; a passing preflight alone cannot fill that window. Previous host-only guidance and its promotion boundary remain unchanged.

### Next R3 result — explicit context-file consumption

- Readiness: static investigation confirms the adopted adapter cannot consume a structured context-rule. TaskSpec parsing preserves order but the context snapshot deduplicates/sorts; a reorder-only rule has no actual request effect. No recorded failure has a diagnosed omitted-file cause. This is a remaining R3 capability, not a proven correction to the active failure class; TaskSpec-template stays separate.
- Current narrow result: P11 at committed sourceedc11b9b passed formal preflight, then Native CANCELLED/accepted=false/settled=true at worker240; the final Native checker was not reached. Its complete fee is unknown/lower boundUS$0.329478. Original candidate and frozen checker remain unchanged. Separate manual delivery repairs missing CLI file forwarding and an incorrect author-kind approval predicate; both regressions have actual RED/GREEN evidence. Independent review and fixture-corrected11-case checking passed, including full actual TASK_REQUEST consumption. The six-file [#120](https://github.com/Xhhemoing/pi-sparkle/pull/120) is at54e53ce1 after an independently reviewed old-fixture repair (actual2fail→8/8). Prior22ed823e CI failed two quality jobs; all five54e53ce1 checks passed inCI40630483440; owner adoption remains separate.
- Scope/dependencies: `task-resources.ts`, `from-real-tasks.ts`, `real-task-adapt.mjs` and `eval-real-tasks.ts`, plus the original proposal fixture and one new regression test. The fourth product file is necessary: the current evaluator can mistake matching objective metadata for actual context consumption. Until #111's independent request-evidence repair is adopted, the new topic must remain UNOBSERVED/unclear with no valid consumed/benefit score. Use existing workflow-template identity, explicit fixed file values/source hypotheses and synthetic registry review/CAS fixtures; no live promotion. Root reviews inputs and runs the protected business RED before any model admission, then focused entry/session/refusal tests, typecheck/lint/workflow and exact-head hosted CI; no new local full gate.
- Retain original post-check failures: CLI forwarding failed first; after its repair, the original synthetic USD1 fixture correctly refused an unbound fake executor. A separate copy uses existing real strict callbacks with local faux SDK responses, preserving USD1 and every assertion; it passed in23.783s under the unchanged40s runner. This is manual validation, not Native acceptance or a valid P11 matched-effect control. Existing #111 remains unadopted with unresolved Windows CI; later-task evaluation needs its repair/adoption and exact promotion approval. TaskSpec-template and real resource effects remain unfinished.
### P12 — role-template TaskSpec authoring

- Candidate result: the existing-registry `task-spec-template` compiles unordered host recipe catalogs into new `prepare[]`/`checks[]` arrays in versioned role order. Goal, context/argv order, scope/protection, expect, worker and budgets remain host values through existing validation; artifacts/authorityRef never grant execution permission. No baseSpec passthrough, defaults, interpolation or parallel system.
- Actual new-task H1 trial at committed3963d0d: adoptedfaf dispatcher, approved empty guidance, Sol/high8192, worker480/total900/US$5/weeklynone. FAILED/accepted=false/settled=true after SDK Request timed out and missing-usage cost refusal; final Native check NOT REACHED. This is not the480s ceiling or evidence H1 improved. Original two tracked edits, untracked unit and protected checker are preserved; no retry or real promotion. Old240 controls/P11 stay unchanged.
- Separate six-file manual [#122](https://github.com/Xhhemoing/pi-sparkle/pull/122),5d6f7199, is stacked on unadopted #12054e53ce1. Complete-host-request/proposal regressions went2RED→2GREEN; actual dev CLI/preflight/strict USD1 faux-SDK TaskSpecSession/request/final-check/rollback passed12cases in27.013s under the original40s runner. Focused40+18, type/lint/workflow/diff/status and independent/frozen-surface review passed. All five exact-head checks passed inCI40633132563; owner-only main adoption, later effects and #111 remain separate. No local full gate/build or runtime adoption.
- Matched Direct a1: REFUSED before its launch marker/model because C1.912GiB was below2GiB. Readiness10.017min is elapsed setup; its parse-only command did not execute the checker. Finalized a1 and original evidence remain unchanged. After recovery to2.694GiB, fresh a2 used the same3963d0d/62815-character request, Sol/high8192/worker480/total900/US$5/weeklynone; the original checker actually produced the expected baseline RED. See [I-07](issues.md#i-07--disk-headroom-conditional-recovery).
- Direct a2 reached worker480 with an in-flight checker cancelled, inner effectsSettled=false/cleanupUnsettled=true and final checker NOT RUN. Outer exit1 and later matching-process inventory0 do not settle inner effects. Original six-file candidate is preserved; separate posthoc original business checking passed in24.080s and independent static review found no blocking defect. These observations cannot relabel TIMEOUT/accepted=false as a correct delivery. SDK51-dispatch subtotalUS$0.55687 is a lower bound; full fees remain unknown. No unchanged retry or promotion. Typecheck/lint and7/7 affected tests passed; the unchanged alternative is kept privately. Elapsed review 470.393s includes waits/interleaving, not active labor. See [I-06](issues.md#i-06--s11s10-descriptive-direct-pi-comparisons-retained-limitations).
- Recorded taskSpec20.035min elapsed readiness and review600.314s elapsed inspection/manual-fix/verification/delivery include interleaving and overlapping subsets; active time and earlier discovery remain unknown. Worker206.761s is actual request-to-result wall, not HTTP latency. Full fee unknown; partial observation at leastUS$0.2559648 is supplemental to the immutable first snapshot. Costs/timings are not a complete speed comparison. Pending items are in [I-11](issues.md#i-11--p12-template-candidate-and-provider-failure) and [I-12](issues.md#i-12--p12-partial-cost-observation-and-immutable-first-snapshot).
## Real-task improvement loop (2026-10-25)

The essential goal is to make Pi deliver real changes more correctly and efficiently. Rank work by kept correct delivery, escaped defects, interventions, total phase time and reference cost over every attempt, including failure/refusal/timeout/unknown; test counts and green CI are not progress. [ADR-010](../docs/decisions/0010-evidence-bound-changes.md) and [ADR-011](../docs/decisions/0011-real-task-improvement-loop.md) remain binding.

### Owner boundaries

- Do not ask further questions or send approval prompts. Record unresolved matters in the [single issue log](issues.md) for later consolidated handling; continue independent authorized work under the existing boundaries.
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
| #103 | Owner deferred merge; preserve the four-file candidate and failed local gate evidence. |
| #105 / #106 / #108 / #111 / #113 / #115 / #120 | Unmerged; current candidates/evidence and permitted handling conditions are recorded in [I-01](issues.md#i-01--runtime-candidates-recorded-for-later-handling). |
| R3 resources | Approved contents retained; exact deferred manual actions are in [I-02](issues.md#i-02--r3-exact-manual-promotions-recorded-for-later-handling). |
| #68 / Phase 1 / R4–R5 | Deferred to the owner; coordinator does not advance them from old plans. |

### R0 preparation candidate (2026-10-25)

Historical evidence moved [verbatim to the archive](archive/2026-10-26-r1-r3-evidence.md#r0-preparation-candidate-2026-10-25).

### R0.6 reference-price integration repair (2026-10-26)

Historical evidence moved [verbatim to the archive](archive/2026-10-26-r1-r3-evidence.md#r06-reference-price-integration-repair-2026-10-26).

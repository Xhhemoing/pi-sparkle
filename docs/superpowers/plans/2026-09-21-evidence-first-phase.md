# Task Plan: Next-phase program — evidence over capability

## Identity

- ID: `TASK-20260921-evidence-first-phase`
- Owner: main agent session (draft); owner decisions required at the gates marked below
- State: `planned` (submitted for expert re-review 2026-09-21)
- Date opened: 2026-09-21
- Related: [external review disposition](../../reports/2026-09-21-external-review-disposition.md) (accepted mainline ordering); [native Pi plan](2026-09-18-native-pi.md); [status matrix](../../status-matrix.md); [projection plan](2026-09-20-native-observation-projection.md) (delivered `a143aad`, hardening amended).

## Problem and Scope

### Problem

The external review's central judgment (accepted): the next phase must move
existing capability from "implemented + exercised" toward **"provably useful
in a real environment with stated bounds"**. Nothing in the repo is
Outcome-supported; real-provider execution is opt-in; live-provider end-to-end
acceptance is not established; the projection slice's only benefit evidence is
a synthetic lifecycle reduction. Continuing to add slices without a
real-environment benefit claim leaves the program's central value question
unanswered.

### In scope — mainline (accepted ordering)

1. **Review-channel decision** *(owner gate, no code)*: preapprove or refuse an
   independent backup review channel that does not share the xhh relay's
   failure domain. Record model/credentials/budget/material scope. "No silent
   fallback" becomes "switch only to an approved path, with a trail; otherwise
   stay blocked." Then re-dispatch the three batched independent reviews
   (apply registration, delegate routing, observation projection) — each
   bound to its own commit, acceptance criteria, and verdict; the
   registration review scope includes disposition R10/R11.
2. **Projection hardening + measurement plan** *(this repo, test-first)*:
   implement the seven amended acceptance criteria in
   [the projection plan](2026-09-20-native-observation-projection.md)
   (disposition R1–R7, R13): sha256 send counter, marker-spoof pin, explicit
   `isError` forwarding, snapshot-after-mutation pin, delete/resume semantics
   pin, payload-prefix pinning, and a written real-token measurement plan.
3. **Real-provider small controlled acceptance** *(opt-in, budget-capped;
   owner gate on budget)*: A (native Pi single-agent baseline) / B (pi-sparkle,
   frozen routing, projection off) / C (B + projection on). 20–30 real tasks ×
   2–3 repeats; frozen task set, repo revision, model set, tool permissions,
   budget, acceptance method. Report per-accepted-task total cost (failures
   and retries included), independent-acceptance success rate, human
   correction time, wall time, and the failure taxonomy (model / tool-runtime /
   provider / auth-quota / spec / expected-refusal). Environment (CPU/memory/
   concurrency/timeouts) recorded per run.
4. **CLI projection wiring decision** *(evidence gate)*: wire projection into
   the CLI only if C-vs-B shows a real benefit at no unacceptable quality
   regression. No CLI wiring before that.
5. **Write-tool registration** *(last)*: only after the execution-boundary
   review closes disposition R10/R11 (acceptance-definition digest binding;
   crash-reconciliation windows). Treated as a capability-boundary expansion,
   not a library exposure.

### Out of scope

- F6 / F-PROD: stays a parked research line with a decision node (below); no
  experiment run, no seal, no adaptive-selection change.
- M7: data-qualification assessment only; no training infrastructure.
- R1/bandit/topology live selection: stays shadow/offline (live-isolation
  allowlist unchanged; R12 behavior pin added in item 2's review scope).
- README/status repositioning: owner decision; not made here.

## Acceptance Criteria

- [ ] Review-channel decision recorded with the preapproved (or explicitly
  refused) backup path and its material scope; the three batched independent
  reviews re-dispatched on an approved channel, each verdict recorded
  separately. Verification: checklist + review records; no silent fallback.
- [ ] Projection hardening: all seven amended criteria in the projection plan
  pass (RED→GREEN), serialized full suite green, live-isolation unchanged.
  Verification: focused runs + `pnpm gate` + updated verification record.
- [ ] Real-provider acceptance report exists with the A/B/C table, the frozen
  configuration, per-accepted-task total cost, success rate, failure taxonomy,
  and environment record; conclusion scoped to the exact task set /
  model/provider / version / configuration. Verification: opt-in report
  (marked `PI_SMOKE`/live-provider evidence class).
- [ ] CLI wiring decision recorded with the C-vs-B evidence it rests on (or an
  explicit decline). Verification: checklist entry + report link.
- [ ] Write-tool registration not started before the execution-boundary review
  closes R10/R11. Verification: boundary-review record gates the slice.
- [ ] F6 decision node recorded (named owner + restart conditions + degrade
  rules, or an explicit drop). Verification: checklist + status-matrix line.
- [ ] Status matrix gains no Outcome-supported claim from items 1–2; item 3
  may justify the first narrowly-scoped Outcome-supported line only after its
  report lands. Verification: status-matrix diff review.

## Implementation Slice

| File/symbol | Change | Owner | Dependency/risk |
|---|---|---|---|
| `tasks/todo.md` + review records | channel decision; three review verdicts | owner + reviewer | relay/back-up channel availability |
| `src/pi-adapter/observation-tools.ts`, `src/pi-adapter/native-executor.ts`, tests | sha256 counter; isError forwarding; hardening pins | main agent | none — additive tests on verified behavior |
| adapter stream-capture pinning test | payload-prefix append-only pin | main agent | must not couple to provider internals |
| `docs/reports/` measurement plan + A/B/C report | new records | main agent | real-provider cost; budget cap required |
| apply-registration review scope doc | add R10/R11 + crash windows | main agent | folds into pending dispatch |
| status matrix | scoped Outcome-supported line (post item 3 only) | main agent | must not overclaim |

## Test-First Plan

- Red tests: sha256 counter key (same-path mutation; head/tail/length
  collision); marker-in-content never packed; explicit `isError` never packed;
  recall returns archived snapshot after source mutation; recall after
  `delete --run` fails closed; payload-prefix append-only capture.
- Focused command: `pnpm test test/unit/pi-adapter test/unit/context test/unit/native`
- Integration/acceptance: serialized full suite + probes before delivery.
- Negative/recovery: resume-restart counters documented; storage-unavailable
  passthrough preserved; disabled path byte-identical.
- Real-provider acceptance is an opt-in live run, recorded as such, never
  claimed from loopback tests.

## Gates and Handoff

- Human/policy gates: (a) backup-channel approval; (b) real-provider budget
  cap; (c) CLI wiring decision on evidence; (d) write-tool registration after
  the boundary review. Items 1/3/4/5 are owner-gated.
- Rollback/abort condition: any live-isolation allowlist change aborts item 2;
  any real-provider acceptance regression beyond the predeclared tolerance
  blocks item 4 (default-off projection stays default-off).
- Required durable records: disposition (done), three review verdicts,
  measurement plan, A/B/C report, CLI decision entry, F6 decision node.
- Next command after owner approval of item 1: re-dispatch the three reviews;
  start item 2 RED tests in parallel (no owner gate).

## Closeout

- Verified commit/date: pending.
- Commands and outcomes: pending.
- Open risks/follow-ups: relay/back-up channel availability; real-provider
  cost; F6 external materials; SCM/xhh #36 evidence still unresolved.
- Evidence links: [disposition](../../reports/2026-09-21-external-review-disposition.md).

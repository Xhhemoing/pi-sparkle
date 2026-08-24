# SOTA architecture audit — 2026-08-24

Scope: global architecture and honesty audit of the developer-preview
runtime against the claims in [status-matrix.md](../status-matrix.md),
[README](../../README.md), and
[m0-m2-architecture.md](../specs/m0-m2-architecture.md). Evidence is the
committed tree at branch `agent/sota-persistent-opt-7e63` (baseline
`9a7cb17`); concurrent Round 1 work in flight is marked as such. Nothing
here claims Outcome-supported, closes F-PROD, or recommends enabling live
R1/bandit/topology (ADR-005; ADR-006 stays Proposed).

## Method

- Read every claim row in the status matrix and traced it to code and tests.
- Computed the **transitive** import closure of the ten files the live
  isolation test declares as the live plane (script, not grep-by-eye):
  156 files reachable from `src/cli/main.ts` and peers.
- Cross-checked the CLI `USAGE` string, the README command table, and the
  actual `switch` dispatch in `src/cli/main.ts`.
- Mapped `src/<dir>` against `test/unit/<dir>` + `test/integration/<dir>`
  and searched for source files no test imports (directly or via CLI
  dispatch tests).

## 1. Findings that were corrected in docs (same-day honesty patches)

### 1.1 `--children` is executed by the flowchart engine, not `startParentRun`

`src/cli/main.ts:709–764` compiles the child spec through
`compileChildrenToFlowchart` (`main.ts:732`) and executes it with
`startFlowchartRun(..., cluster: true, childTasks, assignments)`
(`main.ts:748`). Child protocol semantics survive inside the flowchart run
via `ChildCoordinator` (`src/run/flowchart-run.ts:241`). The M1 entry
`startParentRun` (`src/run/coordinator.ts:224`) is now called **only by
tests** (`test/integration/m1/parent-run.test.ts`,
`test/integration/cluster/*`, `test/integration/m3/coverage-gate.test.ts`).

The status-matrix note "Not the flowchart engine" was stale and has been
corrected. Two documents that still carry the stale claim are outside this
audit's write scope and need the same one-line fix (handoff):

- `README.md:85` — "`--children` runs a parent coordinator over those tasks
  (it is not the `--flowchart` engine)" and `README.md:174` — "`--children`
  is still the parent coordinator, not compiled into flowchart".
- `docs/specs/m0-m2-architecture.md` §Milestone names —
  "`compileChildrenToFlowchart` is a library helper and is not the live
  `--children` path".

### 1.2 Coverage-gate wiring note was imprecise

`assertCoverageAllowsStart` fires at `startFlowchartRun`
(`src/run/flowchart-run.ts:759`, contract + childTasks present),
`startParentRun` (`src/run/coordinator.ts:226`, tests-only entry), and
`startSupervisedRun` (`src/run/supervisor.ts:500`). The live CLI paths that
actually provide a contract are `--track` (built in `src/track/loop.ts`)
and library callers; plain CLI `--children` passes no contract, so no gate
fires there — which is consistent with the documented "skip-contracts still
start" rule but was not what "parent start" implied. Matrix note corrected.

### 1.3 R1/bandit/topology isolation: true at the decision level, weaker at the import level

Verified: no live path **reads** R1, bandit, shadow, or topology state to
make a routing decision. Live routing is `createModelRouter` (R0-equivalent)
plus the promoted routing-policy pointer (`loadLearnedRouting`,
`src/learning/learned-routing.ts:114` — registry pointer with content-hash
check; the legacy `routing.json` write path throws).

However the enforcement is narrower than the old matrix note implied:

- `test/unit/routing/live-isolation.test.ts` checks **direct** imports of a
  hardcoded ten-file list. It does not compute transitive closure and does
  not cover `src/run/flowchart-executor.ts`, `src/run/child-coordinator.ts`,
  `src/run/scheduler.ts`, `src/routing/assign-plan.ts`,
  `src/routing/analyze-task.ts`, `src/routing/live-selection.ts`, or
  `src/cluster/*`.
- The transitive closure of the live plane **does** reach
  `src/routing/bandit.ts` via
  `cli/main.ts → learning/auto-loop.ts → learning/bandit-store.ts`. This is
  a post-run, adaptation-plane **write** of project bandit statistics
  (`updateProjectBandit`, `src/learning/auto-loop.ts:90`); the read side
  (`loadProjectBandit`) has **zero consumers** anywhere in `src/` or
  `test/`, so bandit state cannot influence a live decision today.
- `src/run/supervisor.ts:40` imports `routing/topology.js` for
  `planTaskTopology`, which is deliberately defined-but-unused and pinned by
  the isolation test ("must stay defined but unused in the live loop").

Matrix note updated to state the actual enforcement. Recommendation (P0,
test-only, no behavior change): upgrade `live-isolation.test.ts` to a
transitive-closure check over the real CLI entry graph with a justified
allowlist, mirroring the pattern already used by
`test/unit/privacy/plane-boundary.test.ts`.

### 1.4 CONTRIBUTING drift

The project-structure block listed a nonexistent `preference/` directory
(actual: `src/preferences/`) and omitted the `pnpm gate` one-shot that
`package.json` defines and CI mirrors. Both fixed.

## 2. Module-boundary status (verified, no patch needed)

- **Pi package boundary holds.** Only `src/pi-adapter/*` imports
  `@earendil-works/*` (6 files), pinned by `test/unit/pi-boundary.test.ts`.
- **Adaptation → runtime reads are allowlisted and justified.**
  `test/unit/privacy/plane-boundary.test.ts` pins every
  adaptation-plane import of runtime modules with a per-entry justification
  (type-only Event shapes; the sanctioned PASS/FAIL derived-signal reader in
  `learning/from-episode.ts`). Gap: its `RUNTIME_MODULES` prefix list omits
  `../supervisor/` and `../cli/`, so `src/adaptation/eval-routing.ts:27`
  (type-only `ModelRouterConfig` import from `supervisor/model-router.js`)
  passes unchecked. Low risk (type-only), but it should be an explicit
  allowlist entry, not a blind spot.
- **Plane storage split is real.** `src/privacy/state-layout.ts` separates
  `<stateRoot>/runtime/` from `<stateRoot>/adaptation/` with the boundary
  rule documented at the source.

## 3. CLI ↔ docs drift (handoff — README is out of scope for this audit)

The dispatcher in `src/cli/main.ts` supports: `run`, `inspect`, `resume`,
`answer`, `auth`, `models`, `pref`, `adapt`, `episode`, `delete`, `commits`,
`pause`, `inject`, `doctor`, `version`, `help`. The CLI `USAGE` string
covers all of them. The README command table covers only `version`, `run`,
`inspect`, `resume`, `adapt`, `doctor` — the following are **absent from the
README entirely** (zero mentions): `answer`, `pause`, `inject`,
`episode events|close`, `pref`, `delete`, `commits preview|apply`.

Minor internal drift: `USAGE` lists a bare `pi-sparkle adapt promote`
(`main.ts:231`) while promotion actually requires
`--candidate --expected --content-file --review-file --approve`
(`src/cli/adapt.ts:249–261` refuses otherwise; the `adapt`-scoped usage
string documents the full form). The top-level line should show the full
form so nobody reads bare `promote` as supported.

## 4. Test-coverage holes (committed baseline `9a7cb17`)

Per-directory unit/integration counts are healthy overall
(e.g. routing 31 src / 27 unit; tracking 12/12; requirement 7/7). Files no
committed test imports directly or exercises via CLI dispatch:

| File | Risk | Note |
|---|---|---|
| `src/persist/file-lock.ts` | **High** — concurrency primitive guarding bandit/preference writes | Zero tests at baseline. (Round 1 in-flight: `test/unit/persist/file-lock.test.ts` being added by another slot.) |
| `src/learning/bandit-store.ts` | Medium | Exercised only transitively via auto-loop; arms-union merge, non-deterministic-signal filtering, and lock behavior have no direct assertions. |
| `src/pi-adapter/auth-session.ts`, `src/pi-adapter/cluster-tools.ts` | Medium | Reachable only through opt-in `PI_SMOKE=1`; no fake-backed unit path. |
| `src/run/child-tracking.ts` | Low-medium | Live-plane file (in the isolation list) with only transitive coverage. |
| `src/cluster/host.ts` | Low | Heavy transitive coverage via cluster/m2.5 integration. |
| `src/supervisor/flowchart.ts` | Dead code | Re-export barrel with **zero importers** in `src/` and `test/`. Delete or justify. |
| `src/domain/index.ts`, `src/tracking/index.ts`, `src/pi-adapter/index.ts`, `src/toolchain.ts` | Trivial | Barrels / one-line constant. |

Also dead at baseline: `loadProjectBandit` (exported, never consumed) and
`saveLearnedRouting` (intentional deprecated thrower — fine as a tombstone,
already covered by the "routing.json is not a live policy store" refusal).

## 5. SOTA gaps vs a developer-preview multi-agent runtime bar

Assessment of the six preview-critical planes. "Solid" means wired +
exercised with tests cited; it never means Outcome-supported.

1. **Resume — solid.** Checkpoint + replay with event log as source of
   truth; truncated JSONL tail recovered, corrupt middle fails closed
   (`test/unit/run/replay.test.ts`, `test/unit/persist/jsonl.test.ts`);
   flowchart resume, supervised resume, answer/unpause
   (`test/integration/m2/resume.test.ts`, `m2.5/resume.test.ts`). Gap: no
   property/fuzz crash-injection tests and no cross-process contention test
   at baseline (file-lock hole above).
2. **Stall — solid.** `consecutiveStalls` on the ledger, `STALL_DETECTED`
   with `requiredEvidence`, BLOCKED transition
   (`src/run/supervisor.ts:316–325`, `src/supervisor/ledger.ts`,
   `test/unit/supervisor/ledger.test.ts`, `test/integration/m2/supervisor.test.ts`).
3. **Evidence — good, one invariant missing.** Evidence ledger, inspect
   surfaces evidence, claims without evidence stay unverified. Gap: no
   suite-level invariant that a COMPLETED terminal node carries ≥1 evidence
   ref — today that is per-path convention, not a pinned rule.
4. **Routing isolation — decision-level clean, import-level enforcement is
   direct-only** (§1.3). Upgrade the test, do not touch the runtime.
5. **Privacy planes — strong for a preview.** Plane layout + delete cascade
   + tombstone propagation + fail-closed legacy reads
   (`test/unit/privacy/*`, `test/unit/preferences/deletion-replay.test.ts`).
   Known open item: `redactPII` is label-only (weak-areas report §4.1;
   Round 1 in-flight fix by another slot). The plane-boundary test prefix
   gap (§2) is the remaining seam.
6. **Eval independence — modeled and tested.** `EvaluationRecord` carries
   target artifact/version and an independence class; missing outcomes stay
   Unobserved (`src/evaluation/evaluator.ts`, unit + `m3/checkpoint-d`).
   Judge calibration data does not exist and must not be claimed before the
   F line; that is by design, not a defect.

## 6. Ranked follow-up work (Round 2/3)

Owner hints follow the loop slots: `opus` = core implementation slots,
`gpt-sol` = benchmarks / persist stress / boundary probes.

**P0**

1. (opus) Transitive-closure rewrite of `live-isolation.test.ts` with a
   justified allowlist (bandit-store post-run write; parked
   `planTaskTopology`). Test-only; closes the strongest honesty seam found.
2. (opus, needs README unlock from the parent) Fix the two stale
   `--children` claims in `README.md` (lines 85, 174) and the one in
   `docs/specs/m0-m2-architecture.md`; add the seven missing commands to the
   README table.
3. (gpt-sol) `file-lock` cross-process stress + checkpoint-store
   crash-mid-rename tests (partially in flight in Round 1; finish and keep).

**P1**

4. (opus) Extend `plane-boundary.test.ts` `RUNTIME_MODULES` with
   `../supervisor/`, `../cli/`, `../track/`, `../cluster/`; allowlist
   `eval-routing.ts`'s type-only import with justification.
5. (opus) `USAGE`: show the full `adapt promote` argument form at top level.
6. (gpt-sol) Acceptance-level invariant: COMPLETED terminal ⇒ ≥1 evidence
   ref, across fake-run fixtures.
7. (opus) Remove the orphan `src/supervisor/flowchart.ts` barrel; decide
   `loadProjectBandit` (test it or delete it).
8. (gpt-sol) Direct unit tests for `bandit-store` merge/filter semantics.

**P2**

9. Fake-backed unit coverage for `pi-adapter/auth-session.ts` and
   `cluster-tools.ts` so the smoke suite is not their only proof.
10. Verify the Round 1 in-flight `doctor --json` freeze and
    `migrate-legacy` land with tests; fold both into the status matrix.
11. Surface `STALL_DETECTED.requiredEvidence` in `inspect --json` if it is
    not already part of the frozen inspection payload (verify first).

**Standing constraints** — unchanged and re-affirmed by this audit: no
Outcome-supported claims anywhere (nothing in this repo qualifies); F-PROD
and the P0 human sign-off stay open; ADR-006 stays Proposed; live
R1/bandit/topology stay off the execution path.

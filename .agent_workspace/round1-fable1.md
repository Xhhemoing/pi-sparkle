# Round 1 fable-1

MODEL_SLUG: claude-fable-5-thinking-xhigh

## Implemented (docs)

- `docs/reports/2026-08-24-sota-architecture-audit.md` — public audit report
  (method, findings with file:line evidence, ranked P0/P1/P2 work list).
- `docs/status-matrix.md` — three honesty patches (see below). Definitions
  untouched; no Outcome-supported change; F-PROD and P0 sign-off untouched.
- `CONTRIBUTING.md` — two provable fixes (see below).

## Findings (evidence)

1. **`--children` is executed by the flowchart engine.** The CLI compiles
   the child spec via `compileChildrenToFlowchart` (`src/cli/main.ts:732`)
   and runs `startFlowchartRun(..., cluster: true)` (`main.ts:748`);
   `ChildCoordinator` preserves child protocol semantics inside the
   flowchart run (`src/run/flowchart-run.ts:241`). `startParentRun`
   (`src/run/coordinator.ts:224`) is called only by tests
   (`test/integration/m1/parent-run.test.ts`, `cluster/*`,
   `m3/coverage-gate.test.ts`). Status-matrix note "Not the flowchart
   engine" was stale; README:85, README:174, and
   `docs/specs/m0-m2-architecture.md` §Milestone names still carry the
   stale claim (out of my write scope — handoff).
2. **Coverage-gate wiring note was imprecise.** `assertCoverageAllowsStart`
   fires at `startFlowchartRun` (`flowchart-run.ts:759`), `startParentRun`
   (tests-only), `startSupervisedRun` (`run/supervisor.ts:500`). Only
   `--track` builds a contract on a live CLI path; plain `--children`
   passes none.
3. **Isolation enforcement is direct-import-only.** Transitive closure of
   the declared live plane (156 files, computed by script) reaches
   `src/routing/bandit.ts` via `cli/main.ts → learning/auto-loop.ts →
   learning/bandit-store.ts` — a post-run adaptation-plane **write**
   (`updateProjectBandit`, auto-loop.ts:90). No live read exists:
   `loadProjectBandit` has zero consumers. `run/supervisor.ts:40` imports
   `routing/topology.js` for the pinned defined-but-unused
   `planTaskTopology` (enforced by `live-isolation.test.ts`). The old
   matrix note over-claimed; corrected to state actual enforcement.
4. **Plane-boundary test blind spot.** `RUNTIME_MODULES` in
   `test/unit/privacy/plane-boundary.test.ts` omits `../supervisor/` and
   `../cli/`; `src/adaptation/eval-routing.ts:27` imports type-only
   `ModelRouterConfig` from `supervisor/model-router.js` unchecked.
5. **CLI/docs drift.** README command table omits `answer`, `pause`,
   `inject`, `episode events|close`, `pref`, `delete`,
   `commits preview|apply` entirely (zero README mentions; all present in
   the `USAGE` string and dispatch switch). `USAGE` line `adapt promote`
   (main.ts:231) omits the required
   `--candidate/--expected/--content-file/--review-file/--approve`
   (refusal at `src/cli/adapt.ts:249–261`).
6. **Test-coverage holes at baseline `9a7cb17`** (no direct or
   CLI-dispatched test): `src/persist/file-lock.ts` (high — concurrency
   primitive; gpt-sol-1 adding a test in flight),
   `src/learning/bandit-store.ts`, `src/pi-adapter/auth-session.ts`,
   `src/pi-adapter/cluster-tools.ts` (smoke-only), `src/run/child-tracking.ts`
   (transitive only), `src/supervisor/flowchart.ts` (**orphan barrel, zero
   importers — dead code**), plus trivial barrels.
7. **Boundaries that hold:** Pi imports confined to `src/pi-adapter/*`
   (pinned by `test/unit/pi-boundary.test.ts`); plane storage split real
   (`src/privacy/state-layout.ts`); adaptation→runtime reads allowlisted
   with justifications (plane-boundary test); promoted routing-policy is
   the only learned live input, hash-checked (`learned-routing.ts:114`),
   legacy `routing.json` write refused.

## Honesty patches

- `docs/status-matrix.md` `--children` row: replaced stale "Not the
  flowchart engine" with the compile-to-flowchart truth; noted
  `startParentRun` is library/test-only. Dated 2026-08-24.
- `docs/status-matrix.md` Coverage-gate row: "Wired" cell now says
  "`--track` / library starts with a contract"; note names the three
  `assertCoverageAllowsStart` sites and that plain `--children` has no
  contract.
- `docs/status-matrix.md` R1/bandit/topology row: note now states the
  actual enforcement (direct-import check of ten files, pinned unused
  `planTaskTopology`, post-run bandit write with zero live readers).
  The "shadow / offline only" Wired cell and the F-PROD prohibition are
  unchanged.
- `CONTRIBUTING.md`: `preference/` → `preferences/` (directory does not
  exist under the old name); added `pnpm gate` row to the quality-gate
  table (script exists in `package.json`, mirrored by CI).

## SOTA gaps vs preview bar

- Resume: solid (m2/m2.5 resume tests, truncated-tail recovery); missing
  crash-injection/property tests and cross-process contention coverage.
- Stall: solid (`STALL_DETECTED` + `consecutiveStalls` + BLOCKED,
  `run/supervisor.ts:316–325`).
- Evidence: good; missing a pinned invariant "COMPLETED terminal ⇒ ≥1
  evidence ref".
- Routing isolation: decision-level clean; import-level enforcement needs
  a transitive-closure test (do NOT touch runtime code).
- Privacy planes: strong; `redactPII` label-only gap is opus-1's in-flight
  Round 1 fix; plane-boundary prefix gap remains.
- Eval independence: modeled + tested (`EvaluationRecord` independence
  classes, Unobserved never fabricated); no judge calibration by design —
  must stay unclaimed until the F line.

## Ranked next-round work

- **P0-1 (opus):** transitive-closure rewrite of `live-isolation.test.ts`
  with justified allowlist (test-only).
- **P0-2 (opus, parent must unlock README):** fix stale `--children`
  claims in README:85/174 and `m0-m2-architecture.md`; add the seven
  missing commands to the README table.
- **P0-3 (gpt-sol):** finish file-lock cross-process stress +
  checkpoint-store crash-mid-rename tests.
- **P1-4 (opus):** extend plane-boundary `RUNTIME_MODULES` (+ allowlist
  eval-routing type-only import).
- **P1-5 (opus):** full `adapt promote` form in top-level USAGE.
- **P1-6 (gpt-sol):** evidence-invariant acceptance test.
- **P1-7 (opus):** delete orphan `src/supervisor/flowchart.ts`; test or
  delete `loadProjectBandit`.
- **P1-8 (gpt-sol):** direct `bandit-store` unit tests.
- **P2:** fake-backed `auth-session`/`cluster-tools` units; verify in-flight
  `doctor --json` + `migrate-legacy` land with tests and matrix rows;
  check whether `inspect --json` surfaces `requiredEvidence`.

## Tests run

- `pnpm test -- test/unit/routing/live-isolation.test.ts
  test/unit/privacy/plane-boundary.test.ts test/unit/pi-boundary.test.ts`
  → 7/7 pass.
- `pnpm test -- test/integration/m1/cli-children.test.ts` → 8/8 pass
  (sanity for the `--children` row I re-worded).
- No typecheck needed: docs-only edits, no export-dependent claims.

## Blocked / handoff

- `README.md:85` and `README.md:174` — stale "`--children` is not the
  flowchart engine / not compiled into flowchart" claims; command table
  missing `answer`, `pause`, `inject`, `episode`, `pref`, `delete`,
  `commits`. (README forbidden this round.)
- `docs/specs/m0-m2-architecture.md` §Milestone names — same stale
  `compileChildrenToFlowchart` claim. (Not in my write paths.)
- `src/cli/main.ts:231` — bare `adapt promote` USAGE line. (src/ forbidden.)
- `test/unit/routing/live-isolation.test.ts` and
  `test/unit/privacy/plane-boundary.test.ts` upgrades. (src/test forbidden
  to this slot; specs above.)
- `src/supervisor/flowchart.ts` deletion and `loadProjectBandit`
  test-or-delete. (src/ forbidden.)

gpt-5.6-sol

# Loop 4 · Round 6 · R6-9 — exported-but-unused surface census

Baseline: `b4cc07209d57516fbe7b5dcbaf143e722aff2150` on
`agent/opt-continuous`. During the slot, the shared branch advanced to
`e472359`; this agent did not change branches or commit.

## Pre-edit ownership claim

Recorded before any source or test edit:

- sole claim: `src/episode/closure.ts`
- sole claim: `test/unit/episode/closure.test.ts`
- sole claim: `src/agents/dispatch-preflight.ts`
- sole claim: `test/unit/agents/dispatch-preflight.test.ts`
- sole claim: `src/graph/compile-children.ts`
- sole claim: `test/unit/graph/compile-children.test.ts`
- report: `.agent_workspace/loop4-r6-t9.md`

No other `src/**` or `test/**` file is claimed. These two additional source
claims were recorded before either file was edited. In particular,
`src/run/supervisor.ts` (R6-3) and `src/run/flowchart-run.ts` (R6-1) are
report-only.

## Census status

Complete.

## Census method and accounting

I parsed the `tsconfig.json` program with the TypeScript compiler API, collected
top-level direct exports under `src/**`, resolved aliases, and counted actual
identifier references. A declaration's own identifier was excluded; a
same-file implementation use counted as production use; import declarations and
barrel re-exports did not count as callers. I then separately counted `test/**`
references and audited every dynamic `import()` and every `export { ... }`
barrel. Finally, exact repo-wide symbol searches checked the candidates selected
for deletion and the two round-owned report-only files.

At the clean baseline this found 1,428 symbol-resolvable direct exported
declarations and 158 with no statically resolved production use. The dynamic
import audit corrected three false positives:

- `listSparkleModels` is called from `src/cli/models.ts`.
- `listSparkleProviders` is called from `src/pi-adapter/auth-session.ts`.
- `resolveListedModel` is called from `src/cli/models.ts` and
  `src/cli/model-catalog.ts`.

Thus the baseline census is **155 genuine no-production-caller exports**.
Tests-only references remained classified as no caller. During the shared-tree
round, R6-4 made two of those live through `src/cli/doctor.ts`:
`loadProjectBandit` and `loadCatalogObservedSnapshot`. This slot removed three.
The final shared-tree rerun therefore reports **150 remaining no-caller
exports** (`155 - 2 newly live - 3 removed`).

## Dispositions

### Removed, with pins (3)

1. `src/episode/closure.ts::closeEpisode` — no caller and no test imported it;
   it duplicated the canonical, live event-producing
   `src/episode/manager.ts::closeEpisode`. The closure module now contains only
   closure policy. Its unit pin asserts the duplicate export remains absent.
2. `src/agents/dispatch-preflight.ts::DispatchPreflightError` — never
   constructed, thrown, caught, tested, re-exported, or documented. All callers
   consume the discriminated `DispatchPreflight` result. Its unit pin asserts
   the unused throw-wrapper does not return.
3. `src/graph/compile-children.ts::compilableChildFrom` — no caller, test,
   barrel, or documented input path. Production already decodes child specs and
   passes typed `CompilableChild` values to the live compiler. Its unit pin
   asserts the raw-role adapter remains absent.

All three pins are namespace-export assertions: reintroducing the old export
without a live caller turns its owned test red.

### Became live during the census (2)

- `src/learning/bandit-store.ts::loadProjectBandit`
- `src/routing/catalog-observed.ts::loadCatalogObservedSnapshot`

Both were tests-only at baseline. R6-4 now imports and calls each from
`src/cli/doctor.ts`, exactly the shipped-reader use required by that slot. They
are no longer no-caller findings; this slot did not touch either file.

### Remaining seams (150), judged individually

Legend:

- **A — adaptive/offline library seam.** Published by the developer-preview
  status matrix's “Adaptive library line” or its explicit offline/shadow
  machinery. Module/acceptance tests are its intended consumers until the
  documented production gate opens; they were not counted as production calls.
- **B — barrel seam.** Explicitly re-exported by `tracking/index.ts` or
  `supervisor/flowchart.ts`; this is stronger evidence than merely carrying an
  `export` modifier.
- **C — canonical contract seam.** Public decoder, validator, persisted shape,
  or developer-preview library surface named by the runtime architecture,
  structured-protocol ADR, or status matrix. Tests witness that contract.
- **D — explicitly documented library/test seam.** The README/status matrix
  says it is library/test-only and intentionally retained.
- **H — harness seam.** Deliberately exported from `src/testing` or the package
  smoke entry for external integration tests.
- **T — compatibility tombstone.** Kept specifically to refuse an obsolete
  write path with the documented remedy.

Every remaining candidate is listed once:

**A — adaptive/offline library seams**

- `adaptation/approval-profile.ts`: `createInstalledAutoAdaptProfile`
- `adaptation/candidate.ts`: `isCandidate`
- `adaptation/monitor.ts`: `createAdaptationDriftMonitor`
- `adaptation/mutate.ts`: `MUTATABLE_KINDS`
- `adaptation/pareto.ts`: `paretoFront`
- `adaptation/promotion.ts`: `reconstructPromotion`, `PromotionService`
- `adaptation/reflection.ts`: `proposeCandidates`,
  `assignEvaluationSplit`, `assertSplitSeparation`,
  `assertPromotableFromSupport`, `evaluateProposalShadow`
- `adaptation/retirement.ts`: `retireVersion`, `assertAssignable`, `isRetired`
- `context/index.ts`: `createEmptyContext`, `refreshProjectContextIndex`
- `context/packet.ts`: `compilePacket`, `queryPacketGrounding`
- `evaluation/check-adapter.ts`: `createCheckAdapter`
- `evaluation/delivery-adapter.ts`: `createDeliveryAdapter`
- `evaluation/diff-adapter.ts`: `createDiffAdapter`
- `evaluation/evaluator.ts`: `EvaluationResult`, `createEvaluationRecord`,
  `canEvaluatorScoreCriterion`, `validateEvaluatorScope`
- `evaluation/ownership.ts`: `classifyDiffScope`
- `evaluation/precedence.ts`: `selectHighestPrecedence`
- `experiments/attribution-report.ts`: `writeAttributionPair`
- `experiments/canary.ts`: `createCanaryRunner`
- `experiments/dataset.ts`: `sealedManifestHash`, `rotateHoldout`
- `experiments/isolation.ts`: `assertWritablePath`
- `experiments/manifest.ts`: `markHoldoutCompromised`,
  `assertHoldoutUsable`, `createManifest`
- `experiments/replay.ts`: `replayPolicy`
- `experiments/shadow-compare.ts`: `compareShadowR1`
- `experiments/simulation-holdout.ts`: `runSimulationHoldout`
- `experiments/threshold-calibration.ts`: `calibrateSoftThreshold`
- `feedback/redaction.ts`: `applyRedaction`
- `feedback/store.ts`: `readFeedback`
- `feedback/types.ts`: `EvaluationResult`
- `learning/attribution.ts`: `attributeToBoundary`
- `learning/from-episode.ts`: `proposeRoutingFromAssignments`
- `learning/learned-routing.ts`: `learnedRoutingPath`,
  `policyFromAssignments`
- `learning/patterns.ts`: `detectRepeatedPatterns`
- `learning/signatures.ts`: `ComparableEpisodePair`, `createSignature`,
  `compareSignatures`
- `learning/task-success.ts`: `taskSuccessFromExitCode`
- `preferences/export.ts`: `exportForDataset`
- `preferences/loop-eval.ts`: `evaluatePreferenceLoop`
- `preferences/materialize.ts`: `materializeView`
- `preferences/precedence.ts`: `selectHighestPriority`,
  `explicitOverridesInferred`
- `preferences/service.ts`: `isDeleted`, `clearAll`
- `preferences/store.ts`: `configureMinInferredRecurrence`,
  `recordObservation`, `getObservationsByKey`, `findConflicts`,
  `clearPreferences`
- `requirement/normalizer.ts`: `buildContractFromSources`
- `review/critic.ts`: `createCriticObservation`
- `review/pairwise.ts`: `runBlindPairwisePair`
- `review/self-review.ts`: `applyRoutingScoreUpdate`
- `routing/assign.ts`: `assignOne`
- `routing/capability-registry.ts`: `registerModel`, `getModel`,
  `listModels`, `resetModelRegistry`
- `routing/cascade-evidence.ts`: `applyEvidenceCascade`
- `routing/catalog-observed.ts`: `CATALOG_OBSERVED_RELATIVE`,
  `observedStatsForVersion`, `persistCatalogObserved`,
  `buildCatalogObservedFromStateRoot`
- `routing/feature-version.ts`: `FEATURE_VERSION_REASONS`
- `routing/offline-types.ts`: `parseOfflineRow`
- `routing/propensity.ts`: `computeOverlapDiagnostics`,
  `validateCounterfactualReport`, `isFabricatedPositiveSupport`
- `routing/public-prior.ts`: `loadPublicPriorFile`
- `routing/shadow.ts`: `createShadowRunner`, `createShadowState`
- `routing/topology.ts`: `decideAfterFailedReflection`
- `rubric/registry.ts`: `registerRubric`, `getActiveRubric`, `listRubrics`,
  `resetRubricRegistry`
- `rubric/types.ts`: `createRubric`
- `task/taxonomy.ts`: `stampTaxonomyVersion`, `recordedTaxonomyVersion`
- `telemetry/model-invocation.ts`: `RUN_TO_RUN_NOTE`, `compareRunToRun`
- `telemetry/usage-aggregate.ts`: `costEligibleInvocations`, `sumUsage`
- `tracking/types.ts`: `isUnobserved`

The zero-test members in this group are not being excused merely because they
are exported: `MUTATABLE_KINDS` is the runtime value companion to the published
mutation-kind API; both `EvaluationResult` interfaces are public result shapes;
`policyFromAssignments` and `ComparableEpisodePair` are offline library input
shapes/builders; `CATALOG_OBSERVED_RELATIVE` is the canonical derived-state
relative path; `RUN_TO_RUN_NOTE` is the comparison API's frozen honesty
disclosure; and `isUnobserved` is the public guard for the tracking sentinel.

**B — explicit barrel seams**

- `domain/flowchart.ts`: `FlowchartEdge`, `defaultEvidencePolicy`,
  `FlowchartNode` (via `supervisor/flowchart.ts`; both type aliases also carry
  explicit compatibility comments)
- `supervisor/model-router.ts`: `RoutableModel`,
  `effectiveConfidenceThreshold`, `routeTask`, `routeFlowNode` (via
  `supervisor/flowchart.ts`)
- `tracking/analysis.ts`: `proposeFromAnomaly`
- `tracking/config.ts`: `applyUserThreshold`, `trackingConfig`
- `tracking/isolation.ts`: `bindExecutionContext`,
  `executionMayNotReadSummary`
- `tracking/types.ts`: `evidenceWeight`

**C — canonical contract/developer-preview seams**

- `agents/dispatch-preflight.ts`: `createPiDispatchGuard`
- `agents/registry.ts`: `isAgentProfile`
- `cli/errors.ts`: `parseCliErrorJson`
- `cli/model-catalog.ts`: `createCliModelRouter`
- `domain/contract.ts`: `validateCoverageMatrix`
- `domain/evidence.ts`: `isEvidence`, `validateEvidence`, `isArtifact`,
  `validateArtifact`
- `domain/ids.ts`: `createArtifactId`, `createAgentProfileId`,
  `parseAgentProfileId`, `parseEventId`
- `domain/limits.ts`: `validateRunLimits`
- `domain/state.ts`: `assertTransitionRun`
- `domain/task.ts`: `validateTaskCollection`
- `episode/events.ts`: `EpisodeEventType`
- `episode/manager.ts`: `reduceEpisodeEvents`
- `graph/judge.ts`: `isJudgeDecision`, `validateJudgeDecision`
- `graph/readiness.ts`: `computeReadyTasks`
- `privacy/deletion.ts`: `tombstoneIds`,
  `materializeWithoutTombstones`, `FREE_TEXT_FEEDBACK_FIELDS`
- `privacy/record-classes.ts`: `durableRecordClassById`
- `protocol/v1.ts`: `MessageType`, `validateApprovalReply`,
  `isApprovalReply`, `isAgentMessage`, `assertAtMostOneTerminal`
- `run/gate-apply.ts`: `executionAuthority`

The zero-test members here are canonical vocabulary or paired predicates, not
standalone behavior: `EpisodeEventType` and `MessageType` name persisted/wire
unions; `isEvidence`/`isArtifact` are non-throwing counterparts to the
contract's throwing validators. Their structured-protocol/domain modules are
the published adapter boundary.

**D — explicitly documented library/test seams (report-only where owned)**

- `run/coordinator.ts`: `startParentRun` — README and status matrix explicitly
  call it the original library/test-only entry.
- `run/supervisor.ts`: `planTaskTopology`, `startSupervisedRun` — the first is
  explicitly documented as parked/offline; the latter is the supervised
  library start used by the documented coverage-gate and resume contracts.
  This file belongs to R6-3 and was not edited.

**H — harness seams**

- `testing/fake-executor.ts`: `GatedExecutor`, `ProtocolChildExecutor`
- `toolchain.ts`: `PROJECT_NAME`

**T — compatibility tombstone**

- `learning/learned-routing.ts`: `saveLearnedRouting` — its docstring,
  architecture audit, and routing briefing deliberately retain this exported
  thrower so obsolete `routing.json` writers fail with the registry-promotion
  remedy instead of silently recreating a second live policy store.

## Report-only findings for round-owned files

- `src/run/supervisor.ts` (R6-3): `settleSupervisedOutcome` has one production
  caller, so it is not itself in the no-caller list. However, that caller omits
  `trackingAssessment`; no test calls the function; and no other
  `trackingAssessment` occurrence exists. Therefore its assessment branch is
  unreachable on every production and test path. This confirms the brief's
  residual and is handed to R6-3. I made no edit.
- `src/run/flowchart-run.ts` (R6-1): no exported declaration entered the
  baseline no-production-caller census. I made no edit.

## Verification

- Focused owned tests:
  `test/unit/episode/closure.test.ts`,
  `test/unit/agents/dispatch-preflight.test.ts`, and
  `test/unit/graph/compile-children.test.ts` — **17/17 pass, 0 fail,
  0 skipped**.
- Scoped ESLint on all six claimed source/test files — clean.
- Whole-tree `pnpm exec tsc --noEmit` — clean, 0 errors.
- Scoped `git diff --check` — clean.
- Full gate not run; it is the parent's responsibility. No timing-sensitive
  test or performance claim is involved.

The shared tree contained concurrent R6-1/R6-3/R6-4/R6-7 edits in
`src/run/**`, `src/cli/**`, tests, and docs. They were neither claimed nor
edited here. No scratch file, dependency edit, branch change, commit, or push
was made.

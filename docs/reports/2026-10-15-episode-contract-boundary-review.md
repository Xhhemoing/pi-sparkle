# Episode contract census: typed host acceptance

## Plan recorded before test changes

- Task: `TASK-20261015-episode-contract-census`; owner: native loop agent; state: `ready-for-review`.
- Baseline: integrated stage-two worktree after the full suite reported `src/development/controller.ts:runNext` as an episode-contract reconstruction.
- Contract: episodes are lossy closure projections, never authority for run contracts, constraints, or per-task criteria. Existing episode-binding/model and no-contract resume pins remain authoritative. Related status: episode bind / inspect row in `docs/status-matrix.md`; controlling stage-two plan: `docs/superpowers/plans/2026-10-15-development-control-plane.md`.
- Finding: the controller reads host `WorkItemDefinition.acceptance` recipes and `NativeWriteSessionResult.acceptance` independent verdicts. Neither comes from an episode. The census currently interprets every property named `acceptance` as episode data, so this is a heuristic collision, not evidence of a runtime contract violation.

Scope is only `test/unit/run/episode-contract-boundary.test.ts` and this report. No controller, runtime, DTO, persisted schema, task policy, or gate changes.

Acceptance criteria and test-first sequence:

1. Add a benign host DTO fixture at the same controller path/function as the failure, with imported real host types; demonstrate RED under the original census.
2. Preserve conservative scanning of all modules and all existing authority fields. Only exempt an `acceptance` receiver whose property declaration resolves to the exact `WorkItemDefinition` interface in `src/development/work-items.ts`, or `NativeWriteSessionResult` in `src/native/write-session.ts`. Every union branch must qualify; unknown/unresolved/other origins remain episode signals.
3. Add same-location real episode mutants, including aliased import, bracket access, renamed destructuring, mixed union and a same-name impostor DTO. These must still reject synthesis. Preserve existing episode reader census and projection checks.
4. Run focused census tests and the no-contract resume integration test, then TypeScript, focused ESLint, workflow and whitespace checks. Record actual outcomes. Parent coordinates independent review and full gate rerun.

Risks: this remains a conservative source guard, not a general interprocedural information-flow proof. No filename/function is excluded. Abort if proving host declaration origin requires widening the episode authority contract. Production/live-provider and existing owner gates are unaffected.

## Verification

Author verification on the shared stage-two worktree, 2026-10-15:

| Command | Outcome | Evidence |
|---|---|---|
| `node --import tsx --test test/unit/run/episode-contract-boundary.test.ts` before scanner change | RED: 6 pass / 3 fail / 0 skip | `.agent_workspace/episode-contract-boundary-red.txt`; original source collision, benign fixture and previously missed renamed destructuring fail |
| Same focused command after initial scanner change | GREEN: 9 pass / 0 fail / 0 skip, 12.92 s | `.agent_workspace/episode-contract-boundary-green.txt`; subsequently superseded by reviewed cast correction below |
| `node --import tsx --test test/integration/m2.5/resume.test.ts` | PASS: 27 / 0 / 0 | `.agent_workspace/episode-contract-resume-green.txt`; includes CLI resume inventing no contract |
| `node node_modules/typescript/bin/tsc --noEmit` | PASS | exit 0 |
| `node node_modules/eslint/bin/eslint.js test/unit/run/episode-contract-boundary.test.ts` | PASS | exit 0 |
| `node scripts/workflow-check.mjs` | PASS | 10 required files / 16 required headings |
| `git diff --check` | PASS | exit 0 |

The census still scans every source module and authority field. A real TypeScript program resolves imported or inferred receivers; the narrow exception requires an actual `acceptance` property signature on one of the two exact interface/file pairs. Every union member must qualify. Other names, unresolved types and foreign declarations remain conservative signals. Existing `ProjectEpisode` and event `payload.episode` signals are preserved. Renamed destructuring now examines its source property rather than the local variable name.

Mutants occupy the same `src/development/controller.ts:runNext` location as the benign fixture. They use the real episode interface under an import alias, direct/bracket reads, mixed episode/host unions, renamed destructuring, `any` and a foreign same-name interface. Existing contract/per-task reconstruction mutants, required real episode-reader inventory and persisted episode projection pins also pass.

Conclusion: no runtime episode-to-contract authority violation was found in `runNext`. This correction fixes a guard false positive and strengthens its renamed-destructuring coverage; no runtime exception or contract policy was added. Type resolution increases this focused file from approximately 1.3 s to 23.8 s including the reviewed cast regressions, due to repeated isolated mutant programs. The guard is still not an interprocedural information-flow proof; direct assertions and simple local initializer aliases conservatively retain the episode signal.

Independent reviewer: baseline agent requested; pending. Parent owns the combined full gate rerun and staged save. No new full-suite result is claimed here.

## Review follow-up plan (before regression edits)

The independent reviewer reproduced a new bypass: an episode explicitly cast to a host interface acquired the narrow declaration exception. The original broad guard rejected this; documenting a static-analysis limitation is insufficient. Before delivery, add RED same-location direct casts, local cast aliases, renamed alias destructuring and `satisfies` mutants. Conservatively retain the episode signal when receiver syntax or a bounded chain of local variable initializers contains an assertion. This is a small fail-closed source check, not a general taint-analysis framework. Re-run focused and static checks and request independent re-review.

## Review correction verification

- Reviewer reproduction: `.agent_workspace/architecture-20261015/episode-cast-review-red.log`; initial exception incorrectly accepted a direct `as unknown as WorkItemDefinition` receiver.
- Author RED: `node --import tsx --test --test-name-pattern='assertions and local aliases' test/unit/run/episode-contract-boundary.test.ts` failed as intended with a missing expected exception; `.agent_workspace/episode-contract-cast-red.txt`.
- Correction: `hasAssertedReceiverOrigin` checks direct `as`, angle-bracket assertions and `satisfies`, follows simple local variable initializer aliases and destructuring sources, and conservatively refuses cyclic or over-256-node provenance walks. An assertion cannot acquire the host declaration exception.
- Final focused command (including binding-alias/default corrections below): `node --import tsx --test test/unit/run/episode-contract-boundary.test.ts` — **10 pass / 0 fail / 0 skip**, 23.84 s; `.agent_workspace/episode-contract-boundary-green-final.txt`.
- Final TypeScript and focused ESLint commands above both exit 0. Resume integration remains **27 / 0 / 0**, with no runtime edits between runs.
- Source/test edits frozen for root's integrated suite. Independent re-review requested from baseline agent; parent owns the full suite result and staged save.

## Binding-alias follow-up plan (before regression edits)

The independent re-review found one remaining simple local alias gap: `const { item: alias } = { item: episode as unknown as WorkItemDefinition }; alias.acceptance` uses a `BindingElement` symbol rather than a `VariableDeclaration`. Add this exact same-location mutant first, observe RED, then follow a binding element through its binding patterns to the enclosing local variable initializer using the existing bounded assertion-origin walk. Parent notified that this requires a new test-source freeze; no runtime files will change.

Binding-alias RED reproduced with the named assertion test above: `.agent_workspace/episode-contract-binding-cast-red.txt`. The helper now walks binding-element/object-pattern/array-pattern ancestors to the local variable declaration and scans its initializer conservatively. Both a direct object destructure and an array/object nested destructure are pinned in the same existing mutant test. Final focused **10 / 0 / 0** (22.37 s), TypeScript and focused ESLint all pass. Source is frozen again for independent review and parent's final combined gate.

## Binding-default follow-up plan (before regression edits)

Independent review additionally found that a binding element can carry its own default initializer: `const { item: alias = episode as unknown as WorkItemDefinition } = {}; alias.acceptance`. The same ancestor walk must inspect each `BindingElement.initializer` before the enclosing variable initializer. Add this exact mutant first, confirm RED, make that bounded traversal correction, rerun and re-review. This stays within the existing local-binding mechanism and does not introduce interprocedural analysis.

Author RED: `.agent_workspace/episode-contract-binding-default-red.txt` records the missing expected exception. The ancestor traversal now checks each binding-element default initializer before ascending, including nested object/array binding defaults. Final focused **10 / 0 / 0** (23.84 s), TypeScript and focused ESLint pass after this correction. Independent re-review pending; the final combined gate remains parent-owned.

## Final independent and integrated result

Final independent reviewer verdict: **PASS**, no remaining scoped blocker. Reviewed test blob: `f44fa0a415e09e76c409c0896f40b309f41b8ad5`. Independent focused 10/10, 0 skip, exit 0 (24.19 seconds); the five existing independently constructed cast/local-alias/destructure/binding/default probes all reject reconstruction (one aggregate test, 9.32 seconds). No source module or function is excluded; exact host declaration/file origins, union checks and conservative unknown handling remain intact.

Coordinator then executed the full suite on that exact test blob: **3431 total / 3430 pass / 0 fail / 1 opt-in provider skip**, 69.0188 seconds, with final TypeScript, whole-repository ESLint, workflow, build and diff checks passing. Logs: `.agent_workspace/architecture-20261015/episode-boundary-independent-final.log`, `episode-cast-review-final.log`, `episode-boundary-independent-review-final.md` and `stage2-full-tests-delivery.log`. Earlier pending/RED states above remain chronological evidence. Remote revision binding and CI are recorded in the control-plane report.

# Report-driven improvements: A1/A2 verification

## Identity

- Task: `TASK-20260927-report-improvements`; date: 2026-09-27.
- Owner: implementation agent. Independent review/merge acceptance: repository maintainer; no independent verdict obtained in this session.
- Upstream baseline: `1b04aa9d9e70206cfb41a2963189dfb5bcab3a5d`.
- Plan-first commit: `76caf7306e4a9547b1036029a464d72e06951f19`.
- A1 commit: `3b7c51d33f5eac87de0d5c3098a64856f4415c5d`; A2 commit: `860c58c54aa821a7ab0cb2b6ab92dda95c92533e`.
- Branch: `codex/report-plan-phase-a-20260927`.
- State: implementation present; focused verification PASS; full acceptance BLOCKED. Not acceptance of all Stage A or the roadmap.
- [Plan](../superpowers/plans/2026-09-27-report-driven-improvements.md); [checklist](../../tasks/report-improvement-todo.md).

## Scope and source mapping

The supplied report's sections 3.1, 3.5, 6.1, Stage A and 11.2 motivate this bounded slice. Preserve existing runtime, approval and learning boundaries. No added dependency, model-facing tool, authority grant, persistence schema, cryptographic mechanism or automatic promotion.

| Package | Changed files | Observable behavior |
|---|---|---|
| A1 | `src/requirement/objective-intent.ts`, `src/requirement/heuristic.ts`, `src/track/plan.ts` | Chinese/English intent parity for covered fixtures; explicit read-only produces a report and existing non-writing planner/scout profiles; explicit no-tests overrides preference defaults |
| A1 tests | `test/unit/requirement/report-regressions.test.ts` | 33 cases including provenance, immutability, restrictive answers and false-positive guards |
| A2 | `src/native/command-args.ts`, `extensions/pi-sparkle/index.ts` | Exactly five nonempty arguments; whole-argument quotes preserve spaces/Windows separators; malformed input returns before issuing a handle |
| A2 tests | `test/unit/native/command-args.test.ts`, `test/unit/native/candidate-command-extension.test.ts` | 20 parser cases and 2 actual-loader registration/refusal cases; loader cases NOT RUN locally |

Existing `test/unit/requirement/heuristic.test.ts` is unchanged and contributes six adjacent cases. Total added tests: 55; executed added tests: 53. The 59 executed cases comprise those 53 plus the six existing cases. Do not count the two loader tests as passing.

## Environment and method

Container DNS could not resolve github.com; a full Git clone and dependency installation were unavailable. Source was read through the authorized GitHub connection. A dependency-free source closure was reconstructed locally, with original files checked against fetched Git blob identifiers before editing. This is a source-subset check, not a full checkout or its gate.

Local tools were Node v22.16.0 and TypeScript 5.8.3; the repository requires Node >=22.19.0, pnpm 10.17.1 and TypeScript 5.9.3. pnpm and Pi packages were unavailable. The subset used a temporary ESM package marker and local Node typings; neither that marker nor reconstructed baseline files are part of the PR. Git blob checks identify copied source only; no runtime hashing was introduced.

The local execution workspace was no longer mounted during final publication. Therefore the raw earlier RED/GREEN files are not delivered as retained artifacts. Counts below come from the actual earlier command outputs in this work session; they must be re-established on the published head in a complete supported checkout. The attempted final local re-run could not enter that workspace and is NOT counted as another PASS. A repeat full-clone attempt also failed DNS resolution.

## Commands and results

| Check | Result | Evidence and limitation |
|---|---|---|
| Baseline subset compile and initial regression set before A1 changes | Expected RED | Compile exit 0; 34 tests: 16 pass, 18 fail, reproducing Chinese/short targets, test intent and read-only defects |
| Strict focused TypeScript compile below | PASS in implementation workspace | Exit 0; dependency-free closure only, not full `pnpm typecheck` |
| Compiled focused Node tests below | PASS in implementation workspace | 59 pass, 0 fail, 0 skipped |
| `git diff --check` before workspace loss | PASS | No whitespace errors in then-present implementation diff |
| Actual Pi loader and extension/apply-registration regressions | NOT RUN | Pi dependencies unavailable; two new loader cases remain unverified |
| `pnpm gate`, supported-version build, security/Pi probes and Windows execution | NOT RUN / BLOCKED | No complete checkout/dependencies/pnpm; no full-gate PASS claimed |
| Independent review, real-provider/holdout evaluation, production apply | NOT RUN | Separate review, budget/data and authorization gates remain open |

A1 has a pre-implementation RED/GREEN cycle against baseline modules. A2's helper was checked after implementation; an actual pre-fix Pi-loader RED run was unavailable. Do not claim completed test-first integration validation for A2.

Exact focused commands, from the earlier source-subset root:

```sh
tsc --module nodenext --target es2022 --strict \
  --noUncheckedIndexedAccess --exactOptionalPropertyTypes --skipLibCheck \
  --esModuleInterop --types node \
  --typeRoots /opt/nvm/versions/node/v22.16.0/lib/node_modules/ts-node/node_modules/@types \
  --outDir .agent_workspace/local-verification/build --rootDir . \
  test/unit/requirement/heuristic.test.ts \
  test/unit/requirement/report-regressions.test.ts \
  test/unit/native/command-args.test.ts
node --test \
  .agent_workspace/local-verification/build/test/unit/requirement/heuristic.test.js \
  .agent_workspace/local-verification/build/test/unit/requirement/report-regressions.test.js \
  .agent_workspace/local-verification/build/test/unit/native/command-args.test.js
```

Recorded TAP summary: `tests 59; pass 59; fail 0; cancelled 0; skipped 0; todo 0`.

## Behavioral evidence

A1 handles the report's Chinese login-timeout/test fixture without requiring English spaces. Explicit read-only objectives create a report and `c-read-only`; tests confirm the selected existing profiles have no write/edit/run-test tools. Restrictions survive contradictory write answers/defaults. A request not to modify *other* files and a request to implement a read-only endpoint still permit implementation planning. Provenance is retained and `authority` stays empty.

A2 preserves quoted Windows, UNC, trailing-separator, Unicode and apostrophe-containing paths. Shell variables, command substitution and wildcards remain literal. Empty/incomplete arguments, ambiguous quoting, NUL and line breaks are rejected. The extension calls the helper before `issuedCandidates.set`; existing handle matching, persisted host verification and application checks are untouched. The two NOT RUN loader cases exercise registration/refusal without applying a candidate or calling a provider.

## Risks and gates

Deterministic rules cover these fixtures, not arbitrary natural language or every CLI/native path. This slice does not implement general file-scope/no-commit/dependency-upgrade enforcement, a host candidate picker, full stable-enum migration, native structured contracts, or an independent completion receipt. Complex or quoted negation remains a structured-intent follow-up. No inferred authority is granted.

Read-only planning narrows role selection; runtime admission and OS sandbox guarantees require their own integration/security review. The parser is intentionally not a shell parser: quote the entire path; backslash escapes are not interpreted. Simple old paths stay compatible; ambiguous embedded quotes are now rejected.

Existing O02/O08b/O09 ownership and B0/D1/S0-min/L1/L2, R10/R11, F6/F-PROD gates are unchanged. No long-term quality/cost improvement, independent PASS, supported-runtime acceptance or merge readiness follows from subset checks.

## Handoff

Use a complete checkout at the PR head and supported Node/pnpm versions:

```sh
pnpm install --frozen-lockfile
pnpm test -- --test-concurrency=1 \
  test/unit/requirement/heuristic.test.ts \
  test/unit/requirement/report-regressions.test.ts \
  test/unit/native/command-args.test.ts \
  test/unit/native/candidate-command-extension.test.ts \
  test/unit/native/extension.test.ts \
  test/unit/native/apply-registration.test.ts
pnpm gate
pnpm security:probe
pnpm pi:probe
```

Attach output for the exact head revision, inspect the intent false-positive/false-negative boundary and pinned tool surface, then decide merge acceptance. Reconcile A0 separately. Keep the PR draft while required evidence is absent. Rollback is a revert of this slice's commits, not state migration, user-workspace rollback or deletion.

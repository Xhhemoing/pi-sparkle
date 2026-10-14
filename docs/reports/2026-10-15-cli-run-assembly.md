# CLI assembly extraction and configured fallback verification

- Task: `TASK-20261015-cli-run-assembly`.
- Baseline: `c2b802c`; candidate source uncommitted in the shared checkout.
- Date/environment: 2026-10-15 Asia/Shanghai; Linux, Node 24.19.0.
- Author: runtime audit agent; coordinating agent owns integrated review/gate.
- [Plan](../superpowers/plans/2026-10-15-cli-run-assembly.md).

## Architecture and behavior

`main.ts` keeps command parsing, dispatch and orchestration. The existing
thinking/cost validation and resume disclosure now live in `run-options.ts`,
with backward-compatible re-exports from `main.ts`. `executor-factory.ts` owns
fake/real executor construction and model configuration assembly. Its pure
`resolveCliPiExecutorOptions` accepts an explicit environment snapshot and
provider configuration, so precedence, aliases and hooks can be tested without
reading credentials, files or process-global configuration.

Existing run/resume command bodies, help text, errors and event shapes were
unchanged by extraction. Factory selection still uses executor override, then
primary override, then environment, then saved primary. Existing per-field
environment defaults and saved premium alias behavior are preserved.

A separate confirmed wiring defect was corrected after RED tests: the CLI
constructed `fallbackModels`, but `createConfiguredPiExecutor` neither declared
nor forwarded them. It now accepts and forwards the typed list. The CLI also
compared freshly parsed model objects by identity, admitting the primary model
as its own fallback. It now compares the resolved provider/model pair. Distinct
providers with the same model name remain distinct alternatives.

The adapter factory accepts an optional runtime factory dependency, defaulting
to its existing `createPiRuntime`. The regression uses a faux model collection
to verify actual primary/fallback invocations without credentials or network.
Production construction and Pi SDK isolation remain unchanged.

## Verification

| Check | Result |
|---|---|
| Existing thinking/cost/resume/sink and run-cost-cap characterization before extraction | PASS 49/49 |
| Same characterization after extraction, before fallback corrections | PASS 49/49 |
| New resolver/factory tests before corrections | RED 8 pass / 5 fail: four duplicate-primary cases and dropped distinct fallback |
| Same new tests after corrections | PASS 13/13 |
| Combined CLI/adapter/telemetry suite below | PASS 573/573, 0 fail, 0 skip |
| `node node_modules/typescript/bin/tsc --noEmit` | PASS |
| Changed-file ESLint | PASS |
| `node scripts/workflow-check.mjs` | PASS |
| Independent review and full combined gate | Coordinating agent owns final evidence |

```sh
node --import tsx --test \
  test/unit/cli/*.test.ts \
  test/unit/pi-adapter/*.test.ts \
  test/unit/telemetry/invocation-log.test.ts \
  test/integration/cli/run-cost-cap.test.ts
```

Changed-file lint covered `src/cli/main.ts`, `src/cli/run-options.ts`,
`src/cli/executor-factory.ts`, `src/pi-adapter/runtime.ts`, and the new
`executor-factory.test.ts` / `runtime-fallback.test.ts` tests. Baseline,
post-extraction, final focused and typecheck logs are under
`.agent_workspace/executor-fallback-audit/cli-assembly-*.log`; RED counts were
observed in the test command output before correction.

## Limits and integration

This slice does not extract the flowchart lifecycle/recovery machinery: that
would cross command-state boundaries beyond the pure assembly seam. It does
not alter model routing, retry classification, cost policy or task verdicts.
The newly forwarded distinct fallback is an intentional behavior correction;
it uses the already-tested retryable-only, shared-budget adapter path.

The development CLI can reuse `createCliExecutor` and the run-option helpers.
Native write entry remains `NativeWriteSession.execute`; shutdown belongs to
the command's `finally` path. `findAcceptedLoopArtifact` resolves accepted
artifacts for one run, and `listRuns` inventories runs; neither is a general
candidate catalog or a replacement for durable development work-item state.
No live provider, native write to a separate user worktree or external
publication was performed by this slice.

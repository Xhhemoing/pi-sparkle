# M2-A boundary cleanup: author verification

## Scope and result

The accepted lightweight architecture's first M2 slice is implemented as a
behavior-preserving move. The [scoped plan](../superpowers/plans/2026-10-17-m2-boundary-cleanup.md)
remains the acceptance contract. The source is ready for integrated gate and
independent review; this record does not declare all M2 or a stable SDK complete.

`CliIo` and `lockWaitOptions` now live in `src/cli/options.ts`. `main` retains the
existing exports, and `pref` no longer imports `main`. The static source graph
has no file cycle. The original model catalog implementation now lives at
`src/routing/model-catalog.ts`, with every original runtime export forwarded
from `src/cli/model-catalog.ts`. Native and tracking consumers use routing
directly. The original state layout implementation now lives at
`src/persist/state-layout.ts`, with the old privacy path retained as a forwarder.
Thirty-four source consumer imports were rewritten by this author; the
concurrent process-ownership author updated `src/development/controller.ts`.

The two moved implementations were compared against `git show HEAD:<old-path>`
and matched byte for byte. No CLI/event/JSON wording, routing algorithm, lazy Pi
resolution, state path, persistent format, or package exports changed.

## Tests and evidence

Environment: Linux, Node `v24.19.0`; restored local dependencies. Baseline is
recovered local commit `778b235` with the restored M0 `5fc744c` tree. This is working-tree author verification; the
integration owner records final commit and full-gate evidence separately.

The new graph guard uses TypeScript's AST to include static imports,
side-effect imports and forwarding exports; type-only declarations, comments
and dynamic imports do not create static edges. A synthetic test pins those
distinctions. Compatibility tests compare all old/new runtime export identities,
including the error constructor, and pin the old main helper/type exports and
the durable path spellings. Both existing privacy guards classify the moved
runtime catalog explicitly; no exception allowlist grew.

| Command/check | Outcome |
|---|---|
| Final structural guard copied under `.agent_workspace/m2-red-baseline/`, with `src` linked to the retained original tree; `node --import tsx --test .agent_workspace/m2-red-baseline/test/unit/architecture/boundary-cleanup.test.ts` | **Expected RED:** 1 walker test passed, 4 boundary tests failed: original `main`/`pref` cycle, preference import, native/tracking CLI dependency, missing persist layout. |
| Initial native-Node structural/privacy/Pi/live checks | 32 passed / 0 failed / 0 skipped; superseded for final guard verification by the focused run below. |
| Normal repository test launcher, serial focused command below | **98 passed / 0 failed / 0 skipped**, 11.38 seconds. Includes final AST and compatibility tests. |
| `git diff --check` | PASS. |
| Initial `pnpm test ...` via environment fallback | Did not run tests: fallback pnpm attempted automatic install and exited `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. Used the repository launcher directly; no dependency/config change by this author. |
| Typecheck, lint, full gate, security/Pi/kernel probes | Integration owner runs after all concurrent slices are stable; not claimed here. |

Exact successful focused command:

```sh
node scripts/run-tests.mjs --test-concurrency=1 test/unit/architecture test/unit/cli/flowchart-cli.test.ts test/unit/cli/live-catalog.test.ts test/unit/native/routing-catalog.test.ts test/unit/preferences/snapshot-lock.test.ts test/integration/cli/delete.test.ts test/integration/cli/retain.test.ts test/integration/m4/preferences-cli.test.ts test/integration/track/track-loop.test.ts test/unit/privacy/plane-boundary.test.ts test/unit/privacy/adaptation-plane-closure.test.ts test/unit/routing/live-isolation.test.ts test/unit/pi-boundary.test.ts
```

Local command output is retained in `.agent_workspace/m2-focused.log` and
`.agent_workspace/m2-red-baseline.log`. Raw reports remain untracked.

## Remaining boundaries

This slice adds no plugin activation or SDK exports field and does not close the
M2 packed-consumer/example gate. Old `src`/`dist` deep paths remain available;
their removal requires a separate compatibility window. No live provider,
Windows, production, experimental promotion, or measured effectiveness claim
follows. No commits, pushes or merges were performed by this slice author.

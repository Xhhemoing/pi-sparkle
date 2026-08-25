# Loop 5 Round 4 — GPT D18 independent review

Reviewed fetched `origin/cursor/pi-sparkle-sota-opt-0da8` at `b901f54`
(`c4e3e63` plus a documentation-only retry note). Analysis only; no
application source was edited and no commit or push was made.

## Verdict

**FIX.**

The pre-created symlink cases are closed, typed, and well tested. The
post-publish check is not a binding check, however: it accepts a different real
directory recreated at the same lexical path. The exporter can therefore
return success with a `manifestPath` that does not contain the manifest.

## Blocking finding

### F1 — Replacing the bound leaf with a fresh real directory passes the publish check

`bindDefaultEvalDatasetDir` does the requested initial operations:

- `assertDefaultEvalDatasetNotAliased` uses `lstat` and rejects a symbolic-link
  leaf (`src/privacy/eval-dataset-path.ts:121-136`).
- The leaf is created with non-recursive `mkdir`, with only `EEXIST` tolerated
  (`src/privacy/eval-dataset-path.ts:172-182`).
- `exportRoutingEvalDataset` calls `assertDefaultEvalDatasetPublished` after
  `writeFileAtomic` publishes (`src/learning/eval-dataset.ts:224-239`).

But `assertBoundToDatasetRoot` records no identity for the directory it
accepted. It only rejects a symlink and compares:

```text
realpath(datasetDir) === join(realpath(evalDatasetsRoot), runId)
```

(`src/privacy/eval-dataset-path.ts:149-159`). It does not require the leaf to
be a directory and does not compare the pre-publish and post-publish directory
identity (`dev`/`ino` or an equivalent held binding).

A deterministic probe used the existing `AtomicWriteOptions.rename` seam to:

1. perform the real temp-file rename to `manifest.json`;
2. rename the whole bound `<runId>` directory aside;
3. create a fresh real directory at the original `<runId>` path; and
4. return to the exporter's post-publish check.

Observed result:

```json
{"returnedSuccess":true,"error":null,"returnedManifestExists":false,"displacedManifestExists":true,"replacementLeafExists":true}
```

The fresh directory has the expected canonical pathname, so the re-check
passes. The export returns a path that does not hold the manifest, directly
failing review question 1 and the operator-honesty requirement. The existing
swap test covers only replacement by a symlink, which this check does catch.

The correction needs to make the initial binding and final assertion refer to
the same real directory identity, while also explicitly requiring a directory.
This report does not implement that correction.

## Review checklist

### 1. Default export — FAIL

Initial `lstat`, symlink refusal, and non-recursive leaf creation are present.
There is a post-publish check, but it only revalidates the pathname. F1 proves
that a changed entry can pass and produce a successful return whose manifest
is not at the returned path.

### 2. Delete — PASS for the specified pre-created alias

`deleteRunRecords` performs the typed alias preflight before invocation-log or
run-record mutation (`src/privacy/deletion.ts:333-345`), and
`removeDefaultEvalDataset` repeats it immediately before the ordinary cascade
(`src/privacy/deletion.ts:398-403`). The error is
`EvalDatasetAliasError` with code `EVAL_DATASET_ALIAS`. A real default dataset
directory is still recursively removed and reported.

Because the function throws instead of returning a `DeletionResult`, the CLI's
`removed:` loop is not reached. For a pre-created symbolic-link leaf, no
success claim is printed.

### 3. Tests — PARTIAL

- `test/unit/learning/eval-dataset.test.ts` covers a pre-created symlink leaf,
  proves the target stays empty, and proves ordinary export resumes after the
  alias is removed.
- `test/unit/cli/adapt.test.ts` pins exit 1, no stdout path, and no external
  manifest for that export.
- `test/unit/privacy/deletion.test.ts` covers a pre-created symlink leaf,
  requires the typed delete error, and proves the run subtree, invocation row,
  alias, and external manifest all survive the refusal. Its explicit success
  branch fails if the external derivative survives.

The delete coverage is at the deletion API rather than the CLI I/O surface;
there is no symlink case pinning `main(["delete", ...])` to exit 1 with no
`removed:` output. More importantly, the publish-race test covers a symlink
replacement only and misses F1's real-directory replacement.

### 4. D10 compatibility and frozen contracts — PASS

The existing implementation and focused tests retain:

- whole-objective redaction before the 500-character excerpt;
- one workspace redaction reused at manifest and row sites;
- realpath-aware workspace/runtime isolation for operator-owned `--dir`
  exports, with `--dir` still outside the cascade;
- the `episodes` key and routed-task row-honesty wording; and
- optional atomic-write mode, with dataset manifests requesting `0600`.

The D18 implementation commits changed none of `src/cli/main.ts`,
`src/domain/status.ts`, or `src/run/events.ts`. `INSPECT_SUMMARY` remains the
four keys `type`, `runId`, `status`, `requiredEvidence`; `RunStatus` remains
eight members; and no Event member was added.

### 5. Operator honesty — FAIL through F1

The pre-created symlink refusal is honest: export prints no path, and delete
cannot print a removal. F1 still lets `adapt dataset` report a successful path
which no longer contains the manifest, so the overall honesty condition is not
met.

## Verification

- Required focused tests:
  `eval-dataset.test.ts`, `deletion.test.ts`, `adapt.test.ts` — **92/92 pass**.
- D10/freeze tests:
  `atomic-file`, `plane-boundary`, `record-classes`, `inspection`,
  `terminal-replay-statuses-freeze`, `event-row-fuzz` — **63/63 pass**.
- `pnpm typecheck` — **pass**.
- Runtime: Node `v22.14.0`; package engine requires `>=22.19.0`. pnpm emitted
  the expected unsupported-engine warning, with no test or typecheck failure.
- Independent post-publish real-directory replacement probe — **reproduced
  F1**.

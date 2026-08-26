# Loop 5 Round 4 — GPT D23 independent review

Reviewed fetched `origin/cursor/pi-sparkle-sota-opt-0da8` at `de7a352`
(`2027266` plus the D23 documentation commit). Analysis only; no application
source was edited and no commit, push, or PR was made.

## Verdict

**KEEP.**

D23 closes the restored-directory/ABA case from the D19 review. A successful
default export now passes both the existing bound-directory identity check and
an `lstat` of `manifest.json` on that bound path that requires a regular file.
The required rename-seam case rejects at publish stage and returns no path.

No blocking findings.

## Review checklist

### 1. Bound-path manifest assertion — PASS

`EVAL_DATASET_MANIFEST_FILE` names `manifest.json` once for both the writer and
the post-publish assertion (`src/privacy/eval-dataset-path.ts:59-64`;
`src/learning/eval-dataset.ts:224-230`).

After re-reading the default leaf and proving that its identity is the one
captured by the bind, `assertDefaultEvalDatasetPublished` performs:

```text
lstat(join(bound.path, EVAL_DATASET_MANIFEST_FILE))
```

and returns only when the result is defined and `isFile()` is true
(`src/privacy/eval-dataset-path.ts:388-406`). Missing entries, directories, and
symlinks all fail with `EvalDatasetAliasError` at stage `"publish"`.

`exportRoutingEvalDataset` calls that assertion after the atomic write and
before constructing its successful return. On failure it attempts lexical
take-back and rethrows; the return at line 247 is unreachable
(`src/learning/eval-dataset.ts:227-247`). Therefore a successful default export
has observed a regular manifest at the returned bound path rather than merely
observing the expected directory identity.

### 2. Required restored-directory rename seam — PASS

The D23 pin uses the atomic rename seam to:

1. park the bound leaf;
2. create a replacement at the lexical path;
3. publish the temp file into that replacement;
4. move the replacement and manifest aside; and
5. restore the original bound leaf.

The export rejects with typed code `EVAL_DATASET_ALIAS`, stage `"publish"`,
and no result (`test/unit/learning/eval-dataset.test.ts:702-756`). The test
also proves that the restored bound path has no manifest and that the manifest
remains in the displaced replacement. This is the exact D19 counterexample,
now refused rather than reported as success.

The adjacent helper-level pin also rejects an absent manifest, a directory
named `manifest.json`, and a symlink named `manifest.json`
(`test/unit/learning/eval-dataset.test.ts:802-837`).

### 3. D18, D19, `--dir`, and no-search constraints — PASS

- D18 remains intact: a pre-created symlink leaf is refused through `lstat`
  before publication, and the target remains empty
  (`src/privacy/eval-dataset-path.ts:248-256,349-360`;
  `test/unit/learning/eval-dataset.test.ts:542-588`). Deletion still performs
  the typed preflight before mutation and repeats it at the cascade point
  (`src/privacy/deletion.ts:338-355,398-403`).
- The D19 one-way real-directory replacement pin remains and rejects at
  publish stage while preserving the displaced-manifest evidence
  (`test/unit/learning/eval-dataset.test.ts:636-689`).
- `--dir` still bypasses the default bind/assertion, retains the external-copy
  warning, and is not reached by `delete --run`
  (`src/learning/eval-dataset.ts:198-207,231-246`;
  `src/cli/adapt.ts:296-317`;
  `src/privacy/deletion.ts:373-403`).
- Dataset deletion derives exactly `defaultEvalDatasetDir(stateRoot, runId)`.
  Neither publication failure nor deletion walks the filesystem to find a
  displaced directory.

### 4. Frozen contracts — PASS

The D23 merge changed only `src/learning/eval-dataset.ts`,
`src/privacy/eval-dataset-path.ts`, and
`test/unit/learning/eval-dataset.test.ts`.

- `INSPECT_SUMMARY` remains exactly `type`, `runId`, `status`, and
  `requiredEvidence` (`src/run/inspection.ts:57-75`).
- `RunStatus` remains the same eight members
  (`src/domain/status.ts:1-12`).
- No Event type was added.
- `src/cli/main.ts` was not changed and no change there is required.

### 5. Operator honesty — PASS

The CLI prints `result.datasetDir` only after the exporter resolves
successfully (`src/cli/adapt.ts:296-322`). The D23 missing-manifest path throws
before that result exists, so the command exits 1 and cannot print a successful
dataset path whose checked bound directory lacks a regular `manifest.json`.
The error explicitly says that no path is returned and that the implementation
does not search for the displaced directory.

## Verification

- Focused `eval-dataset`, `deletion`, and `adapt` unit tests: **96/96 pass**.
  This includes the D18 pre-created symlink, D19 one-way replacement, D23
  restored-directory seam, non-regular manifest, external `--dir`, and delete
  cascade pins.
- `pnpm typecheck`: **pass**.
- Runtime: Node `v22.14.0`; package `engines.node` requires `>=22.19.0`.
  pnpm `10.17.1` emitted the expected unsupported-engine warning. Tests and
  typecheck nevertheless completed successfully.

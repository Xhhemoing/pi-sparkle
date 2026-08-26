# Loop 5 Round 4 — GPT D19 independent review

Reviewed fetched `origin/cursor/pi-sparkle-sota-opt-0da8` at `a560abe`
(`e0781c8` plus the D19 documentation commit). Analysis only; no application
source was edited and no commit or push was made.

## Verdict

**FIX.**

The landed identity representation correctly rejects the tested one-way
replacement of the bound leaf, and D18's symlink behavior remains intact.
Directory identity at the two endpoints is not enough, however, to establish
the required successful-return claim: the originally bound directory can be
restored before the post-publish check after the manifest has been moved into a
replacement. The identity check then succeeds while the returned
`manifestPath` is absent.

## Blocking finding

### F1 — Restoring the bound directory makes the endpoint identity check pass without the manifest

`bindDefaultEvalDatasetDir` returns the accepted leaf's identity and
`exportRoutingEvalDataset` threads it into
`assertDefaultEvalDatasetPublished` (`src/privacy/eval-dataset-path.ts:281-328`,
`src/learning/eval-dataset.ts:201-206,223-245`). The assertion re-reads the
leaf and compares `dev`/`ino`, or checks the witness
(`src/privacy/eval-dataset-path.ts:346-366`). This closes the prior test where
the fresh replacement remains at `<runId>`.

It is only an endpoint check. A deterministic probe used the existing
`AtomicWriteOptions.rename` seam to:

1. move the bound leaf aside;
2. create a replacement at the same lexical path;
3. move the actual atomic temp file into that replacement as `manifest.json`;
4. move the replacement, including the manifest, aside; and
5. restore the originally bound directory before the post-publish assertion.

Observed:

```json
{"returnedSuccess":true,"returnedManifestExists":false,"replacementManifestExists":true}
```

The final `lstat` sees the original `dev`/`ino`, so the function returns
success. The path printed by `adapt dataset` does not contain `manifest.json`;
the replacement directory does. The witness fallback has the same endpoint
property: restoring the original directory also restores its witness, so that
check cannot prove where the manifest was published.

This directly fails D19's requirement that a successful return name a path
which actually contains the manifest. The new one-way replacement test is
valuable but does not cover this restored-directory/ABA case
(`test/unit/learning/eval-dataset.test.ts:647-689`).

## Review checklist

### 1. Bind and post-publish identity — PARTIAL / FAIL

The bind and assertion do share an identity, and a fresh directory left at the
lexical path is rejected. F1 shows that restoring the accepted directory lets
the endpoint comparison pass even though publication landed elsewhere.
Success therefore does not imply that `manifest.json` exists at the returned
path.

### 2. D18 and `--dir` — PASS

- A pre-created symlink leaf is still refused by `lstat` before publication.
- A leaf left as a symlink during publish is still rejected, with best-effort
  take-back and no successful path.
- Deletion still checks the leaf before mutation and again at the cascade
  point (`src/privacy/deletion.ts:333-355,398-403`).
- `--dir` bypasses the default bind, retains isolation checks and the external
  export warning, and remains outside deletion's path-derived cascade.

### 3. Identity representation — PASS as an endpoint identity

The bigint form is justified: inode values can exceed JavaScript's exact
integer range, so `number` could collapse distinct 64-bit identifiers. The
normal identity compares both `dev` and `ino`.

For `ino === 0n`, the fallback uses a UUID-derived name, creates it with
exclusive `"wx"` and mode `0600`, checks it with `lstat`, and invokes removal
after the check. A replacement cannot already contain a successfully
exclusive-created random name. The focused test covers normal witness
consumption and a replacement missing the witness. This is an honest
equivalent for endpoint identity, but it cannot close F1 because an ABA restore
also restores the witness.

### 4. Frozen contracts and D10 — PASS

The D19 range changes none of `src/cli/main.ts`, `src/domain/status.ts`,
`src/run/events.ts`, `src/run/inspection.ts`, deletion, or the record-class
dictionary.

- `INSPECT_SUMMARY` remains exactly `type`, `runId`, `status`,
  `requiredEvidence`.
- `RunStatus` remains eight members.
- No Event type was added.
- No `main.ts` change is needed for this review.
- Whole-objective redaction before the 500-character excerpt, one redacted
  workspace value reused at manifest/row sites, realpath-aware isolation, and
  the `episodes` / routed-task row contract remain present.

### 5. Operator honesty — FAIL through F1

The ordinary and one-way replacement failures print no success path. F1 still
lets the CLI receive a successful exporter result and print `datasetDir` even
though that directory has no manifest, while the derivative survives under a
different path.

## Verification

- Focused `eval-dataset`, `deletion`, and `adapt` unit tests: **94/94 pass**.
- `pnpm typecheck`: **pass**.
- Dependencies were initially absent; `pnpm install --frozen-lockfile`
  completed without changing the lockfile, then verification passed.
- Runtime: Node `v22.14.0`; package engine requires `>=22.19.0`. pnpm emitted
  the expected unsupported-engine warning. pnpm was `10.17.1`.
- Independent restored-directory publish probe: **reproduced F1**.


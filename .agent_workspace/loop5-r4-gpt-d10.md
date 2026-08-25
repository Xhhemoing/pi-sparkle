# Loop 5 Round 4 — GPT D10 dataset-privacy recheck

Independent challenge of merged D10 at `cursor/pi-sparkle-sota-opt-0da8`
(`0f08441`). Analysis only; no `src/` edits and no commit.

## Verdict

**FIX.** D1, D2, D4, row honesty, evaluator compatibility, file mode, and the
named freeze surfaces pass. D3 has a reproducible symlink bypass: a nominally
default export can be placed outside the state root and survive
`delete --run`.

## Blocking finding

### F1 — A symlinked default dataset directory defeats the deletion cascade

`defaultEvalDatasetDir` returns the lexical
`adaptation/eval-datasets/<runId>` path (`src/privacy/state-layout.ts:35-44`).
The exporter canonicalizes that path, but uses canonicalization only to reject
overlap with the recorded workspace and runtime plane
(`src/learning/eval-dataset.ts:255-293`). Therefore, if the default `<runId>`
entry is a symlink to any other directory, the external target is accepted and
`manifest.json` is written through the symlink
(`src/learning/eval-dataset.ts:187-211`).

Deletion then checks existence with `stat`, which follows the symlink
(`src/privacy/deletion.ts:131-138`), but calls `rm` on the lexical default path
(`src/privacy/deletion.ts:356-379`). For a leaf directory symlink, `rm` unlinks
the symlink; it does not remove the target directory or its manifest. The
delete consequently reports the default path as removed
(`src/privacy/deletion.ts:330-349`) while the sensitive derivative survives at
the unrecorded target.

Independent end-to-end probe:

```json
{"defaultDir":"/tmp/d10-state-s1uSnd/adaptation/eval-datasets/run_4324fb2b-314a-4a1b-b0ae-101657c65d32","externalManifestSurvives":true}
```

The surviving external manifest still contained `private customer objective`.
This is not merely an arbitrary `--dir` export: no `--dir` was supplied, so the
CLI gives no external-export warning and D10 promises the default cascade
(`src/cli/adapt.ts:43-50`, `src/cli/adapt.ts:312-315`). It directly violates
GPT-r2 D3 and the merged D10 condition (`docs/agent-decisions.md:83-87`).

Required fix:

1. Refuse a default export when its `<runId>` leaf is a symlink, and bind the
   publish to the canonical adaptation dataset root without a check/write
   symlink swap.
2. Make deletion detect this legacy/adversarial shape and fail loudly rather
   than claim the derivative was removed while only unlinking the alias.
3. Add a negative test that pre-creates the default `<runId>` as a symlink to
   an external directory and proves no external manifest can survive a
   successful `delete --run`.

## Checklist

### 1. Redact, then truncate — PASS

The complete objective is passed to `redactSensitiveText`; only its returned
text is sliced to `OBJECTIVE_MAX_CHARS`
(`src/learning/eval-dataset.ts:164-176`). The boundary suite covers keyed
secrets, bearer tokens, PEM, email, and paths
(`test/unit/learning/eval-dataset.test.ts:257-375`).

### 2. `originalWorkspace` classification/copying — PASS

The workspace is redacted once and the resulting value is reused for the
manifest-level field and exact row copies
(`src/learning/eval-dataset.ts:140-176`,
`src/learning/eval-dataset.ts:190-203`). The record class declares both
`objective` and `originalWorkspace` sensitive and explicitly calls redaction
best-effort (`src/privacy/record-classes.ts:247-275`). `adapt eval` can load a
manifest-level-only workspace while preserving the row key contract
(`src/adaptation/eval-routing.ts:263-365`).

### 3. Default deletion cascade — FAIL

The ordinary directory case is wired through the shared path helper and is
tested (`src/privacy/deletion.ts:323-379`,
`test/unit/privacy/deletion.test.ts:1064-1117`), but F1 defeats the privacy
postcondition.

### 4. Realpath-aware `--dir` refusals — PASS

The exporter canonicalizes the nearest existing ancestor and performs
two-direction overlap checks against both the raw recorded workspace and
runtime plane (`src/learning/eval-dataset.ts:255-315`;
`src/experiments/isolation.ts:22-49`). Direct, symlinked, and containing-root
runtime destinations are pinned
(`test/unit/learning/eval-dataset.test.ts:474-521`).

### 5. `episodes` honesty and evaluator loading — PASS

`source.rowKind` is exactly `"routed-task-from-one-run"` and the comments do
not claim independence (`src/learning/eval-dataset.ts:33-40`,
`src/learning/eval-dataset.ts:62-77`). The CLI repeats that limitation
operator-visibly (`src/cli/adapt.ts:266-318`). The evaluator still parses
`episodes`, including redacted and manifest-level workspace forms
(`src/adaptation/eval-routing.ts:263-365`).

### 6. Atomic `0600` change — PASS

`mode` is optional and omitted callers retain the platform default; it is
applied only when the unique temp inode is created
(`src/persist/atomic-file.ts:14-25`, `src/persist/atomic-file.ts:49-83`).
The dataset requests `0600` (`src/learning/eval-dataset.ts:28-31`,
`src/learning/eval-dataset.ts:205-211`), while the shared writer's existing
creation, concurrency, collision, fallback, and cleanup tests all remain green
(`test/unit/persist/atomic-file.test.ts:34-215`). The resulting manifest mode
is pinned on POSIX (`test/unit/learning/eval-dataset.test.ts:523-535`).

### 7. Freeze surfaces — PASS

- The record-class census and implemented propagation agree, including the
  D10 class/edge (`test/unit/privacy/record-classes.test.ts:9-42`,
  `test/unit/privacy/record-classes.test.ts:64-119`).
- The adaptation/runtime direct and transitive import boundaries remain
  allowlisted and type-only where required
  (`test/unit/privacy/plane-boundary.test.ts:53-94`,
  `test/unit/privacy/plane-boundary.test.ts:213-265`).
- `INSPECT_SUMMARY` remains exactly the four frozen keys
  (`src/run/inspection.ts:51-75`).
- `RunStatus` remains the eight signed-off members
  (`src/domain/status.ts:1-12`;
  `test/unit/run/terminal-replay-statuses-freeze.test.ts:30-43`).
- D10 adds no Event type; the event vocabulary remains exhaustively pinned by
  the seed census (`src/run/events.ts:38-77`,
  `test/unit/run/event-row-fuzz.test.ts:981-989`).

The D10 merge changed none of `src/run/inspection.ts`,
`src/domain/status.ts`, or `src/run/events.ts`.

## Verification

- Focused D10, deletion, atomic-write, plane-boundary, record-census,
  `INSPECT_SUMMARY`, `RunStatus`, and Event suites: **174/174 pass**.
- `pnpm typecheck`: pass.
- Environment-only warning: Node `22.14.0` is below package engine
  `>=22.19.0`; no focused failure resulted.
- Independent default-directory symlink probe: **reproduced F1**.

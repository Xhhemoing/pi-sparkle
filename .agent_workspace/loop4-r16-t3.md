# Loop 4 · Round 16 · R16-3 — atomic routing-eval report publication

Status: **COMPLETE**

Branch `agent/opt-continuous` throughout. No checkout, commit, or push was
performed.

## Census

The working-tree census ran before editing:

- `src/adaptation/eval-routing.ts` was the sole raw truncating `writeFile` of a
  persisted, read-back artifact. It wrote
  `adaptation/evals/<candidateId>.<cacheKey>.json`; the only other direct
  `writeFile` in an artifact-owner module was doctor's transient
  `.doctor-write-probe`.
- The shared `src/persist/atomic-file.ts` primitive already provides unique
  `"wx"` temps, fsync, same-directory rename, fallback handling, and cleanup.
  No new temp/rename implementation was needed.
- The producer census found `evalRoutingPolicy` called only by `adapt eval` and
  its owned unit tests. The consumer census found `adapt promote --eval` reads
  the report and passes it through `parseRoutingEvalReport`; malformed JSON is
  already converted to `DomainValidationError`. The privacy record catalog
  also names this exact path. No consumer or catalog update was required.
- Existing `atomic-write-stale-unique-temp` coverage owns the primitive's crash
  behavior. No crash-probe case and no duplicate torn-bytes consumer test were
  added.

The post-change source census finds no raw `writeFile`, direct `rename`, temp
path, or `.tmp` construction in `eval-routing.ts`. Among artifact-owner
modules, the only remaining plain `writeFile` is doctor's transient probe.

## Diff

- `src/adaptation/eval-routing.ts`
  - delegates report publication to the existing `writeFileAtomic`;
  - accepts the helper's optional `AtomicWriteOptions` as a second argument so
    the real rename seam can be paused deterministically in the owned test;
  - preserves the report path and serialized bytes.
- `test/unit/adaptation/eval-routing.test.ts`
  - adds one rename-seam test: it first persists a complete report, pauses the
    replacement after its complete temp is written but before rename, verifies
    the destination still contains the previous complete bytes, then releases
    rename and verifies the destination contains exactly the new complete
    bytes. Both observed states parse as JSON and neither can be a splice.

Owned code/test diff: `7 insertions, 3 deletions` in the source and
`76 insertions, 1 deletion` in the test. `git diff --check` passes.

## Out-of-tree mutation

A minimal repository copy was created at `/tmp/r16t3-mut`, with the complete
`src` tree and owned test. Its baseline was **10 pass / 0 fail / 0 skipped**.
In that copy only, the source was reverted to the raw truncating `writeFile`
implementation and the atomic options seam was removed. The suite then
reported **9 pass / 1 fail**: only the new test failed, with
`report published without reaching the atomic rename seam`.

`/tmp/r16t3-mut` was deleted and verified absent. The shared working tree was
never mutated for this proof.

## Verification

- Owned suite, run 1: **10 pass / 0 fail / 0 skipped**.
- Owned suite, run 2: **10 pass / 0 fail / 0 skipped**.
- Owned suite, run 3: **10 pass / 0 fail / 0 skipped**.
- Scoped ESLint on both owned files: **exit 0**.
- Whole-tree `pnpm exec tsc --noEmit`: **exit 0** on the final tree.
  An earlier attempt observed an in-flight sibling preference-lock edit in
  `src/cli/main.ts` with three unresolved symbols; no non-owned file was
  touched, and the required re-run passed after that sibling edit settled.
- Final `git diff --check` on both owned code/test files: **exit 0**.

Node v22.14.0 emitted the repository's known `>=22.19.0` engine warning only.
No full gate was run (parent-owned), and no forbidden file was edited.

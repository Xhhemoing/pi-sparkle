# Independent review: trusted candidate application binding

Date: 2026-10-15  
Reviewer: TA independent-review agent  
Plan: [trusted apply binding](../superpowers/plans/2026-10-15-trusted-apply-binding.md)  
Verdict: **PASS**

This is a source-disjoint read-only review of the trusted apply slice. The
reviewer did not modify runtime or test code. The reviewed working-tree source
blobs were recorded before this report was written:

| File | Working-tree blob |
|---|---|
| `src/execution/exact-snapshot.ts` | `7f82276bc471369c5451e3a60fd1cd7421b950b0` |
| `src/native/apply-registration.ts` | `d0e7c74a69e4ba1cf85741afbf744ba89fc9aae9` |
| `src/native/apply.ts` | `52152054f77a776500cfa22c07083050690216b3` |
| `test/unit/execution/exact-git-tree.test.ts` | `f14fe0791d313c82e326fb451c2bc03d1dbfb50d` |
| `test/integration/native/apply-registration-inputs.test.ts` | `54f0a45e2f7676f99071cc43eedab937f0f1184f` |
| `test/integration/native/trusted-apply.test.ts` | `0c9096150af5bf3b1f4672c0cfc96e7bd711fdad` |
| `test/integration/development/source-integration.test.ts` | `0d89d55def1096e9bdd937804f6227939f128338` |

## Review result

The implementation has a clear authority boundary. Registration copies and
validates the complete accepted result before its first asynchronous artifact
write, rejects accessors, inherited/custom-prototype values, unsupported
fields, relative candidate paths and serialized signals, and keeps the real
`AbortSignal` outside persisted authority. Apply and disposal use the captured
handle after asynchronous reads, so later caller mutation cannot redirect the
artifact, source repository, candidate or receipt destination. The persisted
trusted-verification metadata remains deliberately insufficient for native
apply; only the original in-process WeakMap-issued descriptor is accepted.

The exact binding is whole-scope and bounded. It requires a genuine in-process
snapshot, direct raw Git object reads with `--no-replace-objects`, strict
NUL-delimited UTF-8 path parsing, duplicate-path rejection, complete tree
addresses, regular-file modes, exact file bytes, path/file/byte limits, and
conservative refusal of symlink, submodule, unsafe path, empty-directory and
unsupported-mode representations. The executable bit is checked against Git's
`100644`/`100755` representation while unrelated filesystem permission bits do
not create a false mismatch. Attribute checks cover the current worktree,
index, old tree and new tree, including repository-info and external attribute
sources and the literal sentinel filter-driver ambiguity, without executing a
clean/process filter.

The trusted apply order is also sound for the stated cooperative boundary. It
captures source and candidate evidence before verification, rechecks the
candidate and declared checker files after verification and after the prepared
callback, stages with explicit CRLF conversion disabled, compares the staged
whole tree with the checked snapshot, and checks the checked-out source bytes
again before branch publication. The frozen `onPrepared` target is awaited
before the first source mutation; the source-integration fixture records the
candidate-apply intent and prepared target in the ledger before checkout.
Cancellation and callback failure fence checkout. If checkout or reference
publication has already changed source state, the code reports the observed
partial/ambiguous state, retains the candidate, and never guesses a rollback.

No old default contract is widened: the non-trusted path and result shape stay
unchanged, historical/copied descriptors remain refused, and there is no
automatic accept, apply, rebase, release, disposal or recovery path.

A prior independent P2 around duplicate empty-file path records was fixed by
rejecting duplicate tree paths and adding a regression (`raw tree equality
rejects duplicate path records`). No unresolved P2 requiring source changes
was found in the current blobs.

## Independent execution

Commands run against the current shared working tree:

```text
node node_modules/typescript/bin/tsc --noEmit
# exit 0

node --import tsx --test \
  test/unit/execution/exact-git-tree.test.ts \
  test/integration/native/apply-registration-inputs.test.ts \
  test/integration/native/trusted-apply.test.ts \
  test/integration/development/source-integration.test.ts
# 56 tests, 55 passed, 0 failed, 1 Windows-only skip
```

The focused run is preserved at
`.agent_workspace/stage4/ta-independent-focused-final.log`. The aggregate
full gate supplied for this review is `.agent_workspace/stage4/full-tests.log`:

```text
3574 tests, 3572 passed, 0 failed, 2 skipped
```

The two skips are platform/opt-in boundaries already documented by the owning
reports; they do not hide a failing trusted-apply assertion. Hosted and other
repository-wide gates remain coordinator-owned delivery evidence.

## Explicit limitations retained by design

This review does not elevate the implementation to hostile concurrent-writer
isolation, crash-atomic checkout/ref publication, cryptographic content
integrity, automatic reconciliation, or production/R10/R11/live-provider
acceptance. A reference hook or external writer can leave a partial checkout;
the implementation intentionally preserves that observed state for manual
inspection. Git object IDs remain immutable object locators, while direct byte
comparison supplies the exactness claim.

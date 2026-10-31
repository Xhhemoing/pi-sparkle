# Optional bounded loop-artifact reads

- Task: B3-03 prerequisite under [bounded development batches and review](../superpowers/plans/2026-10-15-development-batch-review.md).
- Owner: exact-snapshot agent, delegated by command-cleanup; root owns final integration and review.
- Date: 2026-10-15 Asia/Shanghai.
- State: ready for independent review; no commit or production acceptance claimed.

## Contract and scope

`readLoopArtifact(stateRoot, runId, artifactId, options?)` now accepts optional `LoopArtifactReadOptions` with required positive-safe-integer `maxBytes` and `eventLogLimits: { maxBytes, maxRecords }`. The bounded caller uses 512 KiB artifacts and 2 MiB / 10,000-record event logs. Options are validated and copied synchronously before the first await, including rejection of accessors and unsupported option fields. Existing three-argument callers preserve their previous behavior.

The optional third `assertRunPresent` argument accepts `EventLogReadLimits`. It forwards those limits to existing `EventStore.readAll`; initialized-run validation, foreign-run refusal, required RUN_CREATED payload identity and nonmutating torn-tail recovery remain unchanged. No lower-level EventStore or JSONL implementation was edited.

Bounded reads validate run IDs, reject nonregular/symbolic/multiply-linked artifact and event files and linked ancestor directories, and inspect existing paths before acquiring the run lock so a missing bounded target does not create a run hierarchy. The artifact is opened with no-follow/nonblocking flags where available, checked by descriptor metadata, and read into a buffer sized from the validated descriptor. One separate probe byte checks growth. Before/after descriptor and path observations reject truncation, replacement and observed metadata/ancestor identity changes. Memory allocation cannot grow with a concurrently growing artifact.

The reader returns the existing body DTO. It does not run commands, issue verification capabilities, introduce another store, alter artifacts, or persist raw snapshots. Run locks are temporary coordination files and retain the existing implementation.

## Test-first evidence

The new tests initially used a type-only four-argument cast so the unchanged implementation ignored the proposed options at runtime. RED therefore exercised actual legacy behavior, rather than a missing export or loader failure.

Initial command: `node --import tsx --test --test-concurrency=1 --test-name-pattern='^(?!.*special artifact)' test/unit/execution/loop-artifact-bounds.test.ts`.

Observed RED: **1 pass / 11 fail / 0 skip**. Byte/record bounds, invalid options, copied limits, unsafe links and replacement checks failed as expected. The intended name filter did not exclude the FIFO fixture in this environment; the old reader blocked opening that fixture. A writer opened only that test-created FIFO and supplied `{}` to settle the read, which then failed its expected nonregular-file refusal assertion. This approximately 40-second fixture incident is retained here; it is not counted as a dependency failure or a successful safety check.

After implementation the special-file case returns promptly without opening a blocking reader. The temporary type cast was removed and tests use the real exported option type.

Independent review identified that a future regression could make the FIFO test itself hang. The test now keeps the FIFO under the parent fixture's ownership and invokes the reader in an isolated Node child with a 5-second `spawnSync` timeout and `SIGKILL`. Timeout is a test failure; parent cleanup still removes the FIFO. This hardening changes no runtime code. The same 42-test focused command and scoped lint/diff/workflow checks passed again afterward.

## Verification

| Command | Result |
|---|---|
| `node --import tsx --test --test-concurrency=1 test/unit/execution/loop-artifact-bounds.test.ts test/unit/execution/loop-artifact.test.ts` | 20 pass / 0 fail / 0 skip |
| `node --import tsx --test --test-concurrency=1 test/unit/execution/loop-artifact-bounds.test.ts test/unit/execution/loop-artifact.test.ts test/unit/run/event-store.test.ts test/integration/execution/loop-artifact-lifecycle.test.ts test/integration/execution/closed-loop.test.ts` | 42 pass / 0 fail / 0 skip, 2.36 s |
| `node node_modules/eslint/bin/eslint.js src/execution/loop-artifact.ts test/unit/execution/loop-artifact-bounds.test.ts` | PASS after removing one unused test import |
| `git diff --check` | PASS |
| `node scripts/workflow-check.mjs` | PASS, 10 required files / 16 required headings |
| `node node_modules/typescript/bin/tsc --noEmit` | Intermediate shared-source failure in unfinished candidate-review/CLI and batch test typing; no diagnostics in owned files. Root must rerun after integration |
| `node node_modules/typescript/bin/tsc --noEmit --target ES2024 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --skipLibCheck src/execution/loop-artifact.ts test/unit/execution/loop-artifact-bounds.test.ts` | Scoped typecheck PASS |

The tests cover artifact and event caps, exact artifact-size boundary, unchanged default reads, malformed/accessor options, caller mutation, artifact/event symlinks and hard links, linked parents, FIFO refusal, initialized-run failure, torn-tail preservation and deterministic artifact replacement during descriptor reading.

## Limits and handoff

This is a cooperative filesystem reader, not an atomic filesystem transaction or an OS isolation boundary. The existing event reader opens its own path after the bounded wrapper's preflight; pre/post observations reject detected replacement, but do not claim protection against arbitrary hostile transient parent/file swaps or prevention of every path race. Event bytes/records are bounded inside the existing reader before its allocation/return. Equal-length replacement completed before observations remains readable when its schema and locator match, exactly as documented for non-cryptographic artifact locators.

Windows symbolic-link/FIFO tests skip there; this run was Linux only. Independent source review, full combined gate and hosted cross-platform checks are coordinator-owned. Roll back the optional seam if it changes default callers, weakens run identity or yields partial evidence on overflow. Do not replace missing/corrupt artifact evidence with a fabricated successful review.

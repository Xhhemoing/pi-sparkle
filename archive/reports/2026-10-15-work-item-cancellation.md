# Work-item operation cancellation

- Task: B3-01 in [the batch/review plan](../superpowers/plans/2026-10-15-development-batch-review.md).
- Owner: baseline agent; state: ready-for-review.
- Baseline: `726e5e5519aabf74fcb6699c64b268d401a2cefd`.
- Scope: `src/development/work-item-store.ts` and new `test/integration/development/work-item-cancellation.test.ts`; controller integration and shared gates remain separately owned.

## Plan before implementation

Add optional caller signals to `next({signal?})`, `claimNext({owner,baseRevision,signal?})`, and the fifth `markReady` argument. Validate and snapshot operation inputs before awaits. Forward cancellation into host evidence resolvers, check before and after verification, and check after acquiring a lock and before publishing a new claim or ready state. Do not abandon a claim write or throw cancellation after a successful publication: the committed token/result must reach the controller for fenced cleanup. Preserve queue schema, selector policy and explicit release/acceptance authority.

Meaningful RED tests will cover pre-abort, cancellation during accepted-evidence selection/claim verification and final evidence publication, cancellation while waiting for the queue lock, immutable caller-option snapshots, malformed inputs, and abort immediately after a real durable write. Existing work-item tests cover compatibility without caller signals. Verification uses direct Node commands because dependency restoration is coordinator-owned.

Cancellation is cooperative: this slice does not modify the shared file lock, steal locks, impose a hard process deadline, or claim that ignored cancellation can safely detach from durable work. The coordinator explicitly resolved timeout compatibility before implementation: calls without a caller signal retain legacy early timeout rejection; calls with a caller signal abort the active resolver but await its actual settlement before rejecting or releasing the operation lock. A noncooperative host resolver can therefore delay cancellation indefinitely on the new path. Regression tests must cover both timeout modes and caller-abort settlement.

## Verification

| Command / stage | Result |
|---|---|
| `node --import tsx --test test/integration/development/work-item-cancellation.test.ts` before implementation | RED: 9 failed / 2 passed / 0 skipped; absent signal handling and detached timeout behavior reproduced |
| Same command after implementation | GREEN: 11 passed / 0 failed / 0 skipped |
| `node --import tsx --test test/integration/development/work-item-store.test.ts test/integration/development/work-item-cancellation.test.ts test/unit/development/work-items.test.ts` | PASS: 25 passed / 0 failed / 0 skipped, including final lock-rendezvous test refinement |
| `node node_modules/eslint/bin/eslint.js src/development/work-item-store.ts test/integration/development/work-item-cancellation.test.ts` | PASS |
| `node scripts/workflow-check.mjs` | PASS |
| `git diff --check -- src/development/work-item-store.ts test/integration/development/work-item-cancellation.test.ts docs/reports/2026-10-15-work-item-cancellation.md` | PASS |
| `node node_modules/typescript/bin/tsc --noEmit` during parallel implementation | Exit 2: other slices' unfinished `batch.js` import and candidate-review placeholder type errors; no diagnostics in this slice. This is not a full typecheck PASS. |

Logs are in `.agent_workspace/architecture-20261015/work-item-cancellation-{red,green,neighbors,lint,types}.log`. Source/test frozen for independent review at Git blobs `3b55155a09e68e39661d1a734dff7c02b3a06c63` and `6942d4075aa634a31212d67285660baac9e77bb7` respectively.

The new tests use real queue files and exclusive locks. For the late-publication boundary, a test seam aborts only after the original atomic writer returns, then verifies saved bytes, returned ownership and subsequent token-fenced blocking. A lock-rendezvous seam establishes the contender has finished its parent check before the cancellation turn while a real peer still holds the lock. Resolver barriers have diagnostic timeouts and explicit cleanup; tests do not abandon a claim operation to simulate cancellation.

Independent review by the research agent: **PASS**, no scoped blocker, against the frozen source/test blobs above. Independent command `node --import tsx --test test/integration/development/work-item-cancellation.test.ts test/integration/development/work-item-store.test.ts test/unit/development/work-items.test.ts` passed **25 / 0 / 0** in 358.68 ms; log `.agent_workspace/architecture-20261015/store-cancellation-independent.log`. Review confirmed committed token/record delivery, lock-wait cancellation, snapshotted own input fields and actual resolver settlement on the caller-signal path; the legacy no-signal timeout exception remains explicit.

Controller signal wiring, combined full gate, hosted cross-platform checks and staged saving remain coordinator-owned. No production, model effectiveness or global lifecycle-lock claim is made.

## Inherited-signal review follow-up plan

Before the follow-up edit, author self-review and the independent reviewer reproduced that `Object.assign(Object.create({signal: preAbortedSignal}), {owner, baseRevision})` loses its inherited signal during the own-field snapshot and can still claim work. The initial independent PASS above is conditional until this public operation-input gap is closed. Add RED selection and claim tests for inherited signals and inherited accessors, then require ordinary `Object.prototype` or null-prototype input records before snapshotting. Inherited getters must never execute. This is limited to the new store operation-input boundary; no controller or persisted-schema expansion.

Coordinator authorized the narrow input correction. `node --import tsx --test --test-name-pattern='inherited cancellation' test/integration/development/work-item-cancellation.test.ts` reproduced **2 failed / 0 passed** before the helper change (`work-item-cancellation-inherited-red.log`). The helper now rejects custom prototypes before reading any field; both inherited-signal and inherited-accessor cases leave queue bytes unchanged. The full focused/neighbor command above then passed **27 / 0 / 0**, and scoped ESLint passed (`work-item-cancellation-neighbors-final.log`). Frozen corrected blobs: store `7b19f28ffdb81626c50f49ece87c180d1787689f`, tests `4e35adc1309bf61c7720f2f9aaddaf27852871f4`.

Research agent independently re-reviewed the corrected blobs and ran the final store tests and neighbors in its joint verification: **PASS**, no remaining scoped blocker. See [the independent review record](2026-10-15-development-batch-independent-review.md). This supersedes the conditional initial PASS. No other runtime file changed in this follow-up.

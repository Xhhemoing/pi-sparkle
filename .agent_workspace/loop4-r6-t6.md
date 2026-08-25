gpt-5.6-sol

# Loop 4 · Round 6 · R6-6 — Cascade wire witness and process-death helper

Result: **PASS**

Baseline: requested HEAD `b4cc07209d57516fbe7b5dcbaf143e722aff2150`
on `agent/opt-continuous`. No checkout or commit was performed. Concurrent
shared-tree edits outside this slot's ownership were left untouched.

## Change

- Added a loopback parent run with one two-tier child cascade. A test-only
  verifier decorator changes the real Pi executor's synthesized plain-text
  `TASK_RESULT` into deterministic `FAILED` verification on attempt 1 and
  `PASSED` on attempt 2. The production `ChildCoordinator` retry path consumes
  that first verdict and selects the next model; both attempts still travel
  through the configured Pi executor and real loopback HTTP transport.
- The witness pins the received verification sequence (`FAILED`, `PASSED`),
  the production `TASK_RETRY` transition
  (`loopback/loopback-1` → `loopback/loopback-2`), exactly two HTTP requests,
  and most importantly the second request body's `model: "loopback-2"`.
- Generalized the loopback helper's accepted-model option to a non-empty model
  list and made each streamed response echo the model actually requested.
  Unknown models and non-streaming requests remain protocol errors.
- Added `test/helpers/process-death.ts`. Its single API removes
  `runLockPath` after a test abandons a live handle, with the owner-token
  safety argument documented at the helper. The loopback supervised-resume
  test now consumes it; the unowned `m2/resume` copy was left unchanged.
- No `src/**` files changed.

## Boundary disclosure

Plain-text Pi responses synthesize `UNOBSERVED`, so they cannot themselves
create the deterministic `FAILED` evidence required to enter the cascade.
The test-only decorator supplies only that verifier result. It does not choose
the retry model or make HTTP calls: production cascade code chooses the next
tier and the configured Pi executor carries it onto the wire. No adapter
source change was needed.

## Pin disclosure

- Existing exact stderr expectations are byte-identical and unchanged.
- Existing loopback request-count pins remain unchanged: flowchart run+resume
  expects 2, supervised resume expects 1.
- The new cascade witness adds its own exact count of 2 (initial request plus
  one verification-driven retry).

## Verification

- Scoped ESLint over the three owned TypeScript files: **exit 0**.
- Whole-tree `pnpm exec tsc --noEmit`: **exit 0**.
- Timing-sensitive loopback file: **3/3 repeated runs passed**; every run was
  **3 passed, 0 failed, 0 skipped**.
- Whole `test/integration/pi-adapter/` suite: **8 passed, 0 failed, 1 skipped**.
  The sole skip is the real-provider smoke test gated by `PI_SMOKE=1`.
- `git diff --check`: **exit 0**.

The test commands emitted the existing engine warning because this worker runs
Node `22.14.0` while the package declares `>=22.19.0`; all requested checks
completed successfully.

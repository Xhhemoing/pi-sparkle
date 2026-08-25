[Model: gpt-5.6-sol-xhigh-fast]
# Loop 4 Round 2 — R2-6

Implemented three sentinel-synchronized SIGKILL cases in `scripts/crash-probe.mjs`:

- Feedback cascade: a FIFO pins the cascade after the stripped log is visible but before tombstones can publish. The verdict accepts only the complete old or stripped log and rejects tombstone-before-strip.
- Episode settle: the child dies after the terminal snapshot/event append while still holding the episode lock. A waiter times out without writing, explicit stale-lock removal recovers, and the terminal snapshot/event counts remain one.
- Atomic write: the child dies at the public rename seam after its unique temp is durable. The destination remains old-or-new, and a subsequent writer neither adopts nor mutates the stale temp.

The reduced integration probe now asserts all six case verdicts while preserving the original three.

Verification:

- `node scripts/crash-probe.mjs` — pass; six cases × three iterations, JSON verdict `ok: true`.
- `pnpm test -- test/integration/persist/crash-recovery.test.ts` — pass; 1/1.
- `pnpm exec eslint scripts/crash-probe.mjs test/integration/persist/crash-recovery.test.ts` — pass.
- `pnpm typecheck` — pass.

The pnpm commands emitted the existing Node engine warning (runtime v22.14.0; declared minimum v22.19.0). No full gate was run. No commit was created.

[Model: gpt-5.6-sol-xhigh-fast]
# Loop 4 Round 1 — T10 report

Implemented a real-process crash recovery probe with three sentinel-synchronized cases:

- A child flushes an incomplete JSONL tail and self-`SIGKILL`s; the reader returns the intact prefix and exact recovery metadata.
- A child flushes a checkpoint temp document and dies before rename; the store reads the previous document and a subsequent sequential write succeeds. The probe does not inspect or assume the store's temp-file naming.
- A lock holder self-`SIGKILL`s inside the critical section; a waiter receives a lock-path-bearing `DomainValidationError`, then manual stale-lock removal restores acquisition.

The probe defaults to three iterations, emits one JSON verdict line, bounds child waits, uses a fresh OS temp directory, and recursively removes it. The integration test invokes the one-iteration form and enforces a ten-second ceiling.

## Verification

`node scripts/crash-probe.mjs`

```json
{"ok":true,"cases":[{"name":"jsonl-truncated-tail","ok":true,"iterations":3},{"name":"checkpoint-old-then-next-write","ok":true,"iterations":3},{"name":"stale-lock-no-steal","ok":true,"iterations":3}]}
```

`pnpm test -- test/integration/persist/crash-recovery.test.ts`: 1 passed, 0 failed.

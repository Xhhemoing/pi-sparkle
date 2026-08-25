[Model: gpt-5.6-sol-xhigh-fast]
# Loop 4 Round 1 — T7 report

The optimization is retained because both measured append paths improved by more than 5% on the same VM.

## Before

```json
{"ok":true,"samples":1000,"jsonlAppendMs":70.355,"jsonlAppendFsyncMs":308.655,"jsonlReadMs":0.564,"lockSerialMs":178.264,"lockContendedMs":200.318}
```

## After

```json
{"ok":true,"samples":1000,"jsonlAppendMs":45.003,"jsonlAppendFsyncMs":204.972,"jsonlReadMs":0.559,"lockSerialMs":187.589,"lockContendedMs":207.214}
```

- `jsonlAppendMs`: 36.0% faster.
- `jsonlAppendFsyncMs`: 33.6% faster.
- Durable appends now write and sync through one append-mode file handle.
- Both paths attempt the append first and create a missing parent directory only after `ENOENT`.
- Exported function signatures are unchanged.

## Verification

`pnpm test -- test/unit/persist/jsonl.test.ts`: 9 passed, 0 failed.

The scoped tests cover missing directories in both modes, same-handle write and sync, byte-preserving truncated-tail recovery, parallel 1 KB append integrity, and the injected corrupt-line error factory.

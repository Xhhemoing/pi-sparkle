# Durable action ledger verification

## Identity

- Task: `TASK-20261015-durable-action-ledger`.
- Date/environment: 2026-10-15 Asia/Shanghai; Linux, Node 24.19.0.
- Author: delegated action-ledger agent; root owns integration and independent review.
- Plan: [durable action plan](../superpowers/plans/2026-10-15-durable-action-ledger.md).
- Source state: uncommitted stage-two candidate; root binds final staged revision.

## Commands and evidence

| Command | Result | Scope |
|---|---|---|
| `node --import tsx --test test/unit/development/action-ledger.test.ts` before modules existed | RED, exit 1 | `ERR_MODULE_NOT_FOUND`, recorded before implementation |
| Same command after implementation | GREEN, 9/9 | Initial state machine and subprocess crash window |
| `node --import tsx --test test/unit/development/action-ledger.test.ts test/unit/persist/atomic-file.test.ts test/unit/persist/file-lock.test.ts` | PASS, 37/37 | 10 ledger tests including running metadata checkpoint; 27 persistence-neighbor tests |
| `node node_modules/eslint/bin/eslint.js src/development/action-ledger.ts src/development/action-store.ts test/unit/development/action-ledger.test.ts` | PASS | Owned files |
| `node node_modules/typescript/bin/tsc --noEmit` initial concurrent run | FAIL | One author narrowing error corrected; concurrently missing work-item-store test-first implementation remained outside this slice. Final integrated typecheck belongs to root. |
| `node --import tsx --test --test-name-pattern='canonical persisted' test/unit/development/action-ledger.test.ts` | RED, 1 failed | Independent reviewer reproduced unknown canonical snapshot fields and impossible prepared-transition metadata |
| Ledger + atomic-file + file-lock focused command after review correction | PASS, 38/38 | 11 ledger + 27 persistence tests; owned-file ESLint also PASS |

## Behavior and SDK handoff

`new ActionLedger(directory)` uses a caller-selected runtime development directory. `prepare({idempotencyKey,kind,input})` persists immutable strict canonical JSON and an opaque `action_v1_` identifier. Reusing a key with changed input/kind refuses; `createActionIdempotencyKey()` creates a random opaque key. Claiming a prepared version persists a running token before returning. The host must await both operations before invoking its effect.

`checkpoint(claim,{evidence,result})` persists bounded running metadata and returns the advanced claim version. The caller must replace its old claim. Candidate path, source revision and queue claim can therefore be recorded before a model/tool acts. `complete`, `fail`, and `markUncertain` require the matching current version/token and host evidence. These methods never invoke external effects.

Restarting or reading does not replay or reprepare a running action. `recoverInterrupted` requires a host attestation that the previous worker stopped, invalidates its token and enters `needs-reconciliation`. `reconcile` requires the current version, the same worker-stopped attestation, and nonempty actual-state evidence references. `completed` records an observed receipt; `safe-to-retry` explicitly attests the effect is absent and returns to prepared. An ambiguous effect remains blocked. Model self-reports are not authoritative evidence; the controller must inspect the actual candidate/artifact/host state.

The real crash-window test spawns a process, claims an action, writes a filesystem effect receipt, signals readiness and is killed before completion. A second ledger instance cannot claim the running action. Host inspection of that exact receipt reconciles completion and the effect count remains one. Separate tests cover concurrent claim races, stale settlement tokens, evidence refusal, corrupt snapshots, immutable caller input, running metadata checkpoints and failed completion storage access. Atomic-file neighbor tests separately exercise failed publication preserving prior bytes.

## Limits and gates

Independent review correction: schema readers now allowlist snapshot, record and transition fields; initial prepared and claim transitions refuse unsupported evidence/attestation/resolution metadata. The regression uses correctly canonical serialized bytes, so it exercises schema validation rather than merely rejecting formatting. The independent baseline agent re-reviewed the correction, independently ran 38/38 tests and reported no remaining scoped blocker. Exact reviewed copies and its report are under `.agent_workspace/architecture-20261015/action-reviewed-*` and `action-ledger-independent-review.md`; root binds the final integrated revision.

- Short cooperative locks cover metadata only; no network/model/effect is called under the lock. Concurrent processes must share the same ledger directory and stable key.
- This is not a distributed fencing service: a token cannot stop an old external process. The trusted host must actually terminate and observe the previous worker before reconciliation or safe retry.
- The local store rejects corrupt/unknown/noncanonical snapshots, symlink snapshots, missing primary beside publication remnants and size limits. Bounds: 64 KiB per input/result, 1..32 evidence references, 1,024 actions, 256 transitions/action, 8 MiB total snapshot. Exhaustion refuses further work; automatic archival is not implemented.
- Existing atomic-file durability and lock behavior are reused. Stale locks are not stolen; abrupt death inside the short write critical section may need manual lock recovery. No power-loss certification, hostile-filesystem protection, tamper guarantee or cryptographic identity is claimed.
- Actual external operation idempotency remains the host/provider's responsibility. No live provider, GitHub write, production apply, merge or release was exercised by these tests.
- Author verification is distinct from independent review and final integrated gate; root records those separately.

## Handoff

Root integrates the library into the development controller and supplies actual receipt verification. Preserve `needs-reconciliation` when evidence is unavailable; never turn a model's statement into `safe-to-retry`. The checkpoint and complete writes must succeed before their corresponding controller transitions are acknowledged.

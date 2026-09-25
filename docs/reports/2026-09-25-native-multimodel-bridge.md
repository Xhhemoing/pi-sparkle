# Native multi-model bridge — candidate verification record

## Identity

- Task: quality correction to `TASK-20260920-native-delegate-routing`
- Date/environment: 2026-09-25; Windows worktree `E:\Project\pi-sparkle`; branch `codex/controlled-improvement-20260925`
- Candidate state: `ready-for-review`
- Review state: corrected candidate received a fresh independent specification **PASS** and quality **PASS** on 2026-09-25. The two non-blocking quality minors were subsequently closed by freezing `supportedModelIds` at runtime and adding an out-of-scope model exclusion witness to the extension loader test.
- Open gates: `pnpm gate`, `pnpm prerelease`, live-provider execution, Stage 0 freeze, pilot/data approval, production apply, F-PROD, and Outcome-supported evidence.

## Scope and behavior

The earlier native path built a multi-model routing catalog but used a single-model executor. This candidate replaces that mismatch with a host-owned multi-model bridge:

- one eligible host-registry snapshot builds both the canonical routing catalog and executor capability;
- `cheap` and `premium` remain policy aliases only and are canonicalized before assignment; they are not catalog rows or persisted routed model ids;
- every selected canonical model is dispatched through the host's `modelRegistry.streamSimple`; the extension never reads or copies host auth results;
- routing requires the executor capability to cover the complete catalog before any run state is persisted; the no-routing legacy path remains compatible;
- model refs use `formatModelRef` round-trip rules: provider cannot contain `/`, and provider/model components cannot contain surrounding whitespace;
- `defaultModel` is separately checked for strict canonical components and then replaced by the matching eligible snapshot object;
- each eligible `Model` is independently `structuredClone`d and recursively frozen. `supportedModelIds`, lookup, and host dispatch use only this immutable snapshot. Caller-owned model objects remain unfrozen and later mutations cannot change capability or dispatch;
- progress reports the actual request provider/model.

The read-only worker boundary is unchanged: file read and optional recall only; no worker write, shell, spawn, ambient transcript collection, credential persistence, or independent-verification claim.

## RED evidence

| Evidence | Command and expected failure |
|---|---|
| `.agent_workspace/verification/native-multimodel-red-2026-09-25.log` | Four-file focused command; exit 1, 13 pass / 7 fail. Exposed synthetic alias rows, false singleton capability, absent multi-model bridge, and incomplete fail-closed validation. |
| `.agent_workspace/verification/native-capability-red-2026-09-25.log` | Native-session focused command; exit 1, 10 pass / 1 fail. Routing accepted an executor with no declared capability. |
| `.agent_workspace/verification/native-canonical-ref-red-2026-09-25.log` | Catalog + executor focused command; exit 1, 4 pass / 2 fail. `provider /model`, `provider/ model`, and provider-containing-slash host models were accepted. |
| `.agent_workspace/verification/native-default-canonical-red-2026-09-25.log` | Native-executor focused command; exit 1, 3 pass / 1 fail. A non-canonical raw default matched a canonical eligible ref after trimming. |
| `.agent_workspace/verification/native-model-snapshot-red-2026-09-25.log` | Native-executor focused command; exit 1, 3 pass / 1 fail. Mutating the caller's model after construction changed the model used for dispatch and caused the run to fail. |

## Current author verification

| Command | Result |
|---|---|
| `pnpm test -- --test-concurrency=1 test/unit/pi-adapter/model-identity.test.ts test/unit/pi-adapter/native-executor.test.ts test/unit/native/routing-catalog.test.ts test/unit/native/session.test.ts` | exit 0; 23 pass / 0 fail / 0 skip. Raw log: `.agent_workspace/verification/native-multimodel-green-2026-09-25.log`. |
| `pnpm typecheck` | exit 0. |
| `pnpm exec eslint src/execution/contract.ts src/pi-adapter/pi-executor.ts src/pi-adapter/native-executor.ts src/native/routing-catalog.ts src/native/session.ts extensions/pi-sparkle/index.ts test/unit/pi-adapter/model-identity.test.ts test/unit/pi-adapter/native-executor.test.ts test/unit/native/routing-catalog.test.ts test/unit/native/session.test.ts` | exit 0; no findings. |
| `pnpm security:probe` | exit 0; 26 PASS / 0 open findings / 0 waivers. |
| `pnpm pi:probe` | exit 0; four PASS checks on Pi 0.86.1 pins/import boundary. |
| `pnpm workflow:check` | exit 0; 10 required files and 16 required headings. |
| `git diff --check` | exit 0; CRLF normalization warnings only for existing working-copy line endings in `src/execution/contract.ts`, `tasks/todo.md`, and `test/unit/pi-adapter/model-identity.test.ts`. |
| Combined post-review focused set | exit 0; 56 pass / 0 fail, including runtime-frozen capability and scope-exclusion witness. |

The real loopback coverage includes two distinct providers, learned `prefer: cheap`, canonical secondary dispatch, zero requests to the primary transport, non-empty two-model `scopedModels` through the packaged extension loader, zero extension credential reads, and a synchronous host `streamSimple` throw becoming an execution failure. The mutation regression changes the original secondary model's provider, id, nested cost, and nested headers after bridge construction; capability and every host dispatch retain the original recursively frozen snapshot while the caller's object remains mutable.

## Limits and rollback

This is an uncommitted candidate on a dirty integration baseline. `pnpm gate` and `pnpm prerelease` were not run in this slice and must not be inferred from focused checks. There is no live-provider acceptance; independent review covers this candidate only and does not authorize pilot or production use.

Rollback disables native catalog routing and returns to the no-routing single-model compatibility path. It must not restore the false general-executor singleton capability, synthetic alias catalog rows, raw credential extraction, or mutable model references.

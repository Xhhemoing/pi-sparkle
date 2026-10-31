# Opt-in exact verification: implementation and evidence

## Identity

- Task: `TASK-20261015-trusted-verification`; [plan](../superpowers/plans/2026-10-15-trusted-verification.md).
- Date: 2026-10-15 Asia/Shanghai; Linux, Node v24.19.0.
- Owners: execution wrapper/wiring by command-cleanup agent; exact filesystem helper delegated to exact-snapshot agent; native integration belongs to audit-loop agent; root binds the final source revision and delivery gate.
- State: implementation/focused verification complete; independent scoped source review passed after two findings were repaired; root owns final committed-source binding and combined-source gate.

## Behavior

The host can issue a frozen `TrustedVerificationDescriptor` with `prepareTrustedVerification({ command, args, checkerFiles, snapshotManifest, maxSnapshotBytes, maxSnapshotFiles })` and pass it as `trustedVerification` to `runIndependentCheck` or `runClosedLoopCheck`. Native integration preserves the same descriptor identity inside `verification.trustedVerification`.

The descriptor copies/fixes command, argv, manifest and bounds before asynchronous execution. Declared external checker files are captured at issuance and compared at invocation and after execution. A fixed inline verifier may declare no external checker files; the host remains responsible for declaring implementation/dependency files it wants included in the guarantee. Candidate-owned checker definitions and linked definition paths are refused. A different command/argv/manifest or copied/serialized descriptor cannot authorize the opt-in check.

Exact candidate snapshots include clean tracked, changed, untracked and ignored filesystem content in the fixed manifest, excluding `.git`. They compare path sets, file/directory modes and binary bytes with `Buffer.equals`. Included symlinks, hardlinks, special files, missing required prefixes, unstable reads, excessive files/bytes/traversal and unsupported names fail closed. Generated output changes need host-fixed exclusions; `allowedOutputDirs` is deliberately unsupported in exact mode. Default bound: 256 files / 4 MiB; descriptor hard maxima: 4,096 files / 32 MiB. Directory scanning has its own entry/depth budget.

Before-execution uncertainty refuses execution. After-execution inequality or uncertainty yields `check.ok: false` and a non-sensitive reason in `check.trustedVerification`. A completed exit-zero checker does not override these failures. Exact opt-in acceptance also requires the original frozen in-process check object bound to the original host descriptor; serialized records are inspectable historical evidence, not renewed runtime authority.

No snapshot bytes are exposed on snapshot handles, descriptor objects, checks or persisted artifacts. Private WeakMaps hold ephemeral candidate snapshots and reusable host checker snapshots. Persisted evidence adds only opaque descriptor ID, schema name, equality verdict/reason, and file/byte counts. Existing command output remains under its existing bounded-output contract. No cryptographic hashes, substitute digests, new privacy store or event union were added.

## Legacy and apply boundary

Callers that omit the descriptor retain existing g1a-v1 behavior, including its known same-length rewrite limitation. A regression explicitly demonstrates legacy success alongside opt-in rejection for the same same-length rewrite. Legacy allowed-output behavior stays compatible.

This slice strengthens candidate verification only. It does not turn historical serialized check claims into trusted apply authorization. The native owner added explicit rejection of trusted-mode candidate issue/application until a fresh trusted apply protocol is implemented; there is no silent downgrade to ordinary command/argv re-verification.

## Changed files

- `src/execution/exact-snapshot.ts`: bounded opaque exact filesystem observations and equality.
- `src/execution/trusted-verification.ts`: host descriptor issuance, invocation/postcheck validation and runtime evidence identity.
- `src/execution/independent-check.ts`: optional exact observation and additive safe verdict metadata.
- `src/execution/acceptance.ts`: opt-in evidence identity check; legacy default unchanged.
- `src/execution/closed-loop.ts`, `src/execution/index.ts`: host SDK propagation/exports.
- Focused exact/trusted tests and additive closed-loop integration test; this report and plan.

## Verification record

| Command | Outcome | Evidence |
|---|---|---|
| `node --import tsx --test --test-concurrency=1 test/unit/execution/trusted-verification.test.ts` before module implementation | RED | 0 pass / 1 failed test file; `ERR_MODULE_NOT_FOUND` for new trusted-verification module. |
| Exact helper's initial focused regressions | RED | 0 pass / 17 fail, recorded by delegated helper owner before implementation. |
| Exact helper first implementation run | 16 pass / 1 fixture issue | Unix socket special-file fixture hit sandbox `listen EPERM`; replaced with a real FIFO fixture, without sandbox override. |
| `node --import tsx --test --test-concurrency=1 test/unit/execution/exact-snapshot.test.ts test/unit/execution/worktree-snapshot.test.ts` | GREEN | 28 pass / 0 fail / 0 skip; includes 18 exact cases and legacy compatibility cases. |
| `node --import tsx --test --test-concurrency=1 test/unit/execution/trusted-verification.test.ts` | GREEN | 6 pass / 0 fail / 0 skip. |
| `node --import tsx --test --test-concurrency=1 test/unit/execution/trusted-verification.test.ts test/unit/execution/exact-snapshot.test.ts test/unit/execution/independent-check.test.ts test/unit/execution/acceptance.test.ts test/integration/execution/closed-loop.test.ts` | GREEN | 49 pass / 0 fail / 0 skip; 3.7 s. |
| Same combined command after independent-review fixes and linked-cwd regression | GREEN | 50 pass / 0 fail / 0 skip; 5.2 s. |
| `node --import tsx --test --test-name-pattern='linked candidate' test/unit/execution/trusted-verification.test.ts` before linked-cwd fix | RED | 0 pass / 1 fail: `Missing expected rejection`; after enforcing canonical cwd, full wrapper suite 7/7 passed. |
| Independent reviewer wrapper/closed-loop/independent-check/acceptance command plus adversarial probes | PASS | 32 pass / 0 fail / 0 skip; probe outcomes: registrar removed, forged failed record rejected, linked root rejected before execution. |
| Final wrapper command after adding unchanged-external-checker reuse control | GREEN | 8 pass / 0 fail / 0 skip; same host descriptor succeeds twice with unchanged external checker and declared dependency. Runtime source unchanged since independent review. |
| Scoped ESLint on all new/changed execution files and tests | PASS | Helper owner and execution owner each checked their disjoint files. |
| Intermediate `node_modules/.bin/tsc --noEmit` | Not yet green | Only concurrent development-module incomplete work: `action-ledger.ts` nullable `prior`, missing `work-item-store.ts` and dependent test types. No exact/trusted execution errors reported. Root owns final combined-source typecheck. |
| Later `node_modules/.bin/tsc --noEmit` after exact fixes | Not yet green | Remaining concurrent development errors only: `controller.ts:184` exact optional fields and `recipe-check.ts:13` implicit `any`. No exact/trusted/native integration errors. |
| `node scripts/workflow-check.mjs` and `git diff --check` | PASS | 10 required files / 16 required headings; no whitespace errors. |

The 49-case execution run verifies successful exact checks, same-length candidate changes, checker/dependency changes before and during execution, fixed argv/manifest, forged descriptor/evidence refusal, immutable descriptor data, candidate-owned checker refusal, oversize refusal, private snapshot data, and all adjacent legacy acceptance/closed-loop behavior. The new closed-loop case reads the persisted artifact and confirms candidate snapshot bytes are absent and source files remain unchanged.

## Independent review and repairs

The helper author independently reviewed the wrapper/wiring they did not author and reproduced two P1 counterexamples before delivery:

1. An exported registration helper could mark a forged JSON-cloned failed record as authoritative. Registration now lives in a private WeakMap inside the real `runIndependentCheck` execution path; there is no caller-accessible registrar. Acceptance exposes only a read-only authenticity predicate.
2. Canonicalizing a linked cwd before observation could hide persistent symlink retargeting, allowing the exact snapshot to observe a different root from the invocation's path. Exact mode now refuses noncanonical/linked cwd before invocation. This stricter opt-in caller constraint does not change legacy behavior.

Independent re-review returned PASS with both repros failing closed and 32 relevant tests passing. The execution owner then reran the complete 50-case focused slice successfully. The review is scoped to these files and observed behavior, not production acceptance; root must bind it to the final committed source.

## Explicit limits and next gates

This is cooperative pre/post equality, not atomic filesystem isolation. Unobserved transient swap-and-restore between observations, privileged host mutation, undeclared transitive dependencies, external network state and model/task quality are outside its proof. The helper checks descriptor/path identity during each capture, but no OS-sandbox or cryptographic attestation claim is made.

The host chooses scope and checker dependencies; a large repository should select explicit relevant include prefixes and reviewed exclusions. Too-large or unusable scope refuses verification rather than falling back to path/size checks. A descriptor intentionally cannot be resumed from JSON after process restart; the host must issue fresh authority and execute fresh verification.

R10/R11 production owner acceptance, live-provider experiments, autonomous apply, F6 and Outcome-supported claims remain open. Root owns final independent review, combined-source gate/probes and committed revision binding.

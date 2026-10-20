# Managed Pi generation qualification

## Identity
- ID: TASK-20261019-managed-pi
- Owner: root coordinator and implementation/review agents.
- State: planned.
- Date: 2026-10-19.
- Authority: ADR-009 section 5; [parent plan](2026-10-19-staged-continuation.md).

## Problem and scope
Static pi-compat inspection does not show that a candidate engine honors stop, usage, cancellation or settlement. The installed exact core/ai 0.86.1 tree can support offline qualification without paid provider calls. First implement isolated candidate staging and actual adapter subprocess qualification; then bind standalone root execution and resume to the qualified generation. No in-flight module replacement, native-host update, provider benchmark or production containment claim.

## Source-grounded constraints
PiAgentExecutor constructs the real Agent and waits for prompt/waitForIdle. Existing integration/pi-adapter/cost-stop.test.ts uses that real adapter with a deterministic faux provider and asserts one call after a priced tool turn. Reuse its behavior, not a substitute fake Agent.

Node resolves ESM imports relative to the importing module. cwd and NODE_PATH cannot redirect workspace imports. Installed pnpm junctions point into the workspace dependency tree; copying those links unchanged is not isolation. Stage physical packages and the actual built application with all transitive dependencies. A missing dependency beneath .agent_workspace can fall back to ancestor node_modules: resolve real paths and reject any module outside the candidate before evaluation. This is dependency isolation, not an OS filesystem/network sandbox.

The current CLI explicitly rebuilds executor configuration during resume. Managed binding must be additive durable Run/RUN_CREATED data, validated and replayed through existing stores, inherited by child/retry operations. An old run without binding retains its explicit legacy behavior. A managed run with missing original generation must refuse rather than use the newest one.

Existing writeFileAtomic Windows fallback temporarily moves the old file aside. Approved-selection readers and writers must share the existing manager lock; do not claim unlocked old-or-new visibility. Retain referenced generations and defer GC until actual reference-safe deletion is implemented.

## Implementation slices
| Slice | Files/symbols | Acceptance |
|---|---|---|
| M5-A isolated candidate | src/pi-adapter/managed/candidate.ts; process tests | Exact manifest versions, full physical dependency closure, immutable opaque generation directory, no workspace fallback or escaping junction |
| M5-B qualification | managed/qualification-worker.ts and qualification.ts; shared deterministic fixtures | Actual staged adapter/kernel in child process; bounded timeout/output; structured observed scenario results; supplied JSON alone cannot qualify |
| M5-C selection | managed/generation-store.ts using existing file lock | Qualification stored before approved selection; failure preserves old selection; all selection reads participate in lock; no GC |
| M5-D standalone binding | domain/run.ts, run/events.ts and existing replay/child/CLI paths, precise symbols confirmed before edits | New root snapshots qualified generation before dispatch; children/retry/resume retain it; missing generation refuses; no per-execute IPC replacement |

## Test-first plan
Observed RED before each behavior: version mismatch before Agent creation; missing dependency despite valid workspace copy; escaped module resolution; priced first tool turn gives exactly one provider call/tool completion/usage/stop notification and settled terminal; unpriced model gives explicit unenforced-cap behavior; preabort zero calls; cancellation during blocked tool waits until release and sends no later request; real Agent deferred agent_end listener keeps waitForIdle pending; failed qualification preserves selection. Root binding tests cover A to B approval change, old-root child/retry/resume remaining A, new root B, and missing A refusing.

Focused command: pnpm test --test-concurrency=1 test/integration/pi-adapter/managed-generation.test.ts test/integration/pi-adapter/cost-stop.test.ts (exact additional files recorded per implementation slice). Typecheck, focused lint, actual built subprocess execution, independent specification then quality review. Final pnpm gate, security:probe, pi:probe and workflow:check remain existing delivery checks.

## Risks, rollback and handoff
Stage only required program/dependency files; never copy credentials, user projects or runtime state. Child gets isolated state/config/home and no credential forwarding for deterministic qualification. Preserve package/lockfile pins. Revert source normally and retain old approved generation plus run references. OS escape, power-loss/platform qualification, uncooperative old writers, native-host lifecycle and production acceptance require their own actual evidence. No new hash, frozen contract or gate. Record commands and results in the staged report; no source change or qualification was performed by the read-only design review.

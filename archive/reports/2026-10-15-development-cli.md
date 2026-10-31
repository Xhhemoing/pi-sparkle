# Development CLI verification

- Task: `TASK-20261015-development-cli` (DP-05 command surface).
- Baseline: stage-two shared checkout from `c2b802c`.
- Date/environment: 2026-10-15 Asia/Shanghai; Linux, Node 24.19.0.
- Author: runtime agent; independent review and full integration gate owned by root.
- [Plan](../superpowers/plans/2026-10-15-development-cli.md).

## Delivered behavior

`develop` now provides init, status, next, candidates, run, accept, reconcile and
release, plus help and one-object JSON output. `main.ts` adds a lazy dispatch
branch and usage entry; README gains its command row. Existing run/resume help,
errors and behavior remain unchanged.

Initialization accepts strict `{id, authorityRef, items}` host definitions. The
file is read through a bounded regular-file descriptor (at most 1 MiB), the id
must match the safe queue selector, and no checker is executed. Storage is
`runtimeRoot(stateRoot)/development/<queue-id>/queue.json`. Unknown, duplicate,
irrelevant or invalid flags are refused before a queue mutation.

Run requires explicit fake or Pi mode. Defaults are 3 attempts and 600000 ms,
within native limits of 5 attempts and 1800000 ms. Fake uses the protocol fixture
executor and performs no LLM calls or writes: only the actual host checker can
confirm already-satisfied contents. Pi uses the extracted model options and
configured adapter, preserving exactly the supplied native read/write tool
closures and exposing no command tool. Invocation telemetry is queued and
awaited before return; SIGINT/SIGTERM abort the bounded run. Output labels mode
explicitly. A host-only factory seam supports offline wiring verification.

Status returns stored queue/action state. Next is advisory. Candidates project
recorded action checkpoints with action state and an explicit checkpoint-only
label; they do not claim fresh verification. Accept calls the controller's
host evidence review and reports that source application did not occur.
Reconcile uses only completed receipts and reports unresolved running/unknown
effects without replay. Release invalidates the task claim only and warns that
the worker must be stopped and unknown effects remain unresolved.

## Verification

| Check | Result |
|---|---|
| Initial six CLI behavior cases against absent command | RED 0 pass / 6 fail |
| Implemented CLI cases | PASS 9/9 |
| CLI + controller + README/help parity + frozen error-route command below | PASS 25/25, 0 fail, 0 skip |
| `node node_modules/typescript/bin/tsc --noEmit` | PASS |
| ESLint on development/main CLI and CLI integration test | PASS |
| `node scripts/workflow-check.mjs` | PASS |
| `git diff --check` | PASS |

```sh
node --import tsx --test \
  test/integration/cli/development.test.ts \
  test/unit/cli/readme-command-parity.test.ts \
  test/unit/cli/doctor-routed-next-freeze.test.ts \
  test/integration/development/controller.test.ts
```

Tests cover no-checker init, unsafe/oversized input refusal, unchanged queues on
invalid flags, explicit review, completed receipt reconciliation, running-effect
non-replay, claim-only release, fake self-report rejection, and a real scoped
candidate file write through an injected Pi factory. That last test validates
model/tool/telemetry wiring and source preservation; it is an offline fixture,
not a live-model success. Pi tool tests prove original closures remain intact
and incomplete descriptors fail closed.

Evidence logs: `.agent_workspace/executor-fallback-audit/development-cli-red.log`,
`development-cli-focused.log`, and `development-cli-types.log`. The first type
check found the result-interface/object-spread mismatch; the final source fixes
it and the current typecheck log is empty with exit 0.

## Limits

No live provider call, automatic source apply, model effectiveness claim,
general process sandbox, unknown-effect reconciliation attestation or
production acceptance is added. Host check commands execute only through the
existing controller/native verification path. Root owns controller review,
combined-source verification and staged publication.

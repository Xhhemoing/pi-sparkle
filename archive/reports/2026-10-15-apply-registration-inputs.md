# Stable native apply registration inputs

- Task: TA-00; owner: registration author; state: ready-for-review.
- Baseline: PR #60 `e837aab0950bfafeb669a6a88d9499944fa7dbae`.
- Controlling [plan](../superpowers/plans/2026-10-15-trusted-apply-binding.md)
  and [checklist](../tasks/trusted-apply-binding-todo.md) read before edits.
- Exclusive scope: `src/native/apply-registration.ts`, new
  `test/integration/native/apply-registration-inputs.test.ts`, this report.

## Design and acceptance

Synchronously capture all persisted result data and source/handle bindings
before the first await. Reuse the strict stable JSON serializer for a deep
plain-data snapshot, rejecting accessors/custom prototypes/non-JSON values
without recovering runtime authority. Input/handle fields are explicitly
allowlisted; retain a genuine AbortSignal separately. Capture path resolution
before asynchronous work. Registration, reconstruction, apply and disposal use
only the captured values; caller mutation cannot redirect later operations.

The default trusted-verification refusal stays active. Candidate paths are
required to be absolute before persistence or artifact lookup. No fresh
descriptor is accepted here, no opaque locator gains an integrity/tamper claim,
and apply's existing verification and disposal identity checks remain
authoritative. Loop-artifact IDs remain opaque locators; the artifact reader's
recorded byte-length check does not claim to detect an equal-length replacement.

## Test-first plan

Use temporary real repositories and real native candidate results. First prove
registration command/argv/identity mutation, apply/dispose handle mutation and
accessor/unknown/inherited-field defects with failing tests. Then snapshot
inputs and rerun focused plus neighboring registration/native tests. Record
exact RED/GREEN and static results; independent review and full gate are owned
by the coordinator. Do not commit or edit adjacent runtime implementations.

## Evidence

The focused RED was the relative-candidate case: registration accepted a
relative `candidatePath` before validation. The fix validates the captured
result and apply/disposal handles with `path.isAbsolute` before the first
asynchronous operation. The focused and adjacent registration suites now pass:

```text
node --import tsx --test \
  test/integration/native/apply-registration-inputs.test.ts \
  test/integration/native/apply-registration.test.ts \
  test/integration/native/apply-registration-crash.test.ts \
  test/unit/native/apply-registration.test.ts
23 tests, 23 passed, 0 failed
```

ESLint and `git diff --check` pass for the owned source, test, and report.
Empty directories and unsupported Git path/mode representations fail
conservatively. Whole snapshots inherit the descriptor's bounded file/byte
limits; no raw file snapshot is persisted and Git object identifiers only
address immutable objects, not new content-integrity authority.

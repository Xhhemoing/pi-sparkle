# R6-4 — Doctor inventory for learned and derived state

Slot: R6-4 (P2, adaptation-plane operability). Branch `agent/opt-continuous`, HEAD at start `b4cc072`. Not committed, per instructions.

## Verdict

Landed. Doctor now adds a frozen-additive `learnedState` inventory covering every discovered project-key `bandit.json`, `preferences.json`, and `catalog-observed.json`. Entries report `present | absent | readable | damaged`, classify state as `learned | derived`, and carry the plane-correct remedy. Damaged files remain advisory; only inventory scan/read errors fail `learned-state-inventory`, matching the `runStates` posture. The inventory never writes, repairs, moves, deletes, or rebuilds state.

## Census before implementation

- Bandit: `loadProjectBandit(stateRoot, projectRoot)` is the only shipped reader. It returns `undefined` only for ENOENT and throws `BanditStateUnreadableError` for invalid JSON, emptiness, or invalid bandit shape. Bandits are stored under `adaptation/learning/projects/<stableProjectKey>/bandit.json`, but the file contains no reversible project-root metadata.
- Preferences: `configurePreferencePersistence(path)` is the shipped reader/binder. It throws `PreferenceSnapshotUnreadableError` for invalid JSON/snapshot shape and silently accepts absence. No standalone preference snapshot parser/reader is exported.
- Observed catalog: `loadCatalogObservedSnapshot(stateRoot)` is the shipped reader. It throws `CatalogObservedCorruptError` only for invalid JSON; parseable version-skew shapes intentionally degrade to an empty snapshot.
- Doctor already had additive `locks` and `runStates` inventories. `run-state-inventory` fails only when `scanErrors` is nonempty. JSON key order and pre-existing check order were pinned in `doctor.test.ts`.
- No reader contract defines ordinary damage from a message string. All three typed errors are imported and caught by class.

## Implementation

`src/cli/doctor.ts`:

- Appends `learnedState` to `DoctorJsonReport`; all pre-existing keys and checks remain in place.
- Adds entries with the stable shape `{ kind, stateClass, projectKey, path, status, remediation }`.
- Scans project-key directories and also includes the requested `--project` key, allowing a never-written current project bandit to report `absent`.
- Drives each bandit through `loadProjectBandit`. Because the reader accepts a root rather than a stored key, doctor constructs and verifies an opaque base-31 preimage for the stored `stableProjectKey`; this selects the existing path without parsing bandit bytes in doctor.
- Drives preferences through `configurePreferencePersistence` and immediately unbinds after a successful read; drives the observed catalog through `loadCatalogObservedSnapshot`.
- Uses filesystem metadata only to distinguish singleton absence before calling readers. There is no second JSON parser for these artifacts.
- Catches only the three typed domain errors as `damaged`. Any other reader or directory failure enters `scanErrors`, leaves the entry `present` but unclassified where applicable, and fails only the new inventory check.
- Adds equivalent prose output with project key, class, status, path, and remediation.

`test/unit/cli/doctor.test.ts`:

- Pins the frozen-additive top-level key, inventory shape, and appended check name.
- Covers readable, absent, and typed-damaged bandits across three project keys; typed-damaged and readable preferences/catalog snapshots; learned-vs-derived remedies; prose output; and byte identity before/after doctor.
- Pins that three damaged artifacts do not fail doctor.
- Pins that an actual directory scan error does fail doctor and does not mutate the obstructing path.

## Disclosures

1. The preference module exposes only a process-global binder, not a pure reader. Doctor uses that shipped contract and unbinds after success. It changes no disk bytes; in normal CLI use the process exits after the command. A future pure exported preference reader could remove the transient in-memory load without changing this JSON contract.
2. Stored bandit directories have only a hash key and no root lookup table. The opaque preimage is verified with `stableProjectKey` before use; if that key algorithm changes, doctor reports a scan error rather than reading the wrong path.
3. `present` is the fail-closed status for a known path whose reader raised a non-domain scan/read error. `readable`, `absent`, and `damaged` are reader-proven states.

## Verification

Environment setup completed successfully. VM Node is v22.14.0, so the scoped test command prints the repository's expected engine warning (`>=22.19.0`); doctor tests inject the compliant version where host independence is required.

- `pnpm exec eslint src/cli/doctor.ts test/unit/cli/doctor.test.ts` — exit 0.
- `pnpm exec tsc --noEmit` (whole tree, including concurrent slots) — exit 0.
- `pnpm test -- test/unit/cli/doctor.test.ts` — 15/15 pass, 0 fail, 0 skip.
- `git diff --check` — exit 0 before report creation.

## Owned files

- `src/cli/doctor.ts`
- `test/unit/cli/doctor.test.ts`
- `.agent_workspace/loop4-r6-t4.md`

`src/persist/file-lock.ts` and `src/cli/main.ts` were not edited by this slot. No commit was created.

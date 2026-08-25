# R7-8 — Narrow the doctor exception

Slot: R7-8 (P3, seam hygiene). Branch `agent/opt-continuous`, HEAD at report time `a28e2b5`. Not committed, per instructions.

## Verdict

Landed. `bandit-store.ts` exports a keyed read path (`loadProjectBanditByKey`, plus `projectBanditPath` so the inventory names the file the reader read, by construction). `preferences/store.ts` exports a pure reader (`readPreferenceSnapshot`) that validates a snapshot without binding the process-global store. Doctor consumes both; the base-31 hash preimage and the bind/unbind are deleted. The isolation pin's `assert.match` moved to the new symbol in the same diff, `because` unchanged in substance — read-only inventory, never a selector.

`learnedState` JSON is byte-identical for every input the shipped writers can produce (argued and re-verified below); the two behavioral deltas are both in corners the old code got wrong, and both are now pinned.

## Census before implementation

**Bandit read path.** `loadProjectBandit(stateRoot, projectRoot)` was the only shipped reader and hashes its argument through `stableProjectKey`. Doctor discovers *stored keys* by scanning `adaptation/learning/projects`, so R6-4 inverted the hash: `projectRootForStoredKey` re-encoded the key's magnitude as base-31 code units and round-trip-verified the result. Direct callers of `loadProjectBandit` at HEAD: `test/unit/learning/bandit-store.test.ts`, `bandit-store-atomic.test.ts`, `auto-loop.test.ts`, and `src/cli/doctor.ts`. No `src/` caller other than doctor. The path layout `adaptation/learning/projects/<key>/bandit.json` was spelled out in three places (`bandit-store.ts`, `learned-routing.ts` for `routing.json`, and doctor).

**Preference read path.** `configurePreferencePersistence(path)` was the only shipped reader, and it *is* a binder: on a successful parse it replaces `observations`/`tombstones` with the file's contents, rebuilds the views, and points the writer at that file. Doctor called it and then called `configurePreferencePersistence(undefined)` to unbind. Callers at HEAD: `src/cli/main.ts` (via `preferences/service.ts`), `src/cli/doctor.ts`, and eight test files. `PreferenceSnapshot` and `parseSnapshot` were module-private.

**Consumers of what I changed** (the R6-8 process rule):

| Consumer | Reads | Effect of this diff |
|---|---|---|
| `test/unit/routing/live-isolation.test.ts` | doctor's source text for `loadProjectBandit` | **Breaks unless updated** — updated here, in the same diff (signed off) |
| `test/unit/cli/doctor.test.ts` | the whole `learnedState` contract | Green unchanged; two pins added |
| `test/integration/cli/command-error-doctor.test.ts` (R7-10) | `learnedState` field names + a `configurePreferencePersistence(undefined)` repair in a `finally` | Green unchanged. The repair was there because doctor bound the global (R6-5's note "the store binds a process global; leave it where the suite found it"); it is now unnecessary but still correct, so I left another slot's file alone. R7-10 may drop it |
| `src/cli/main.ts` (R7-5) | `learnedState[]` in three routed `next:` lines | Field names untouched; `DOCTOR_ROUTED_NEXT` not touched |
| `scripts/crash-probe.mjs` | imports `doctorCommand` for `pidLiveness` | Signature and lock inventory unchanged |
| `test/unit/preferences/persistence-atomic.test.ts` | source pin on `store.ts`: must match `writeFileAtomicSync(`, must not match `writeFileSync(`/`renameSync(` | Still holds; the new reader only reads |
| bandit/preference/deletion/redaction/clarify suites | the two stores' behavior | Green unchanged (95 tests, below) |

Docs are stale and not mine: `docs/status-matrix.md:63` still says "`selectArm` and `loadProjectBandit` have zero live callers" — already false at HEAD since R6-4, and now naming a symbol doctor no longer calls. `docs/decisions/0005-checkpoint-f-holdout-open-questions.md:110` says the same. **Prescription for R7-6:** status-matrix should read "doctor's `loadProjectBanditByKey` inventory is the one signed-off read-back; `selectArm` has zero live callers". I did not touch either file, and flag rather than edit the ADR body per the §3 process rule.

## What changed

**`src/learning/bandit-store.ts`** (+24). `projectBanditPath(stateRoot, projectKey)` exported and made the single place the bandit file layout is spelled; `banditPath(stateRoot, projectRoot)` now delegates through it after hashing. `loadProjectBanditByKey(stateRoot, projectKey)` exported with the same contract as `loadProjectBandit` — `undefined` only for ENOENT, `BanditStateUnreadableError` for damage, nothing written back either way. `loadProjectBandit` is unchanged and keeps its three test callers.

**`src/preferences/store.ts`** (+18). `readPreferenceSnapshot(file)` exported: `existsSync` guard, then `parseSnapshot`. It touches no module state and does not bind. `loadFromDisk` is now expressed in terms of it, so there is exactly one snapshot read path and the binder's fail-closed posture is unchanged (a throw still happens before any in-memory mutation). `PreferenceSnapshot` is exported because it is the reader's return type.

**`src/cli/doctor.ts`** (−34 net). Deleted `projectRootForStoredKey` and the whole unmappable-key branch; the bandit loop is now `projectBanditPath` + `loadProjectBanditByKey` on the stored key. Deleted the bind/unbind pair; the preferences probe is `readPreferenceSnapshot`. `stableProjectKey` is still imported and used for the one place it belongs — turning `--project` into a key to add to the scan set.

**`test/unit/routing/live-isolation.test.ts`** (the one pin). `assert.match` on doctor's source moves from `/\bloadProjectBandit\b/` to `/\bloadProjectBanditByKey\b/`, with the message unchanged ("doctor's signed-off exception is the learnedState inventory reader, not a selector") and a comment recording that the sign-off is unchanged and only the symbol moved. The companion `readers` sweep — which asserts no *other* live module reads stored bandit state back — widened to `/\bloadProjectBandit(?:ByKey)?\b/` so the new symbol cannot become a hole in the guard. The file docstring's bullet for `routing/bandit.ts` names the new symbol and now states the sign-off verbatim as "read-only inventory, never a selector". That docstring bullet *is* this pin's justification, so I amended it rather than leave it naming a deleted call; nothing else in the file changed.

The pin move was mandatory, not cosmetic: `\b` after `Bandit` does not match `loadProjectBanditByKey`, and `grep -cE '\bloadProjectBandit\b' src/cli/doctor.ts` is now `0`, so the old assertion would be red at this tree.

## Why the JSON contract is byte-identical

The deleted preimage always succeeded for every key the writer can produce, which is why no existing assertion moves.

`stableProjectKey` is `p${Math.abs(hash32(normalized)).toString(16)}` over an int32 accumulator, so the magnitude is in `[0, 0x80000000]`. `projectRootForStoredKey` rebuilt the magnitude's base-31 digits as char codes; re-hashing that string accumulates `h*31 + digit` with every prefix ≤ the magnitude, so it reproduces the magnitude exactly (including the `0x80000000` case, where `h |= 0` wraps to `-2147483648` and `Math.abs` brings it back). The synthesized string contains only code units `0..30`, none of which is `/`, `\`, or an uppercase letter, so `stableProjectKey`'s normalization is the identity on it. Round trip holds for all producible keys; the "cannot be mapped" scan error was unreachable in practice.

So the preimage was correct — and load-bearing on a coincidence. It was a second encoding of the key algorithm: any change to `hash32` (a real digest, a different multiplier) would have silently turned *every* project's bandit entry into a scan error and made `learned-state-inventory` fail on every host, with a message about doctor's internals rather than about the operator's state. That is the hazard the keyed reader removes.

Two behavioral deltas, both corrections, both pinned:

1. A well-formed stored key outside the producible magnitude range (`pffffffff`, e.g. from a future or foreign writer — the scan regex accepts it) used to produce a scan error and a `present but unclassified` entry, failing the check. It is now read by key and classified normally.
2. If `preferences.json` disappeared between doctor's `stat` and the read, the old path reported `readable` (the binder's `existsSync` guard returned silently and doctor pushed `"readable"` regardless). It now reports `absent`.

Neither is reachable from the shipped writers, so `command-error-doctor.test.ts`'s route assertions and every R6-4 pin are untouched.

## Tests

Two pins added to `test/unit/cli/doctor.test.ts`, both verified to be genuine discriminators by restoring `git show HEAD:src/cli/doctor.ts` in place, running them, and restoring the new file (byte-compared after; no scratch file left):

- *"doctor inventories a stored project key it could not have hashed back to a root"* — a damaged `bandit.json` under `pffffffff`: `scanErrors: []`, entry `damaged` with the learned remediation, `learned-state-inventory` ok, bytes unchanged. Baseline: **fail**.
- *"doctor inventories preferences without adopting them into the process store"* — with the store deliberately unbound and holding one in-process observation, doctor over a valid snapshot carrying `pref_planted` + a tombstone must leave `listObservations()` at exactly the in-process id, `isTombstoned("pref_gone") === false`, and the store still unbound (a later `recordPreference` does not land on the file). Baseline: **fail** (`listObservations()` returns `pref_planted`), which is the bind this slot deleted.

## Verification

All on this VM, Node v22.14.0, at `a28e2b5` plus the shared tree's in-flight R7 edits.

- `npx tsc --noEmit` (whole tree): exit 0.
- `npx eslint` scoped to the five owned files: exit 0.
- **`test/unit/routing/live-isolation.test.ts`: 8/8 pass** — run as required, since this diff changes imports inside the live closure (`doctor.ts`'s import lists for `bandit-store` and `preferences/store`). Ran green 3× as part of the owned-test repetition.
- Owned suites 3×: `doctor.test.ts` + `live-isolation.test.ts` = 25 tests, 25 pass, 0 fail, 0 skipped on each of three runs.
- Consumer suites, one run each, all green: `bandit-store.test.ts`, `bandit-store-atomic.test.ts`, `auto-loop.test.ts`, `preferences/persistence-atomic.test.ts`, `preferences/preferences.test.ts`, `preferences/deletion-replay.test.ts`, `privacy/deletion.test.ts`, `track/clarify-plan.test.ts` — 95 tests, 95 pass. `integration/cli/command-error-doctor.test.ts`, `integration/m4/preferences-cli.test.ts`, `integration/m3/redaction.test.ts` — 18 tests, 18 pass.
- No full gate (parent's job). No new skips introduced.
- Not run: `scripts/crash-probe.mjs`. It imports `doctorCommand` for lock inventory only; `doctorCommand`'s signature, the `locks` inventory, and every check name are untouched, and `learnedStateInventory` gained no new throw path.

## Frozen contracts respected

`learnedState` field names, `stateClass`/`status` ranges, entry order, `advisory`, `scanErrors`, remediation strings, check names and order, and JSON key order all unchanged. `DOCTOR_ROUTED_NEXT` untouched (R7-5/R7-10 own it). `BANDIT_STATE_UNREADABLE` / `PREFERENCE_SNAPSHOT_UNREADABLE` codes, classes, messages, and fail-closed postures untouched. No new persisted schema, no writes added anywhere, no `package.json` edit, no ADR touched, no `git checkout`, no commit.

## For the reviewer

- The one signed-off guard I amended is the `assert.match` in `live-isolation.test.ts` plus its docstring bullet. Parent sign-off is recorded in `OWNERSHIP.md` §"Parent sign-off" for R7-8.
- Three exports added, all with a live caller (R6-9's absence-pin discipline): `projectBanditPath`, `loadProjectBanditByKey`, `readPreferenceSnapshot`, all consumed by `doctor.ts`. `PreferenceSnapshot` is exported as the reader's return type.
- `loadProjectBandit` (root-keyed) survives with three test callers and no `src/` caller. It is the natural symbol for the adaptation loop; if a future census wants it gone, the keyed reader plus `stableProjectKey` is the replacement, but deleting it is not this slot's call.

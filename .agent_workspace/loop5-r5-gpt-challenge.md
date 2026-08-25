# Loop 5 · Round 5 — GPT independent ranking challenge

Analysis only. Verified at fetched `origin/cursor/pi-sparkle-sota-opt-0da8`
`2f44bbe741da10f6103e60e4d23ef235ba063053`; Fable ranked at `c4e3e63`.
D19 is present (`ca47752` + `ad8f42a`, merged by `e0781c8`).

PR #12 was re-read live at head `5c6376c` (OPEN). Its source files are
`adaptation/eval-routing.ts`, `cli/adapt.ts`, `cli/inspect-format.ts`,
`cli/main.ts`, `feedback/redaction.ts`, `pi-adapter/runtime.ts`,
`run/flowchart-run.ts`, and `run/inspection.ts`. None of the corrected batches
below writes those files. None writes the D19-owned
`privacy/eval-dataset-path.ts`, `learning/eval-dataset.ts`, or
`privacy/deletion.ts`.

## D20 — FIX

The pain is real and the batch remains rank 1, but two prescribed remedies do
not meet its own “claim only what happened” standard.

- `commits apply` really does create one `--allow-empty` commit per proposal
  and return immediately on the first failed `git commit`
  (`src/cli/commits.ts:193-196`). A rerun can duplicate the successful prefix.
  The count disclosure is high value.
- `--nodes` is not a universally valid recovery instruction:
  - Flowchart node ids are only required to be non-empty
    (`src/domain/flowchart.ts:359-363`), so a valid id may contain a comma.
    `parseCommitNodeIdsCsv` splits on commas; that id cannot round-trip through
    the proposed command.
  - An accepted `--file` may contain an unknown `nodeId`, or multiple proposals
    with the same `nodeId`; `parseDecisionCommitFile` requires only a non-empty
    id. Applying the file without `--nodes` accepts both shapes. Adding the
    suggested filter rejects the unknown id against the checkpoint, while a
    duplicate id selects both the already-created and remaining proposal and
    can duplicate the prefix again.
  - Do not “fix” this by narrowing valid flowchart ids or edited commit files;
    that would break accepted inputs. Existing tests pin unknown-id rejection
    when `--nodes` is actually requested.
- Always disclose the successful count and failed/remaining proposal ids.
  Recommend `--nodes` only for generated proposals whose remaining ids
  round-trip through the CSV grammar. For `--file`, tell the operator to write
  the uncommitted suffix as a new `{ "commits": [...] }` file and rerun the
  same apply command with that suffix; do not print a command that can replay
  the prefix.
- The proposed `pause.token()`-then-`clearPause()` probe is also a TOCTOU
  observation around an intentionally unlocked unlink. A concurrent pause can
  be removed after the probe while the CLI says “nothing to clear.” Have the
  unlink path report whether it actually removed a file and base the message
  on that result. No malformed-token special case is needed: if the unlink
  removed it, “cleared” is true. Avoid changing every `PauseController` mock
  merely for this CLI result; a narrow result-bearing helper in
  `pause-controller.ts` is enough.

The other riders are correct and freeze-safe: both JSONL readers expose
`recovery`, the shared stderr warning leaves `COMMITS_PREVIEW` stdout intact,
`episode close --json` is currently silently ignored, and the doctor/Event/
`RunStatus` contracts are untouched. Corrected source footprint:
`cli/{commits,episode,pause,errors}.ts` plus
`run/pause-controller.ts`; still disjoint from #12 and D19.

## D21 — FIX

Keep the slot, but correct the authentication claim and the G4 count.

- The keyless-custom `--key` guard is substantively right without editing
  `runtime.ts`. Its resolver returns `{ auth: {}, source: "<id> (no key)" }`
  without consulting the credential argument
  (`src/pi-adapter/runtime.ts:104-111`). Pi 0.84.3 reads a stored credential
  first, but then passes it to that resolver; therefore a key written by
  `auth login --key` is ignored at request time. Interactive API-key and OAuth
  login already fail because this provider advertises no login function, so
  guarding those modes is useful error normalization rather than a storage
  safety fix.
- The proposed message is false in one supported path. `main.ts:228-235`
  forwards `PI_API_KEY`, and `PiAgentExecutor` supplies it as the request
  `apiKey` for the selected default provider (`pi-executor.ts:551-555`).
  Pi request options then take that explicit key over resolved auth. A keyless
  custom request can therefore carry a key, just never the one stored in
  `auth.json`.
- Say: `this custom provider has no envVar, so its request resolver ignores
  auth.json; auth login cannot configure it. Add envVar to providers.json and
  use that variable or stored login, or use the per-run PI_API_KEY compatibility
  override for the selected default provider.` Do not say requests are always
  keyless, and do not advise “remove the flag”: removing `--key` merely enters
  the interactive path that the same guard refuses.
- The report says “six” raw argument-error sites but specifies five:
  auth login/logout and models enable/disable/set-default. There are seven raw
  sites if the two unknown-subcommand branches are included. Either accurately
  convert the five missing-argument sites, or convert all seven; do not claim
  six.

F9 and F13 remain real: `disableModel` silently drops matching primary/fast
defaults, and clean `auth status --all` can print nothing. For the source label,
classify a custom environment source by equality with its configured `envVar`
(not uppercase spelling alone); retain `ambient` for keyless/file/profile
sources. The `auth.ts`/`models.ts` source and unit-test footprint is
freeze-safe and file-disjoint. PR #12 changes `runtime.ts`, but its custom
keyless resolver is unchanged, so this guard does not require taking that file.

## D22 — FIX

Storage visibility is real operator pain and an additive doctor field/check is
freeze-safe, but the proposed inventory would be incomplete and its Windows
test plan is not yet hermetic.

- The enumerated paths omit durable state that can grow:
  `runtime/routing/catalog-observed.json`,
  `adaptation/registry.json`, and
  `adaptation/learning/projects/**/{routing,bandit}.json`. It also names
  `preferences`, while the shipped path is
  `adaptation/preferences.json`. Consequently its advertised per-plane totals
  can be wrong.
- Inventory the immediate entries under both authoritative plane roots and
  recursively total each entry. This covers current and future record classes
  without a second hand-maintained path dictionary. Report regular-file
  logical bytes and file counts; call them logical bytes, not physical disk
  allocation.
- `lstat` before recursion is enough to avoid following a stable, pre-existing
  link. It is not a D19-style identity guarantee: a directory can be replaced
  between `lstat` and `readdir`, and Node's path-based walk has no portable
  fd-relative no-follow recursion. This read-only diagnostic may be documented
  as a best-effort snapshot, but must not claim race-proof “never follows.”
  Count/describe a link without descending into it.
- The proposed unreadable-directory test is not Windows-hermetic. POSIX mode
  bits do not provide the same failure on Windows (and can also be ineffective
  under privileged runners). Exercise `scanErrors` through an injected
  filesystem seam or a deterministic cross-platform wrong-node fixture.
  Attempt the directory-link/junction case and skip it only on a capability
  error. `doctor.test.ts` is explicitly run on `windows-latest`.

Keep `storage` and the appended `storage` check, update the additive contract
pins, and keep it read-only. Corrected files remain `src/cli/doctor.ts` and
`test/unit/cli/doctor.test.ts`, disjoint from #12 and D19.

## Verdicts

| Slot | Verdict | Action |
|---|---|---|
| D20 | **FIX** | Keep rank 1; make partial-apply recovery valid for CSV-hostile and edited-file proposals, and base pause-clear wording on the unlink result. |
| D21 | **FIX** | Keep rank 2; guard storage that runtime ignores, but acknowledge `PI_API_KEY`, fix the remedy text, and correct the five/seven-site G4 scope. |
| D22 | **FIX** | Keep rank 3; inventory complete plane roots, qualify lstat's race boundary, and replace the non-hermetic unreadable-directory test. |

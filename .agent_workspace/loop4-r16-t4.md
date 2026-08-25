[Model: claude-opus-5-fast]

# Loop 4 · Round 16 · slot R16-4 — a crashed `migrate-legacy --apply` is now re-runnable

Sub-agent: opus-fast, on `agent/opt-continuous` at HEAD `9e59e43` (no checkout, no commit, no push — parent lands this). Mandate: ROUND16-BRIEF §4 R16-4 with parent sign-off **YES on fix shape (a)** and **NO 12th crash-probe case**. `scripts/crash-probe.mjs` and the eleven-case pin in `test/integration/persist/crash-recovery.test.ts` were not touched.

## 1. Census (against the working tree, before editing)

| Question | Answer at HEAD |
|---|---|
| Owned paths exist? | `src/cli/migrate-legacy.ts` (291 lines), `test/unit/cli/migrate-legacy.test.ts` (11 tests / 4 suites), `test/integration/cli/migrate-legacy.test.ts` (2 tests) — all three present. |
| Callers of `migrateLegacyCommand` | Exactly two: `src/cli/main.ts:2083` (`case "migrate-legacy"`, two arguments) and the unit test. The new third parameter is optional, so `main.ts` needs no edit and I made none. |
| Callers of `planLegacyMigration` | Unit test only. Signature unchanged. |
| Who could trip over a leftover `*.tmp` in a plane directory | Swept every `readdir`/`readdirSync` in `src/**`: `doctor.ts` (lock inventory — matches `*.lock`), `doctor-overlay.ts` (`.json` filter), `auto-loop.ts` (`.json` filter), `deletion.ts` (run subtree, removed wholesale by `rm -rf` before `verifyRunRecordsRemoved` runs), `dispatch-preflight.ts` (`.md`), `pi-compat/check.ts` (adapter sources), and `migrate-legacy`'s own `listFiles`, which only walks the four legacy entries at the state root and never the plane directories. A `<destination>.<pid>.<uuid>.tmp` matches none of those filters. |
| Docs that describe this command | `docs/status-matrix.md` row (dry-run default, copies/never moves/deletes/overwrites, corrupt non-tail JSONL refused), `README.md:172`. Every claim in both stays true — the landing adds a guarantee, retracts none — so no census note is owed under the terminator, and I prescribe no doc edit. `docs/data-dictionary.md` belongs to R16-1 this round. |
| Baseline | Owned suites green before any edit: **13 / 13** (11 unit + 2 integration). |

## 2. The defect, reproduced out-of-tree at HEAD

Real repository code, a scratch copy of the tree under `/tmp` with `node_modules` symlinked, deleted afterwards. Seeded a three-line legacy `feedback/records.jsonl` and left the destination holding a prefix of it — exactly what a kill mid-`copyFile` leaves:

```
re-run 1: exit=1   conflict: feedback/records.jsonl -> adaptation/feedback/records.jsonl (destination differs; not overwritten)
re-run 2: exit=1   (identical)
re-run 3: exit=1   (identical)
next: compare the reported destinations by hand; migrate-legacy never overwrites an existing plane file
destination still partial: "{...fbk_1...}\n{\"id\":\"fbk_1"
```

And the partial destination is not a simulation artefact. A real `SIGKILL` delivered to a real `pi-sparkle migrate-legacy --apply` child, at the instant the copy started, left the destination holding **11,022,336 / 4,149,248 / 3,604,480 bytes** of a 21,480,000-byte source across three runs. Fail-closed and source-preserving, but permanently unrecoverable in-band.

## 3. What landed — fix shape (a), atomic never-overwrite publish

`src/cli/migrate-legacy.ts`, +100 lines net. The apply loop's `mkdir` + `copyFile(source, destination, COPYFILE_EXCL)` becomes one call to a new `publishCopy`:

1. `mkdir` the destination directory.
2. `copyFile(source, <destination>.<pid>.<uuid>.tmp, COPYFILE_EXCL)` — the temp lives beside the destination; `COPYFILE_EXCL` means a temp left by a crashed apply is refused, never adopted or truncated, and the name is retried (3 attempts, mirroring `atomic-file.ts`).
3. fsync the staged bytes (`open(tempPath, "r+")` → `handle.sync()`).
4. `link(temp, destination)` — the publish. `link` fails `EEXIST` instead of clobbering, so **never-overwrite is now enforced by the kernel at the instant of publish** rather than by the earlier `stat` in `destinationStatus`.
5. `unlink` the temp in a `finally`, on every path including failure.

The caller's `catch` is unchanged in shape: `EEXIST` still falls through to the existing `sameContent` digest comparison, so a destination that appeared mid-run is `already migrated` when it matches and a reported failure when it does not. Temp-name exhaustion deliberately throws an error **without** an `EEXIST` code, so `EEXIST` continues to mean one thing only to the caller ("the destination is already there") and the digest branch can never be entered with an absent destination.

Two deliberate details:

- **Hard-link fallback.** `EPERM`/`EOPNOTSUPP`/`ENOTSUP`/`ENOSYS` from `link` (mounts and filesystems without hard links) fall back to `copyFile(temp, destination, COPYFILE_EXCL)`. Never-overwrite still holds there; the crash window comes back, and the comment says so. `EEXIST` is not in that set.
- **No new private tmp+rename primitive.** This is a copy/link publish of opaque bytes, not a JSON artefact write; `writeFileAtomic` is untouched and unbypassed, and nothing here renames over a destination. No lock is taken or stolen.

Message work, allowed inside (a): the `--help` text now states that an interrupted `--apply` leaves no half-written destination, that files are staged as `*.tmp` beside the destination, and that a leftover `*.tmp` is inert and safe to delete. I did **not** add "an interrupted apply" to the `conflict:` line — after this landing that is no longer a cause of a conflict, and saying so would be false going forward. The `conflict:`, `copied:`, `already migrated:`, `summary:` and `next:` strings are byte-identical to HEAD.

## 4. Tests

`test/unit/cli/migrate-legacy.test.ts` gains a `migrate-legacy publishes atomically` suite (8 tests, 11 → 19). The publish seam is exercised through a new exported `MigrateLegacyOptions` (`link`, `uniqueSuffix`), the same injection-seam shape `AtomicWriteOptions` already uses:

- stages the whole file beside the destination before publishing it — the seam asserts, mid-flight, that the temp already holds every byte and the destination does not yet exist; the temp name is `<destination>.<pid>.fixed.tmp` and is gone afterwards;
- leaves no destination when the publish is interrupted — `link` throws (the kill point); destination absent, source intact, exit 1;
- re-runs cleanly after an interrupted apply instead of conflicting forever — the defect, closed: exit 0, `1 copied`, no `conflict:`;
- ignores a temp left behind by a killed apply — an orphan `*.tmp` is planned as neither source nor destination, the re-run publishes correctly, and the orphan is left inert rather than adopted;
- refuses to adopt a temp name that is already taken — collides all three attempts, fails with `no free temp name beside …`, publishes nothing, leaves the other file's bytes untruncated;
- falls back to an exclusive copy where the filesystem cannot hard-link — `EPERM` from `link`, file still published, temp cleaned;
- the two mid-apply race tests (matching bytes → `already migrated`; different bytes → fails closed, destination keeps the racer's bytes). These race through the `uniqueSuffix` hook, which fires after the plan and before the publish, deliberately leaving the **real** `link` in the path — that is what makes them detect a regression to overwriting semantics.

`test/integration/cli/migrate-legacy.test.ts` gains 2 tests (2 → 4), both through `main()` with no seams:

- **a real `SIGKILL`**: spawns `src/cli/main.ts migrate-legacy --apply` against a 21 MB legacy source, polls the pre-created (empty) plane directory synchronously and kills the child the instant anything appears in it, then asserts the invariant at the instant of the kill and again after it — the destination is absent, or it is the whole file, never a prefix — and that the re-run exits 0 with no `conflict:`. Verified non-vacuous: against the pre-fix source this test fails 3/3 with `a destination is never half-written` (it observed 110 KB and 458 KB of the 21 MB source under the old write);
- a staging temp left by a killed apply does not block the CLI re-run: `EventStore` reads the migrated run, the orphan temp remains and this run's own temp does not.

Untouched, still green, exactly as required: conflict semantics for a genuinely divergent pre-existing destination (`never overwrites a destination that already holds different content` — that path never reaches the publish, it is classified `conflict` at plan time), the corrupt-middle refusal, and the truncated-tail warning with its byte-for-byte copy assertion.

**Owned tests, 3× on the final tree:** 23 / 23 pass, 0 fail, three consecutive runs (1772 ms / 1793 ms / 1725 ms). An earlier 3× at the same code, before other slots' edits reached the tree, was also 23 / 23.

**Mutation testing** (out-of-tree copy, mutants applied to `src/cli/migrate-legacy.ts`, tree deleted afterwards) — 6 of 8 killed:

| Mutant | Result |
|---|---|
| `link` → `rename` (overwrite instead of never-overwrite) | KILLED (both mid-apply race tests) |
| temp copy without `COPYFILE_EXCL` (adopts a stale temp) | KILLED |
| temp never unlinked | KILLED (3 tests) |
| revert: publish straight to the destination | KILLED (3 tests, incl. the integration kill) |
| non-unique temp name | KILLED (3 tests) |
| drop the benign-race digest check | KILLED |
| no fsync of the staged bytes | SURVIVED — durability only; not observable without power loss. `writeFileAtomic`'s own fsync carries the same untested status, so this is the codebase's existing standard, not a new gap. |
| `EEXIST` added to `LINK_UNSUPPORTED_CODES` | SURVIVED — equivalent mutant: the fallback `copyFile(temp, destination, COPYFILE_EXCL)` raises `EEXIST` too, so the caller's digest branch runs identically. |

The first mutant is the one worth noting: it survived my first draft, because the race tests injected the `link` seam and therefore never ran the real `link`. Rewriting them to race through `uniqueSuffix` is what makes them a never-overwrite regression detector.

## 5. Gates

- `npx eslint src/cli/migrate-legacy.ts test/unit/cli/migrate-legacy.test.ts test/integration/cli/migrate-legacy.test.ts` → exit 0, no output.
- `npx tsc --noEmit` (whole tree, so it also covers the other slots' in-flight edits present in the working tree) → exit 0.
- Neighbour/consumer sweep, one batch: `test/integration/persist/crash-recovery.test.ts` (the frozen 11-case probe pin), `test/integration/cli/cli.test.ts`, `test/integration/cli/commands.test.ts`, `test/integration/cli/delete.test.ts`, `test/unit/cli/doctor.test.ts`, `test/unit/persist/atomic-file.test.ts` → **82 / 82 pass**. The crash-probe verdict and its eleven case names are untouched.
- No full gate (parent's job). No scratch files in the tree at report time (`git status` shows only the four slots' owned files); every mutation and proof ran in `/tmp`, now deleted.

## 6. Residuals and honest bounds

- **fsync is unproven by test.** Both the staged bytes' fsync and the absence of a directory fsync are durability properties this suite cannot observe. `link` is atomic within a filesystem, so no reader can see a partial destination regardless; what is not guaranteed is that a published destination survives a power loss, and `writeFileAtomic` has exactly the same bound.
- **The hard-link fallback reopens the crash window on filesystems without hard links.** Never-overwrite still holds there. Nothing in this repo's supported environments hits it, and the source comment states the trade-off rather than hiding it.
- **A crashed apply leaves an orphan `*.tmp` that nothing sweeps.** Deliberate: temp names embed a pid but liveness is not checked, and deleting another process's in-flight temp would be a worse bug than leaving an inert file. The orphan is invisible to every reader censused in §1, is removed with the subtree by `delete --run`, and `--help` now tells the operator it is safe to delete. A sweeper is a possible future slot, not this one.
- **The real-`SIGKILL` integration test costs ~850 ms** (a 21 MB source and a child process). That is the price of proving the invariant against a real kill rather than a thrown error; it is deterministic in both directions (3/3 pass here, 3/3 fail pre-fix).
- **No 12th crash-probe case**, per the parent's sign-off. The window is covered by the owned unit seam tests plus the real-kill integration test.
- **Not touched:** `scripts/crash-probe.mjs`, `src/cli/main.ts`, `writeFileAtomic`/`writeFileAtomicSync`, any lock, any doc. No `RunStatus` contact, no schema change, no new CLI flag.

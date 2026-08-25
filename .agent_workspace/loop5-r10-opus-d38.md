# Loop 5 · Round 10 · D38 — `init` and `migrate-legacy` stop half-writing and mis-blaming their target

Slot: Opus-d38-init-migrate (rank 2 implementer). Branch `cursor/init-migrate-target-0da8`, based
on `origin/cursor/pi-sparkle-sota-opt-0da8` at `be4c7a9`
(`docs(agent): record GPT-r10 FIX riders for D37–D39`) — the tip at dispatch, and it contains the
required `be4c7a9`. Not merged to the integration branch; the parent merges.

Spec implemented: `.agent_workspace/loop5-r10-fable-next.md` Rank 2 (D38) **as corrected by
`.agent_workspace/loop5-r10-gpt-challenge.md` D38 FIX**, which is binding wherever the two differ.
The one place they differ is item 4 — the partial-write test cannot be driven by Fable's squat
fixture — and that correction is implemented as GPT specified, with a `writeFile` seam. See §4.

## Files changed

- `src/cli/init-examples.ts` — blank `--dir` guard, `lstat` obstruction preflight, narrow
  `mkdir`/write try with partial-write disclosure, and the new `InitExamplesOptions.writeFile` seam.
- `src/cli/migrate-legacy.ts` — blank `--state-root` guard, and coded-vs-uncoded classification
  inside the existing scan catch.
- `test/unit/cli/init-examples.test.ts` — new tests, 11 → 20 as the runner counts them.
- `test/unit/cli/migrate-legacy.test.ts` — new tests, 22 → 28.
- `test/integration/cli/migrate-legacy.test.ts` — new tests, 4 → 6.
- `.agent_workspace/loop5-r10-opus-d38.md` — this report.

Nothing else was touched: `git diff --stat` against the base names exactly those five code files.
`src/cli/main.ts`, `src/cli/errors.ts`, the D37/D39 files, `package.json`, the two example JSON
constants and the `INIT_EXAMPLES` keys are byte-identical to the base branch.

## 1. `init`: blank `--dir` → `parse-args`, before anything is resolved

Live at base, `init --dir ""` wrote both examples into the cwd and exited 0, and `init --dir " "`
created a directory literally named `" "` and then printed a `validate --children` line that splits
into two argv words when pasted. The guard is the first thing after `parseArgs`, ahead of `resolve`,
target construction and every `lstat`:

```
command: init
stage:   parse-args
message: invalid --dir "": directory must be a non-empty path
next:    pass --dir <path> or omit it to write into the current directory
```

`values.dir !== undefined && values.dir.trim() === ""` is the test, so `" "` refuses with its own raw
value quoted in the message. Omitting `--dir` still writes into the current directory — that is the
documented default and it is unchanged; a nonblank relative path is still an ordinary path, pinned
by a test that passes `<tmp>/./nested` and reads the file back.

## 2. `init`: obstruction preflight, `--force` included

Both targets are `lstat`ed before `mkdir` and before either write. `lstat`, not `existsSync`: a
symlink or a directory under a target name has to be judged here rather than throw an errno out of
the write loop with the other file already on disk.

```
command: init
stage:   preflight
message: cannot write <target path>: it exists and is not a regular file
next:    move it aside; init writes sparkle-children.example.json and sparkle-flowchart.example.json as regular files, and --force only overwrites regular files
```

`--force` does not buy an override. That is the whole point: at base, the no-`--force` answer to a
directory squatting the flowchart name was `… already exists` with `re-run with --force to
overwrite`, and following that remedy wrote the children example and then threw `EISDIR` on the
flowchart through `main.ts`'s catch, leaving a fresh 551-byte file nobody disclosed.

The existing regular-file pin still fires and keeps every byte (`init-examples.test.ts` ~123–125):
for a regular existing target without `--force`, `stage: "execute"`, `<path> already exists`,
`next: "re-run with --force to overwrite"`. Precedence is obstruction-first regardless of which
target is obstructed — a regular children file next to a squatted flowchart name reports the
obstruction, not `already exists`, and a test pins that.

An `lstat` that fails for any other reason (the `ENOTDIR` fixture below) is deliberately not
classified here; it falls through to the write loop, which reports the target directory as a whole.

## 3. `init`: write faults name the flag and disclose the work that happened

`mkdir` plus the write loop sit in one narrow try — nothing wider, and the JSON and human success
paths are untouched.

```
command: init
stage:   execute
message: cannot write into --dir <resolved dir>: <thrown message>
next:    check the --dir path is a writable directory
```

The resolved `dir` is in the `message` only. Per GPT item 5 that is acceptable — it identifies the
target that failed and the JSON report escapes it — while the `next` stays path-free, which is what
the D34 rider governs.

A target joins `written` **only after its own `writeFile` resolves**, so the disclosure can never
name the file that failed. When that list is nonempty, `note: wrote <paths> before the failure` goes
to stderr immediately before `cliFail`; when it is empty, no note is printed at all.

## 4. The GPT `writeFile` seam (the correction to Fable)

Fable proposed proving the partial-write disclosure "via the squat fixture ordered after one
successful write". GPT's challenge is right that this is now impossible: the §2 `lstat` preflight
necessarily refuses that fixture **before** the write loop runs, so one fixture cannot both prove
zero writes and drive a failure after a successful write. The two claims need two tests.

So `InitExamplesOptions` gains an optional `writeFile`, defaulting to the real
`fs/promises.writeFile`, exactly analogous to the existing `MigrateLegacyOptions.link` /
`uniqueSuffix` publish seams in the sibling module:

```ts
export interface InitExamplesOptions {
  readonly writeFile?: (path: string, body: string) => Promise<void>;
}
```

`initExamplesCommand(args, io, options = {})` — the third parameter has a default, so
`main.ts`'s existing `initExamplesCommand(rest, io)` call site compiles and behaves unchanged, and
`main.ts` was not edited. No JSON key was invented: the seam is a TypeScript parameter, not part of
any machine surface, and `INIT_EXAMPLES` is byte-identical.

The real squat fixture then owns the preflight-and-zero-writes claim, and the seam owns the
disclosure claim.

## 5. `migrate-legacy`: blank root, and classifying the scan catch

Blank `--state-root` is refused before `planLegacyMigration`, in D37's exact dialect with this
module's command name:

```
command: migrate-legacy
stage:   parse-args
message: invalid --state-root "": state root must be a non-empty directory path
next:    pass --state-root <dir> or omit it to use the default ~/.pi-sparkle
```

At base, `--state-root "" --apply` from a cwd holding `feedback/records.jsonl` printed
`state root: ` (blank), copied into `<cwd>/adaptation/feedback/records.jsonl`, and exited 0 — a
migration of a tree the operator never named, reported as a clean success. A verb that copies files
must not resolve its source from the cwd.

Inside the existing scan catch (no new catch, none widened), a **string** `errorCodeOf(error)` — the
filesystem answering about the root itself — becomes:

```
command: migrate-legacy
stage:   lookup
message: cannot scan --state-root <stateRoot>: <thrown message>
next:    check the --state-root path; it must be the flat pre-2026-08-22 state directory
```

Everything uncoded keeps today's report byte-for-byte. That is the fault the catch was written for:
`validateJsonl` throws a plain `Error` with no `code`, so corrupt JSONL still reports
`stage: "scan"`, `corrupt legacy JSONL at feedback/records.jsonl line 2`, and `repair or remove the
unreadable legacy file, then re-run migrate-legacy`. A nonexistent root keeps its honest empty dry
run (`listFiles` maps ENOENT to `[]`) — `no legacy files found`, exit 0.

## 6. Tests

`test/unit/cli/init-examples.test.ts` (11 → 20):

- blank `--dir` `""` and `" "` — whole-field `deepEqual` on the entire report object, stdout empty,
  and an assertion that neither the cwd nor a `" "` directory gained anything;
- nonblank relative `--dir` still accepted;
- directory squatting the flowchart name, with and without `--force` — whole-field pins plus the
  ls-equivalent: `readdir(dir)` is exactly `[sparkle-flowchart.example.json]` and the squat itself is
  empty, i.e. **zero fresh files**;
- obstruction beats `already exists` when the other target is a real file;
- write-fault envelope via the portable `ENOTDIR` fixture (`--dir <file>/sub`) — `stage: "execute"`,
  message starting `cannot write into --dir <target>: `, exact `next`, no `note:` line;
- **the seam test**: real first write, injected rejection on the second — whole-field pin on all four
  error fields, `note: wrote <children path> before the failure` asserted as the first bytes on
  stderr (so it precedes the refusal), the children file's bytes read back equal to
  `CHILDREN_EXAMPLE_JSON`, the flowchart file absent, and an explicit assertion that the rejected
  target is never listed as written;
- first-write-fails — no `note:` at all, and the directory is empty.

`test/unit/cli/migrate-legacy.test.ts` (22 → 28): blank root refused for both the dry run and
`--apply`, each executed from a cwd that really does hold a seeded legacy tree, asserting the whole
report and that neither plane directory was created; whitespace-only root; file-as-root pinned as
`stage: "lookup"` with `/^cannot scan --state-root /` (the errno text left free for Windows) and the
exact `next`; corrupt-JSONL whole-field pin proving the `scan` bytes did not move; nonexistent root
still exit 0.

`test/integration/cli/migrate-legacy.test.ts` (4 → 6): the same blank-root and file-as-root refusals
through `main(...)`, which is how the dispatcher wiring is proven without editing `main.ts`.

Untouched and passing: the `already exists` bytes, the `INIT_EXAMPLES` `--json` `deepEqual` and the
one-line compactness pin (D17), both USAGE pins, the examples/-vs-constants byte pin, the empty-scan
exit-0 pin, and the whole publish-seam suite.

## 7. Verification on this VM

`pnpm install --frozen-lockfile` clean; Node v22.14.0 (the expected `engines.node` warning).

```
$ npx tsx --test test/unit/cli/init-examples.test.ts \
    test/unit/cli/migrate-legacy.test.ts \
    test/integration/cli/migrate-legacy.test.ts
# tests 54 / # pass 54 / # fail 0

$ npx tsc --noEmit          # clean
$ npx eslint <the five changed files>   # clean
$ node scripts/run-tests.mjs
# tests 2352 / # pass 2351 / # fail 0 / # skipped 1
```

`test/unit/cli/main-dispatch.test.ts` and `test/integration/cli/commits.test.ts` are the only other
test files mentioning `init` or `migrate-legacy`; both pass unchanged.

Live probes through `src/cli/main.ts` on this VM confirmed each refusal end to end: blank and
whitespace `--dir`; the squatted flowchart name with `--force` (preflight, and `ls` shows only the
squat); `--dir <file>/sub` (`cannot write into --dir …: ENOTDIR …`); the unchanged `--json` success
line; `migrate-legacy --state-root "" --apply` from a seeded legacy cwd (parse-args, and no
`adaptation/` appears); a regular file as root (`lookup`); and `--state-root .` still scanning
normally.

## 8. Freeze / disjointness

- No live R1 or topology change, ADR-006 stays Proposed, no `INSPECT_SUMMARY`, no doctor JSON key or
  route, no `main.ts` edit, no new Event type, no D7 Variant B touch.
- No success JSON gains or loses a key: `INIT_EXAMPLES` keys, values and one-line compactness are
  byte-identical, every refusal fires before the object is assembled. `package.json` untouched.
- D20 is honored on the partial write: the refusal discloses exactly the files that were written and
  never one that was not. The D34 rider is honored: no operator path appears in any `next`.
- Files are disjoint from D37 (its seven verb modules and six tests) and D39 (`episode`), and from
  PR #12's live file list. `init-examples.ts` is reopened outside D17 (JSON shape) and D26 (argv
  dialect / `--help`); `migrate-legacy.ts` has no closed decision on failure classification.
- Operator-contract only: no auth, network, plane-routing or access-control change. `migrate-legacy`
  still copies and never deletes, still never overwrites a destination, and its publish protocol is
  untouched.

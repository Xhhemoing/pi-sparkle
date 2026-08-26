KEEP

# D38 landing recheck

Reviewed PR [#24](https://github.com/Xhhemoing/pi-sparkle/pull/24) at
`1268ea78ee1347c3b1111a175a9a0cf8b2ccc10e` against
`origin/cursor/pi-sparkle-sota-opt-0da8`.

- Explicitly blank `--dir` values (`""` and `" "`) have the specified
  `parse-args` report and path-free `next`; omission still writes to the cwd,
  and a nonblank relative path still works.
- `init` preflights both targets with `lstat` before `mkdir` or writing.
  Non-regular targets refuse at `preflight` even with `--force`, while the
  regular-file/no-`--force` `already exists` report keeps its prior bytes.
- The narrow execute catch names the resolved directory only in `message` and
  keeps `next` path-free. A target joins `written` only after its write
  resolves, the note is omitted for an empty list, and the rejected target is
  not reported as written.
- The real squat fixture pins preflight with zero fresh files. The separate
  injected-write test drives partial disclosure; its seam defaults to the real
  `writeFile`, and `main.ts` remains unchanged.
- Blank `migrate-legacy --state-root` uses D37's exact message and `next` with
  `command: "migrate-legacy"`. Coded filesystem faults are `lookup` with
  `cannot scan --state-root ...`; uncoded corrupt JSONL retains the exact
  `scan` report, and an absent root remains an exit-0 empty dry run.
- The diff is limited to the two implementation files, their three test files,
  and the implementer report. Example constants, `INIT_EXAMPLES` keys and
  compactness, `main.ts`, and every operator-remedy `next` contract remain
  unchanged. `git diff --check` is clean.

Verification from the isolated candidate worktree:

- `npx tsx --test test/unit/cli/init-examples.test.ts test/unit/cli/migrate-legacy.test.ts test/integration/cli/migrate-legacy.test.ts`
  — 54 passed, 0 failed.
- `npx tsc --noEmit` — passed.
- Live probes under `/tmp/r10-gpt-d38/**` confirmed both blank-`--dir`
  refusals, omitted and relative writes, the `--force` squat refusal with zero
  fresh files, unchanged regular-file refusal, the execute envelope, blank
  migration refusal with no plane writes, coded file-root lookup, unchanged
  corrupt-JSONL scan, and the missing-root exit-0 dry run.

The VM's Node 22.14.0 is below the declared `>=22.19.0` engine, but the locked
install, required tests, and typecheck completed successfully.

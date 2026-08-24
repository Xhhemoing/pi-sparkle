[Model: claude-opus-5-thinking-high-fast]

# Loop 4 · Round 1 — T3: atomic single-file writes (unique temp names, one shared helper)

MODEL_SLUG: claude-opus-5-thinking-high-fast

Role: close fable §1c — the fixed-`<file>.tmp` concurrent-torn-write hole and the
diverged checkpoint/pause atomic-write duplicates. No git commit, push, or PR
(per slot instructions).

Exclusive writes honored — exactly these six paths, nothing else:
`src/persist/atomic-file.ts` (new), `src/run/checkpoint-store.ts`,
`src/run/pause-controller.ts`, `test/unit/persist/atomic-file.test.ts` (new),
`test/unit/run/checkpoint-store.test.ts`, `test/unit/run/pause-controller.test.ts`,
plus this report. `src/persist/jsonl.ts` and `src/persist/file-lock.ts` untouched.

## The defect being closed

`CheckpointStore.write` (`checkpoint-store.ts:16-28` before this change) and
`writeAtomic` (`pause-controller.ts:25-44` before this change) both did
`open("<file>.tmp", "w")` → write → fsync → close → rename. The temp name was a
constant, so two concurrent writers to the same run's `checkpoint.json` shared one
temp inode: writer B's `open(..., "w")` **truncates the file writer A is still
writing**, and A's subsequent `rename` publishes a spliced file. The two copies had
also diverged — pause carried an EPERM/EEXIST/EACCES unlink-retry fallback,
checkpoint did not.

## Implemented

**`src/persist/atomic-file.ts` (new)** — one exported
`writeFileAtomic(path, contents, options?)`:

- temp path `<file>.<pid>.<random>.tmp`, matching the naming already used by
  `saveAdaptationRegistry` (`src/adaptation/promotion.ts:331`);
- opened with `"wx"`, never `"w"` — a temp left behind by a crashed writer (or a
  live one) is refused, never truncated or adopted. On `EEXIST` the helper retries
  with a fresh name (bounded, 3 attempts) instead of failing the write;
- `writeFile` + `sync` + `close`, then `rename`, with the EPERM/EEXIST/EACCES
  unlink-then-rename fallback promoted from pause-controller (now shared, so the
  checkpoint path gets it too);
- best-effort cleanup of **its own** temp on any failure path (`rm(force)` in a
  `finally`, guarded by a `published` flag so the success path does no extra I/O).
  Another writer's temp is never touched;
- callers own serialization: the bytes handed in are the bytes published.
- two injection seams (`options.rename`, `options.uniqueSuffix`) exist purely so the
  rename fallback and the name-collision retry can be exercised portably; both
  default to the real `fs.rename` / `randomUUID`, so production call sites use the
  plain two-argument form.

**`src/run/checkpoint-store.ts`** — `write` is now one line delegating to
`writeFileAtomic`; the private `mkdir`/`open`/`sync`/`rename` block is gone.
`read` is unchanged (ENOENT → `undefined`, parse errors propagate).

**`src/run/pause-controller.ts`** — the private `writeAtomic` function is deleted;
`requestPause` calls `writeFileAtomic` directly. `parsePauseToken`, `clearPause`,
and `token` are unchanged (absent → `{paused:false}`, malformed → fail closed).

Behavioral drop-in: both call sites still serialize with
`` `${JSON.stringify(value, null, 2)}\n` ``, so the published bytes — trailing
newline included — are byte-identical to before. Pinned by an exact-bytes assertion
in each of the two test files, not just a `deepEqual` on the parse.

## Tests

`test/unit/persist/atomic-file.test.ts` (new, 10 cases):

1. missing directories created; exact bytes published; no temp left behind on a
   fresh write or an overwrite;
2. **8 concurrent writers, ~400 KB payloads each**, with a reader loop running
   alongside: every state the reader observed is one writer's whole payload, the
   final file parses as JSON and its filler matches its own writer id (a splice
   would not), and no temp survives;
3. temp names unique per write and prefixed `<path>.<pid>.`;
4. pre-planted stale temps in **both** shapes — legacy fixed `stale.json.tmp` and
   new-style `stale.json.999999.abandoned.tmp` — neither corrupt nor block the next
   write, and are left byte-for-byte as found;
5. a temp name that collides with an existing file is retried with a fresh name; the
   occupied file is not truncated;
6. rename failing with `EPERM` / `EEXIST` / `EACCES` (three cases) takes the
   unlink-then-rename fallback and publishes correctly;
7. a rename failure outside that set (`EXDEV`) propagates, leaves the previous file
   intact, and cleans up its own temp;
8. a fallback rename that also fails still cleans up its own temp.

`test/unit/run/checkpoint-store.test.ts` — existing contracts kept
(write/read/overwrite, crash-before-rename preserves the previous resumable
checkpoint, partial temp ignored, corrupt checkpoint surfaces `SyntaxError`), plus a
new concurrent-writes case. Two assertions changed meaning deliberately: the old
tests asserted the *fixed* `checkpoint.json.tmp` was gone after the next write,
which was only true because the old writer reused and consumed that exact name. The
new writer never touches another writer's temp, so those cases now assert the
stronger property — the stranded temp is **inert**: still present with its original
bytes, never adopted, while the next write publishes its own document and leaves no
temp of its own.

`test/unit/run/pause-controller.test.ts` — existing contracts kept (absent →
`{paused:false}`, round-trip, replace-on-second-request incl. the Windows fallback
path, malformed fails closed), plus exact-bytes-on-disk, a concurrent
`requestPause` case, and a stale-temp (legacy + new-style) case.

Determinism: no `setTimeout`, no sleep-as-synchronization anywhere. The concurrency
tests synchronize on `Promise.all` alone; the reader loop is bounded by a flag set
in a `finally` (so a failing write ends the loop rather than hanging the suite) with
a trailing condition that guarantees at least one observation on the success path
without ever spinning when no file exists.

## Verification on this VM (Node v22.14.0, pnpm 10.17.1)

Commanded run — only the three owned test files:

```
pnpm test -- test/unit/persist/atomic-file.test.ts test/unit/run/checkpoint-store.test.ts test/unit/run/pause-controller.test.ts
# tests 21  # pass 21  # fail 0  # duration_ms ~215
```

Repeated 6× back-to-back: 21/21 every run, no flake. Lint clean on all six owned
files (`eslint`, exit 0). `tsc --noEmit` clean over a config scoped to the six owned
files and their transitive imports.

**Negative control** (temporarily reverting only the helper's temp naming to the old
fixed `<file>.tmp` + `"w"`, then restoring): **9 of the 21 tests fail**, including
both concurrency cases and all four stale-temp cases. The new tests are load-bearing
against the exact defect, not decorative. Source restored immediately afterwards and
re-verified (`open(tempPath, "wx")` with the unique name is what is on disk).

## Not run, and why

`pnpm test` (full) and `pnpm gate` were **not** run: the slot instruction restricts
this to the three owned files. For the record, a whole-tree `pnpm typecheck` at the
time of writing reports two errors in files owned by other concurrent slots
(`test/unit/episode/events-validate.test.ts` → T4,
`test/unit/protocol/v1.test.ts` → T8) — mid-flight work in the shared worktree,
neither in my ownership nor caused by this change; my scoped typecheck is clean. The
two documented `test/unit/cli/doctor.test.ts` host-Node baseline failures (T9) are
likewise untouched.

## Disclosures / follow-ups for other owners

- `docs/data-dictionary.md:181` describes the transient temp as literally
  `pause.json.tmp`. The classification statement (transient, no record class) still
  holds, but the literal name is now `pause.json.<pid>.<random>.tmp`. Docs are
  outside my ownership; flagging for whoever owns the data dictionary.
- Privacy is unaffected: `deleteRunFiles` removes the run directory recursively
  (`src/privacy/deletion.ts:130-133`), so temps of either naming style are deleted
  with the run. No new durable artifact class is introduced.
- T10's crash probe constraint is respected: nothing in the new helper's public
  contract depends on temp-file naming, and the probe's "stale temp must not break
  the next write" invariant is now stronger than before, not weaker.
- Scope discipline: no live R1/bandit/topology touched, nothing claimed
  Outcome-supported, ADR-006 untouched (stays Proposed), no auto-promote, no
  `package.json` dependency changes, no git history rewritten, no cosmetic-only
  edits. `appendJsonlLine` / `readJsonlObjects` / `withExclusiveFileLock` untouched.
- Honest metric framing: this is a **correctness / fail-closed** change. No
  performance claim is made and none was measured.

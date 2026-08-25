[Model: claude-opus-5]

# Loop 4 · Round 16 — slot R16-2 report

Slot: **R16-2 (P2)** — `EpisodeEventStore.append` validates before writing, mirroring `EventStore.append` (`validateEvent`) and `EpisodeStore.append` (`validateEpisode`).
Branch: `agent/opt-continuous`, working tree only. No `git checkout`, no commit, no push — the diff is left staged-free in the tree for the parent.
Injection read before any edit: `.agent_workspace/ROUND16-BRIEF.md` §4 R16-2, `.agent_workspace/loop4-r16-audit.md` §2 R16-2.

## 1. Census (against the working tree, before editing)

Tree state at slot start: `HEAD = 67f0391` ("chore(orchestrator): record Round 16 audit (4 real candidates)"), the only dirty path `.agent_workspace/PROGRESS.md` (parent bookkeeping). Both handed paths exist.

| Owned path | Before | Relevant content |
|---|---|---|
| `src/episode/store.ts` | 57 lines | `EpisodeEventStore.append` did `appendJsonlLine(this.path, JSON.stringify(event), false)` with **no validation**; `readAll` validates every row through `validateEpisodeEvent` and wraps failures with line context |
| `test/unit/episode/store.test.ts` | 140 lines, 6 tests | All six are read-side: round-trip, missing log, unknown-type row, malformed field, corrupt mid-file line, truncated tail. **No write-side test in either direction** — matches the audit's "no test pins the asymmetry" |

Siblings I mirrored (read-only, not edited): `src/run/event-store.ts:103-117` and `src/run/episode-store.ts:28-42`. Both do exactly `const validated = validate…(x); await appendJsonlLine(path, JSON.stringify(validated), …)` — i.e. both validate **and write the decoder's output**, not the caller's object. Both additionally check the id against the store's own id; that check is **deliberately not** copied here (see §2, out-of-scope note).

Consumer census — every caller of `EpisodeEventStore.append` in the tree, each checked for whether the fix can reject it:

| Caller | Event source | Verdict |
|---|---|---|
| `src/run/episode-bind.ts:88,89` | `openEpisode` / `attachRun` events | valid by construction |
| `src/run/episode-bind.ts:186,~205` (`settleLockedEpisode`) | `waitForUser` / `closeEpisode` events | valid by construction |
| `src/cli/episode.ts:110,~130` (`episode close`) | `waitForUser` / `closeEpisode` events | valid by construction |
| `scripts/crash-probe.mjs:992` | manager-produced events | valid; probe re-run green, §4 |
| `test/integration/cli/delete.test.ts:100` | inline `EPISODE_OPENED` over `episodeFixture` | valid — the same fixture already passes `EpisodeStore.append`'s `validateEpisode` on line 99 |
| `test/integration/m3/episode-cli.test.ts:37`, `episode-reducer-store.test.ts:23,57`, `checkpoint-d.test.ts:79`, `test/unit/run/episode-bind.test.ts:252,308` | manager-produced events | valid by construction |

No consumer needs a change, and none is owed a doc update: the fix adds a rejection on input no in-tree caller can produce, and changes no schema, no status, no CLI surface, no lock inventory. **No census note is owed** — nothing that the three runtime surfaces (`docs/status-matrix.md`, `docs/specs/m0-m2-architecture.md`, `docs/data-dictionary.md`) describe changed. Per the terminator this is the correct outcome, not an omission.

## 2. Diff

Two files, `+114 / -2`. `git diff --stat -- src/episode/store.ts test/unit/episode/store.test.ts`:

```
 src/episode/store.ts            | 20 ++++++++-
 test/unit/episode/store.test.ts | 96 ++++++++++++++++++++++++++++++++++++++++-
 2 files changed, 114 insertions(+), 2 deletions(-)
```

### `src/episode/store.ts` — the whole behavioural change

```
   append(event: EpisodeEvent): Promise<void> {
     return this.enqueue(async () => {
-      await appendJsonlLine(this.path, JSON.stringify(event), false);
+      const validated = validateEpisodeEvent(event);
+      await appendJsonlLine(this.path, JSON.stringify(validated), false);
     });
   }
```

plus a docstring on `append` recording why the write side validates (reader fails closed on the first bad row + append-only + rewrites out of contract ⇒ one bad row ends the episode's history permanently; the static type is erased and the class is an exported embedder surface) and why the rejection carries no line context (nothing was written, so there is no line to name). `validateEpisodeEvent` was already imported for `readAll`; no new import, no signature change, no new export.

Three deliberate scope decisions, each stated so the parent can overrule cheaply:

- **The row that lands is `validated`, not `event`** — this is what both siblings do, and it strips unknown keys before they reach a privacy-scoped log. It is byte-neutral for every real caller: `validateEpisodeEvent` and `validateEpisode` emit keys in exactly the order `src/episode/manager.ts` builds them, so `JSON.stringify(validated) === JSON.stringify(event)` for manager-produced events. Verified, not assumed (§3 probe line "write-side bytes identical", and the untouched round-trip test which pins the log bytes against `JSON.stringify(event)` still passes).
- **No id-match check.** Both siblings also reject an event whose id disagrees with the store's. The mandate does not ask for it, no defect was proven for it, and it would be a new rejection of input today's callers may legitimately produce. Left alone; noted here as the one remaining asymmetry with the siblings.
- **No line-context wrapper**, per the mandate: a plain `DomainValidationError` from the decoder, propagated as-is.

### `test/unit/episode/store.test.ts` — four added tests, six existing untouched

All six read-side tests are byte-identical to HEAD; the additions sit between the corrupt-line test and the truncated-tail test, plus two helpers (`unknownTypeEvent`, `exists`) and `stat` added to the existing `node:fs/promises` import.

| New test | Pins |
|---|---|
| `a malformed append is rejected and the log keeps its exact bytes` | The mandated arc: `type: "EPISODE_REOPENED"` rejects with `DomainValidationError`, message names the unknown type and carries **no** line number, the log is byte-identical before/after, and a subsequent valid append + `readAll` are green (the rejection does not poison the append queue) |
| `a rejected append never brings the log into existence` | Rejection against an empty state root does not create the jsonl (`appendJsonlLine` would have `mkdir -p`'d it) and `readAll` still reports zero events |
| `a malformed required field is refused by the writer, not just the reader` | `runId: "not-a-run-id"` rejects on the write side; bytes unchanged. Mirrors the existing read-side test of the same shape |
| `an accepted append lands the decoder's output, so unknown keys never reach the log` | An extra key on an otherwise-valid event is accepted but stripped; the row on disk equals `JSON.stringify(opened)` exactly |

## 3. Proof: defect before, closed after (real code, out-of-tree, deleted)

All probe files lived under `/tmp/r16-2-probe/`, imported the real modules from `/workspace/src`, and were deleted at the end of the slot (`rm -rf /tmp/r16-2-probe` confirmed).

**Before the fix**, the audit's claim reproduced verbatim against unmodified HEAD:

```
appendRejected: false
lines on disk: 2
malformed row landed: true
readAll THROWS: DomainValidationError Invalid episode event at line 2 in …events.jsonl: Unknown EpisodeEvent.type: EPISODE_REOPENED
```

A later *valid* append still succeeded and `readAll` still threw — confirming the brick is permanent, not transient.

**After the fix**, the same probe:

```
append rejected: DomainValidationError Unknown EpisodeEvent.type: EPISODE_REOPENED
appendRejected: true
lines on disk: 1
malformed row landed: false
readAll ok, events: 2
```

and the wider probe:

```
empty-log malformed append: DomainValidationError: Unknown EpisodeEvent.type: EPISODE_REOPENED
log created by the rejected append: false
write-side bytes identical to JSON.stringify(event): true
populated-log malformed append: DomainValidationError: Unknown EpisodeEvent.type: EPISODE_REOPENED
log bytes unchanged: true
bad-field append: DomainValidationError - EpisodeEvent.runId must be a valid RunId
log bytes still unchanged: true
readAll ok, events: 5 recovery: {}
unknown key reached the log: false
```

**Mutation check (are the new tests load-bearing?).** Out-of-tree: `git show HEAD:src/episode/store.ts` copied to `/tmp`, its imports repointed at `/workspace/src`, and the full test file run against that pre-fix store. Result:

```
ok 1 - a valid episode event log round-trips identically
ok 2 - reading a missing episode event log yields no events
ok 3 - an unknown-type row fails readAll closed and names the line
ok 4 - a malformed required field fails readAll closed instead of being cast
ok 5 - a corrupt mid-file line fails readAll closed with a DomainValidationError
not ok 6 - a malformed append is rejected and the log keeps its exact bytes
not ok 7 - a rejected append never brings the log into existence
not ok 8 - a malformed required field is refused by the writer, not just the reader
not ok 9 - an accepted append lands the decoder's output, so unknown keys never reach the log
ok 10 - a crash-truncated final line is still recovered, not fatal
# tests 10 # pass 6 # fail 4
```

Exactly the four new tests fail without the fix and all six pre-existing tests pass with the pre-fix store — so the additions are load-bearing on this change and the change alters nothing on the read side.

Honesty note on that harness: the first attempt showed 7 failures, because the out-of-tree store copy and the test loaded two separate instances of `domain/errors.js`, so `instanceof DomainValidationError` was false for the three pre-existing tests that assert it. That was a harness artifact, not a finding; re-exporting the class through the copied store unified the identity and produced the clean 6-pass/4-fail signal above. Recorded rather than quietly discarded.

## 4. Verification

| Check | Command | Result |
|---|---|---|
| Scoped lint | `eslint src/episode/store.ts test/unit/episode/store.test.ts` | exit 0, clean (run twice: after the edit and again at slot end) |
| Whole-tree typecheck | `tsc --noEmit` | exit 0, clean (run twice, same points) |
| Owned tests ×3 | `tsx --test test/unit/episode/store.test.ts` | `10 / 10 pass / 0 fail` on every run; re-run 3× again at slot end, same |
| Censused consumers | `tsx --test` over `test/unit/episode/*`, `test/unit/run/episode-bind.test.ts`, `test/unit/run/episode-store.test.ts`, `test/integration/m3/{episode-cli,episode-reducer-store,checkpoint-d}.test.ts`, `test/integration/cli/delete.test.ts` | **71 / 71 pass** |
| Crash probe | `node scripts/crash-probe.mjs --iterations 1` (read-only; the script appends episode events at line 992) | `ok: true`, **11 cases**, names and order unchanged, `unblock-discard-append-before-checkpoint-sigkill` last |
| Full suite (informational) | `node scripts/run-tests.mjs` | `1962 tests / 1961 pass / 0 fail / 1 skip`, 112 suites, exit 0 |

Scope caveat on the last row, stated plainly: sibling slots are editing the **same working tree** concurrently (`git status` at slot end also showed `src/cli/main.ts`, `src/cli/migrate-legacy.ts`, `src/preferences/store.ts`, `docs/data-dictionary.md` and their tests dirty, plus a new `test/unit/preferences/snapshot-lock.test.ts`). That full-suite run therefore covers my change **plus** whatever the siblings had on disk at 02:55Z — it is a green sanity beat, not an attributable measurement of this slot, and it is not a substitute for the parent's gate. The baseline it can be compared against is 1951/1950/1-skip/111-suites; +11 tests and +1 suite is the four tests here plus the siblings'. Everything in the rows above it is scoped to files this slot owns or only reads.

## 5. Frozen-contract and forbidden-list check

- Append-only logs are **not** rewritten — the fix prevents the bad row, it never repairs one. An episode already bricked at HEAD stays bricked; that remains out of contract and is not claimed as fixed.
- `EventStore.append` / `CheckpointStore.write` untouched; no lock added anywhere; no perf claim made (one added synchronous validation on a path that already does 2–3 fs ops — no measurement offered and none claimed).
- Read side unchanged: `readAll`, its line-context message, the truncated-tail recovery contract and all six existing tests are byte-identical.
- Nothing touched in crash-probe, `main.ts`, preferences, eval-routing, migrate-legacy or docs — confirmed by `git status`; the other dirty paths are sibling slots'.
- No dependency, no schema, no `RunStatus` contact, no new export, no ADR movement. No parent sign-off was required for this slot and none is requested.
- No scratch files in the tree at report time; the out-of-tree mutation directory is deleted.

## 6. Verdict

The one asymmetric appender in the tree now validates before writing, on the same terms as its two siblings. The proven defect is closed at its source (probe transcripts §3), four destructive tests pin it and fail without it, the six existing read-side tests are untouched and still pass, and scoped lint, whole-tree `tsc`, the consumer suites and the crash probe are all green.

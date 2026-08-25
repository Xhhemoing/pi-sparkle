[Model: claude-opus-5-fast]

# Loop 4 · Round 13 — R13-3 report

**Slot:** R13-3 (opus-fast) · **Branch:** `agent/opt-continuous` (never left it; no checkout, no commit, no push) · **Base HEAD:** `dfb185b`
**Mandate:** wire `onRunStarted` on `--flowchart` and `--children` the same way the track path already does. Parent sign-off YES.
**Verdict: LANDED (not stop-and-report).** The census found no byte-pinned output shape that the new line breaks; it is absorbed additively by every consumer, with zero edits outside `src/cli/main.ts` and `test/integration/cli/blocked-next.test.ts`.

---

## 1. Census (taken against the working tree, before any write)

### 1.1 Path existence (brief-handed paths, all verified present)

| Path | Exists | Bytes / lines at census |
|---|---|---|
| `src/cli/main.ts` | yes | 91955 B / 2125 lines |
| `test/integration/cli/blocked-next.test.ts` | yes | 22196 B / 540 lines |
| `test/unit/cli/doctor-routed-next-freeze.test.ts` | yes | 5888 B / 132 lines |
| `test/integration/m2.5/cli-contract-honesty.test.ts` | yes | 8213 B / 232 lines |

Line numbers the brief handed me were accurate: track-path `onRunStarted` at `main.ts:876`; `--flowchart` deps at `:775-781`; `--children` deps at `:954-962`.

### 1.2 Whole-tree consumer set

`rg -l -- '"--flowchart"|--flowchart |"--children"|--children ' test/ scripts/` → **eleven test files, zero scripts**. That is the complete set of places that can observe the new stdout line. Every one was read.

| # | File | What it does with stdout on those paths | Effect of the new line |
|---|---|---|---|
| 1 | `test/integration/cli/blocked-next.test.ts` | `runFlowchart` extracts `out.match(/Run (run_[A-Za-z0-9_-]+):/)?.[1]` — **first match**. `assert.match(out, /Run run_…: BLOCKED/)`, `/…: COMPLETED/`. All routing/prefix assertions are on **stderr**. | First match becomes the `started` line, **same run id** (verified behaviourally, §4). Status-line matches are unanchored and still hit. stderr untouched. **Absorbed.** |
| 2 | `test/integration/cli/cli.test.ts` | `parseRunIdFromOutput` (`:407`) + five inline `text.match(/Run (run_…):/)` — all first-match. Status assertions are `/COMPLETED/`, `/FAILED/`, `/WAITING_FOR_USER/`, `/only=COMPLETED/`, `/pending approval/`. `assert.deepEqual(out, [])` appears once, on a **parse-args failure** that never reaches `startFlowchartRun`. | Absorbed. |
| 3 | `test/integration/cli/pause-inject.test.ts` | `parseRunIdFromOutput` (`:67`), first-match; `/WAITING_FOR_USER/`, `/PAUSED/`. | Absorbed. |
| 4 | `test/integration/cli/public-prior-cli.test.ts` | `implementerModel()` matches `/\(implementer, [^)]+\) -> (\S+)/`; `/public prior: pps_fixture_v1/`. No run-id extraction. | Absorbed. |
| 5 | `test/integration/cli/unblock.test.ts` | `started.out.match(/Run (run_…): BLOCKED/)` — **anchored on the status word**, so it skips the new line by construction. Later assertions are `^Run <id>: unblocked \(RUNNING\)$` (a different command). | Absorbed. |
| 6 | `test/integration/m1/cli-children.test.ts` | `requireCompletedRunId` first-match; `/Run (run_…): COMPLETED/`, `/children: 2/`; `assert.deepEqual(err, [])` (stderr). | Absorbed. |
| 7 | `test/integration/m2.5/cli-contract-honesty.test.ts` | `runIdFromOutput` (`:31`) first-match, used on **both** a `--children` run and a `--track` run. | Absorbed — **no regex widening needed**, disclosed in §3. |
| 8 | `test/integration/pi-adapter/loopback-cli-resume.test.ts` | local `parseRunId(output)` (`:75`) first-match; `assert.equal(started.err.join(""), "")` and the byte-pinned resume stderr line — both **stderr**. | Absorbed; the frozen stderr byte-pin is untouched. |
| 9 | `test/unit/cli/invocation-sink-wiring.test.ts` | Source census: counts `createExecutor(` call sites (4 whole-file, 2 in `resumeCommand`) and matches `onInvocation:`/`invocationSink(`. Cuts function bodies at `\n}\n`. | My diff adds no `createExecutor`, changes no function boundary. Unaffected. |
| 10 | `test/unit/cli/resume-executor-config.test.ts` | Local `startFlowchartRun()` CLI helper, first-match extraction. | Absorbed. |
| 11 | `test/unit/telemetry/invocation-log.test.ts` | `runCommandBody()` — cuts `async function runCommand(` … `\n}\n`, then asserts **exactly 2** `createExecutor(` sites inside. | Unaffected (no new `createExecutor`; the `\n}\n` terminator is unchanged). |

`scripts/` (`bench-runtime`, `crash-probe`, `pi-compat-probe`, `pi-latest-check`, `retention-probe`, `run-tests`, `security-probe`): **zero** matches for either flag. Nothing there parses run stdout.

### 1.3 The specific pins the mandate named

- **`blocked-next.test.ts` run-id extraction** (`:121`) — the load-bearing one. `/Run (run_[A-Za-z0-9_-]+):/` takes the first match, which is now `Run <id>: started`. Verified behaviourally, not by argument: the new `--flowchart` pin asserts `lines[0].runId === lines[1].runId` **and** `started.runId === lines[1].runId`, so the extracted id is proven to be the run the BLOCKED block routes. Both lines are the same run because `onRunStarted` fires with the same `runId` the outcome carries.
- **Five `DOCTOR_ROUTED_NEXT` routes + `GENERIC_FAILURE_NEXT`** — character-exact, untouched. These are top-level `const`s at `main.ts:1953`/`:1973`; the freeze is an AST census of top-level variable initializers (`doctor-routed-next-freeze.test.ts`), structurally unreachable from a callback added inside `runCommand`. **No edit to that file was needed** (I own it; it is diff-empty).
- **`INSPECT_SUMMARY` four keys** (`main.ts:1147-1151`) — untouched; `inspect` is a different command and my diff is confined to `runCommand`.
- **BLOCKED four-line prefix + two `note:` lines** — untouched. They come off `formatBlockedRunReport` onto **stderr**; the new line is stdout. `assert.deepEqual(routed, [...])` in the two byte-exact tests still passes verbatim.
- **`onRunStarted` as shipped** — `src/run/flowchart-run.ts` is **not edited** (git diff for it: empty). The dep declaration (`:129`), the fire site inside `withRunLifecycleLock` after `RUN_CREATED` and before round 1's pause poll (`:1285`), and the swallow (`:1286-1288`) are all as R12-1 shipped them. `src/track/loop.ts` not edited.
- **The tracked wiring pins** in `resume.test.ts:1234-1251` regex `const outcome = await startTrackedRun({…})` — a different call site from the two I changed. Re-run green (§4).
- **`runCommand` BLOCKED-wiring pins** (`blocked-next.test.ts:354-418`) — they slice the **200 characters preceding** each `return flowchartExitCode(outcome.status);`. My edits sit far above those windows (the deps object literal), and neither the count of `flowchartExitCode` exits (2 in `runCommand`, 4 whole-file) nor the mutation needles changed. Green.

**Census conclusion: the new line is purely additive on stdout, printed before the existing status line, and no consumer's shape is byte-pinned in a way that forbids it. No stop-and-report.**

---

## 2. Diffs

### 2.1 `src/cli/main.ts` (+15/−1) — the sole `src` file

Two handlers, one per path, copied from the track path's shape at `:876` verbatim (`io.stdout(\`Run ${runId}: started\n\`)`), not a second shape.

```diff
@@ -777,6 +777,13 @@ async function runCommand(args: string[], io: CliIo): Promise<number> {
         stateRoot,
         router: await createCalibratedCliModelRouter(stateRoot),
         pause: createFilePauseController(stateRoot),
+        // Same disclosure the tracked path makes, for the same reason: the
+        // summary below only arrives once the run is terminal, so until this
+        // line a live `--flowchart` run could be paused in principle and was
+        // unnameable in practice.
+        onRunStarted: (runId) => {
+          io.stdout(`Run ${runId}: started\n`);
+        },
         ...(executor !== undefined ? { executor } : {})
       },
@@ -958,7 +965,13 @@ async function runCommand(args: string[], io: CliIo): Promise<number> {
         cluster: true,
-        pause: createFilePauseController(stateRoot)
+        pause: createFilePauseController(stateRoot),
+        // The third and last public run path to disclose its id early. A
+        // cluster run is the longest of the three, so it is the one an
+        // operator is most likely to want to pause before it settles.
+        onRunStarted: (runId) => {
+          io.stdout(`Run ${runId}: started\n`);
+        }
       },
```

The only non-additive line is `pause: …` gaining a trailing comma. `runId` is contextually typed from `FlowchartRunDeps` — no import added, no type annotation invented, so `live-isolation.test.ts` has nothing new to see (no new import anywhere in my diff).

### 2.2 `test/integration/cli/blocked-next.test.ts` (+88) — additive, two new tests

- `SINGLE_CHILD_SPEC` — the smallest spec `--children` accepts (one implementer task, no `dependsOn`).
- `runLines(out)` — returns every `^Run <id>: <word>$` line **in order**, so the output is read as a sequence rather than as two independent unanchored matches. This is the "widen an existing stdout match" the mandate preferred over a live pause.
- **`run --flowchart discloses its run id before the run settles`** — reuses the existing `runFlowchart` helper unchanged, asserts `words === ["started", "BLOCKED"]` (the terminal line is still second and unchanged), both lines name the same run, and `started.runId` (the helper's first-match extraction) equals the *terminal* line's id.
- **`run --children discloses its run id before the run settles`** — one real CLI `--children` run through `withRoots`/`capture`/`main`, asserts `words === ["started", "COMPLETED"]` and same-id.

**Nothing races and nothing is killed.** Both pins read the run's own settled output; there is no pause token, no timer, no signal, no second process. `onRunStarted` is used only as the one-way notification it is.

### 2.3 Files I own and did **not** edit (diff-empty, deliberately)

- `test/unit/cli/doctor-routed-next-freeze.test.ts` — the AST freeze is on top-level constants; a callback inside `runCommand` is invisible to it. Re-run green, including its deletion mutant.
- `test/integration/m2.5/cli-contract-honesty.test.ts` — **its regexes did not need widening** (§3).

**Do-not-edit list honoured:** `src/run/flowchart-run.ts`, `src/track/loop.ts`, `docs/**`, and every freeze pin file I do not own are all diff-empty in my working set. `git diff --stat` shows my two files plus siblings' in-flight work (R13-1's `replay.ts`/`prescore.ts`, R13-2's `resume.test.ts`/`criteria-gate.test.ts`) — none of those are mine and I touched none of them.

---

## 3. Pin updates and disclosures

1. **Two new behavioural pins added** (`blocked-next.test.ts`, +2 registered tests: 12 → 14 in that file; suite total for my three owned files 16 → 18). Both are behavioural, not source-regex, so they survive renames and cannot pass on a source that only *mentions* the handler.
2. **`cli-contract-honesty.test.ts` needed no widening — disclosed.** The brief allowed editing it "only if its regexes need widening". Its single extractor (`:31`) is first-match on `/Run (run_…):/` and its only status assertion (`:177`) is on the `--track` run, which already printed the started line before this round. Widening it would have been busywork; the file is diff-empty and its 2 tests are green.
3. **No pin was weakened, reworded or reordered.** The five doctor routes, `GENERIC_FAILURE_NEXT`, `INSPECT_SUMMARY`'s four keys, the BLOCKED four-line prefix and both `note:` lines, the `RUN_UNBLOCKED` key sets, the eight `RunStatus` members and the loopback stderr byte-pin are all byte-identical at HEAD+diff.
4. **`onRunStarted` is not overloaded.** Nothing is read back from the callback, no control flow depends on it, and the swallow in `flowchart-run.ts` is untouched — I did not change what happens when a handler throws. It is not fired on the clarification path: that path lives in `track/loop.ts` and never calls `startFlowchartRun`, and I edited neither.
5. **Output-ordering note for `--children`.** The routing summary (`  routing (primary=…)` and its indented per-task lines) is printed *before* `startFlowchartRun`, because it is planning output produced before the run exists. So `--children` now prints routing, then `Run <id>: started`, then the terminal `Run <id>: <status>`. No assertion anywhere depends on routing following the status line, and the run-id extractors are unaffected because routing lines contain no `Run run_`.

---

## 4. Verification

All on this VM, Node v22.14.0 (engine warning only), branch `agent/opt-continuous`.

**Whole-tree typecheck:** `pnpm exec tsc --noEmit` → **exit 0**, no output. Run twice (once after the edits, once after the mutation restore).

**Scoped eslint** on all four owned paths → **exit 0**, no output:
`pnpm exec eslint src/cli/main.ts test/integration/cli/blocked-next.test.ts test/unit/cli/doctor-routed-next-freeze.test.ts test/integration/m2.5/cli-contract-honesty.test.ts`

**Owned tests, 3× (post-restore, final state):**

| Run | tests | pass | fail | skipped | duration |
|---|---|---|---|---|---|
| 1 | 18 | 18 | 0 | 0 | 1038 ms |
| 2 | 18 | 18 | 0 | 0 | 997 ms |
| 3 | 18 | 18 | 0 | 0 | 1331 ms |

(18 = `blocked-next` 14 + `doctor-routed-next-freeze` 2 + `cli-contract-honesty` 2. **Zero skips introduced.** An identical 3× green run was also taken *before* the mutation check.)

**Censused consumers, all nine non-owned files, re-run against the final tree:** **105 tests / 105 pass / 0 fail / 0 skipped.** (`cli.test.ts`, `pause-inject`, `public-prior-cli`, `unblock`, `cli-children`, `loopback-cli-resume`, `invocation-sink-wiring`, `resume-executor-config`, `invocation-log`.) An earlier run of the same nine **plus `resume.test.ts`** — the file carrying the tracked `onRunStarted` wiring pins and the behavioural tracked pause — was **127/127 green**, so the track path's pins are unharmed by the two new call sites.

**Non-vacuity (mutation).** Both handlers removed from `main.ts`; the two new pins go red and nothing else does:

```
not ok 4 - run --flowchart discloses its run id before the run settles
not ok 5 - run --children discloses its run id before the run settles
# tests 14  # pass 12  # fail 2
```

The mutation was applied in-tree to `src/cli/main.ts`, the one file **no other Round 13 slot owns**, because the pin invokes `main()` through a relative import that a `/tmp` copy cannot resolve. Window: **01:31:49.378 → 01:31:53.611 UTC, 4.2 s**. Restored from a `/tmp` backup and verified **byte-identical by sha256** (`90ca2900c0ec8b9dfead3c3b49e33985277350f022666dd674d91b36d5d7f1f3` before and after); the backup was deleted. The mutated region is the `startFlowchartRun` deps in `runCommand` — not the `startTrackedRun` call site `resume.test.ts` regexes, and not any region another slot's pin reads — so a sibling running inside that window would have seen only the two intentionally-red new tests. No scratch files remain anywhere.

**No full `pnpm gate`** (parent's job). Test-count delta the parent should expect from this slot: **+2**.

---

## 5. Residuals and honest limits

1. **The pins are settled-output pins, not liveness pins.** They prove the started line is printed, is first, and names the run — they do **not** prove it was printed *before* the loop's first pause poll. That ordering is a property of `startFlowchartRun` (frozen as shipped) and is already proven behaviourally for the track path by `resume.test.ts`'s pure-CLI tracked pause, which drives the same `:1285` call site. Reproducing that pause on `--flowchart` would need a `stdout`-handler token write, i.e. a second copy of a proof that already exists one call site over; the mandate explicitly preferred widening a stdout match, and the ordering guarantee is shared code, not per-call-site.
2. **Neither pin exercises the throw-swallow arm** on these two paths. That arm is `flowchart-run.ts`'s, frozen and out of my ownership; a CLI `io.stdout` sink that throws is not a shape the CLI can produce.
3. **`--children`'s routing block still precedes the id disclosure** (§3.5). That is inherent to where planning happens, not something a handler placement can fix; I did not move the routing print, since it is outside the mandate and would change an existing output line.
4. **`doctor-routed-next-freeze.test.ts` gained nothing.** I own it and left it alone deliberately: it is an AST census of top-level constants, structurally blind to `runCommand` internals, and the brief lists routes/`INSPECT_SUMMARY`/BLOCKED-prefix work as saturated. Adding an assertion there to "cover" this change would have been the busywork the brief forbids.
5. **Shared-tree transients:** none observed. Every failing result I saw in this slot was the intentional 4.2 s mutation window recorded above. Sibling working-tree changes to `replay.ts`, `prescore.ts`, `resume.test.ts` and `criteria-gate.test.ts` were present during my final runs and caused no failure in anything I ran.
6. **Docs consequence for R13-4:** the run-id-at-end gap is now closed on **all three** public run paths, not just `--track`. `docs/status-matrix.md:60-65` records it as open for `--flowchart`/`--children`. I own no docs and did not touch them; the brief already anticipated this ("or its closure if R13-3 lands first"). This claim is true as of 01:34 UTC and is **uncommitted** — the docs slot must not assign it a commit id.

# Loop 5 Round 3 — independent landing challenge

Scope: source re-read at current `cursor/pi-sparkle-sota-opt-0da8`; prior
landing reports were not used as votes. No `src/` files were changed.

## Verdicts

| Landing | Verdict | Reason |
|---|---|---|
| T1+T2 (D8/D9) | **KEEP** | Fail-closed answer correlation and non-executable continuation facts are both present. |
| Auth D12 | **KEEP** | A valid ambient-auth answer survives corrupt `auth.json`; precedence uncertainty is disclosed without changing the file. |
| Catalog D13 | **KEEP** | A lone concrete primary emits both `cheap` and `premium`. |
| Aux CLI | **KEEP** | Episode mutation disclosure, inject/pause help, and typed commits preview all landed without widening Event/RunStatus. |
| Gate-cause D11 | **FIX** | Wording is honest and freezes are intact, but the claimed transition/block pairing can jump across intervening valid events. |
| Dataset privacy D10 | **HOLD** | The required privacy/isolation/deletion remediation is still absent. |

## 1. T1+T2 (D8/D9) — KEEP

- A track sidecar, readable or corrupt, is detected before any append and
  refused with a replacement-run route (`src/cli/main.ts:1841-1871`).
- A non-flowchart `WAITING_FOR_USER` run without the requested pending child
  `QUESTION` also refuses before `USER_ANSWER`; only a correlated question
  reaches the append (`src/cli/main.ts:1941-1971`). This closes the torn
  wait/absent-sidecar case.
- Continuation data is emitted as five labelled facts, not a pasteable command
  (`src/cli/main.ts:1133-1162`). Control characters are JSON-escaped before a
  value can forge a second fact line (`src/cli/main.ts:1117-1130`).
- Inspect explicitly says the old run remains `WAITING_FOR_USER` and the
  continuation is a new run (`src/cli/main.ts:1202-1213`). The machine summary
  still projects only the four frozen keys (`src/run/inspection.ts:57-75`).

No freeze break or remaining honesty gap found in this landing.

## 2. Auth D12 — KEEP

- `--from-env` asks the provider through the empty credential-store path, so
  stored API keys and OAuth sessions cannot manufacture an ambient-auth success
  (`src/cli/auth.ts:184-205`;
  `src/pi-adapter/file-credential-store.ts:186-220`).
- After that answer, corrupt credential JSON is downgraded only for the
  precedence listing (`src/cli/auth.ts:206-224,245-252`). The command prints
  the ambient source, warns that stored precedence is unknown, exits success,
  and performs no write (`src/cli/auth.ts:210-217`).
- Other auth verbs still fail closed on the typed damaged-store error and name
  the operator-owned move-aside recovery (`src/cli/auth.ts:64-75`).

This satisfies D12 without changing the store-first effective-auth check. The
remaining interactive secret-echo issue below is older/adjacent, not a reason
to reject this D12 landing.

## 3. Catalog D13 — KEEP

The live catalog chooses the concrete fast and primary rows, then independently
adds `cheap` and `premium`; there is no longer a primary-versus-fast inequality
guard suppressing `premium` (`src/cli/model-catalog.ts:64-75`). Thus a lone
primary yields concrete + cheap + premium while the separately frozen
`catalogFromPrimary` one-row behavior remains untouched
(`src/routing/primary-catalog.ts:45-66`).

## 4. Aux CLI — KEEP

- A refused `episode close --status COMPLETED` writes `WAITING_FOR_USER` and
  `EPISODE_WAITING`, then claims the mutation only after both appends return;
  a repeat writes nothing and says it is already waiting
  (`src/cli/episode.ts:106-129`). Help discloses the mutation
  (`src/cli/episode.ts:14-19`).
- Both `inject` and `pause` have dedicated `help`, `--help`, `-h`, and parsed
  `--help` success paths (`src/cli/inject.ts:16-26,32-67`;
  `src/cli/pause.ts:16-21,27-58`).
- `commits preview --json` emits one
  `{type:"COMMITS_PREVIEW",preview:true,commits}` view object
  (`src/cli/commits.ts:128-154`), and `apply --file` continues to accept the
  object by reading only `commits` (`src/tools/decision-commit.ts:258-280`).
  `COMMITS_PREVIEW` is not a domain Event.

## 5. Gate-cause D11 — FIX

The wording rider is good: it calls `ANALYSIS_QUEUED` a verdict rather than a
running job, says no consumer/dequeue is wired, and keeps `unblock` as the
action (`src/cli/main.ts:532-550`). Inspect keeps the detailed dimensions and
criteria in prose (`src/cli/main.ts:553-571`).

The assessment join is also hardened by both hash and sequence
(`src/run/inspection.ts:149-159`). The transition-to-block join is not:

- The sole producer writes `GATE_TRANSITION` immediately followed by
  `RUN_BLOCKED` for `queue_analysis` (`src/run/gate-apply.ts:124-166`).
- The reader instead scans arbitrarily far backward from the newest block and
  accepts the first transition shaped `queue_analysis`/`BLOCKED`
  (`src/run/inspection.ts:130-147`). It does not stop at an intervening event,
  prior block, or matched unblock.
- A runtime probe using three individually `validateEvent`-accepted rows —
  queue-analysis transition, `PAUSE_REQUESTED`, then `RUN_BLOCKED
  ANALYSIS_QUEUED` — returned the old transition as the new block's cause.

That makes the comment that the pair is exact stronger than the implementation.
Require the immediately preceding event to be the qualifying transition (the
producer's actual invariant), and add negative pins for an intervening event
and a prior block/unblock cycle. Also bound child-result evidence to rows at or
before the block. This is freeze-safe: it changes only whether optional prose is
printed.

## 6. Dataset privacy D10 — HOLD still open

The Round-2 exporter exists, but none of D10's release conditions has landed:

1. It truncates first and redacts second
   (`src/learning/eval-dataset.ts:114-125`). A token cut at character 500 can
   cease matching a whole-secret rule; D10 requires redact-then-truncate.
2. Raw `originalWorkspace` is stored on every task-derived episode
   (`src/learning/eval-dataset.ts:24-32,117-125`), rather than classified,
   protected, and stored at most once per manifest.
3. Run deletion removes runtime records but has no eval-dataset cascade
   (`src/privacy/deletion.ts:321-333`). The dictionary explicitly declares no
   propagation (`src/privacy/record-classes.ts:239-256`).
4. Output isolation compares only against the recorded workspace
   (`src/learning/eval-dataset.ts:197-205`), using lexical `path.resolve`
   rather than real paths (`src/experiments/isolation.ts:18-27`). `--dir`
   beneath `<state-root>/runtime` or through a symlink is not rejected.
5. The exporter still manufactures one `EvalDatasetEpisode` per task
   (`src/learning/eval-dataset.ts:98-128`), contrary to D10's instruction not
   to invent independent episodes from tasks.

Existing tests pass because they pin the current weaker contract, including
truncate-then-scrub and workspace-only lexical isolation
(`test/unit/learning/eval-dataset.test.ts:244-281,380-396`).

## Frozen-contract audit

No Round-3 diff touched `src/domain/status.ts`, `src/run/events.ts`,
`src/cli/doctor.ts`, or `package.json` (checked from the Round-3 dispatch
baseline through HEAD).

- `INSPECT_SUMMARY`: exactly `type`, `runId`, `status`,
  `requiredEvidence` (`src/run/inspection.ts:57-75`).
- BLOCKED routing: unchanged four-line routed prefix and exactly three
  `next:` lines; discard and gate cause remain trailing `note:` lines
  (`src/cli/main.ts:511-520`).
- `RunStatus`: exactly eight members (`src/domain/status.ts:1-12`).
- No landing added an Event type; the view objects remain outside the Event
  vocabulary (`src/run/events.ts:38-77`;
  `src/cli/commits.ts:149-154`).
- Doctor JSON remains frozen-additive with `liveAdaptive: false`
  (`src/cli/doctor.ts:51-67,759-777`).
- Package remains private (`package.json:1-5`).
- Live model selection remains R0-equivalent static
  (`src/routing/live-selection.ts:5-20`); R1/shadow modules remain excluded
  from the live import closure
  (`test/unit/routing/live-isolation.test.ts:69-99,223-227`).

## Highest-value Round 4 slot

**Remaining auth echo** is the highest-value slot. The interactive adapter says
it never echoes secret input, but both text and secret prompts use the same
ordinary `readline.question` fallback (`src/pi-adapter/auth-session.ts:148-181,
206-208`). On a TTY, readline leaves terminal echo enabled, so an API key is
visible on screen even though it is not copied to `io.stdout`. The current tests
inject a mock `question` function and therefore cannot observe terminal echo.
Use a hidden-input TTY path with a non-TTY fail-closed policy and a PTY-level
regression.

Runners-up are lower value: current cross-OS CI still omits the new verb smoke
(`.github/workflows/ci.yml:46-74`) and open PR #12 edits the same file; the
not-found retarget is mostly landed, with `pause` still pointing only at the
supplied id (`src/cli/pause.ts:78-86`); status-matrix reconciliation is useful
but documentation-only and also overlaps PR #12.

## Verification

Targeted landing, privacy, freeze, doctor, and live-isolation suites: **117
passed, 0 failed**. The host emitted the known Node warning
(`22.14.0` versus package engine `>=22.19.0`).

## Ranked FIX / HOLD

1. **HOLD — D10 dataset privacy:** complete all five conditions above before
   treating `adapt dataset` as merge-ready.
2. **FIX — interactive auth secret echo (Round 4):** hidden TTY input plus PTY
   proof; this is the highest-value Round-4 slot.
3. **FIX — D11 pairing:** require producer-adjacent transition/block pairing
   and add negative sequence tests.

model: claude-opus-5-thinking-high-fast

# R2-opus-A — port MERGE-NOW production from `cae9`

**Branch:** `cursor/merge-preview-release-8011` (no commit, no checkout, no push).
**Source:** `origin/cursor/agent-market-eval-opt-cae9` tip `73e9677`.
**Method:** file-scoped port, **no `git merge`**. Merge base with our HEAD is `80eb0bd`
(PR #10 merge). Everything below was taken as a base→cae9 file diff or a `git show`
of a single new file.

## Census (done first)

`git diff --stat 80eb0bd 73e9677` is 75 files. Of those, the ones in my slot:

| Path | Ours vs base | cae9 vs base | Port |
|---|---|---|---|
| `src/run/inspection.ts` | **unchanged** | +177 | clean `git apply` |
| `test/unit/run/inspection.test.ts` | **unchanged** | +383 | clean `git apply` |
| `test/integration/cli/inspect-follow.test.ts` | absent | new, 389 | `git show` verbatim |
| `scripts/market-eval-probe.mjs` | absent | new, 274 | `git show` verbatim |
| `test/unit/package/market-eval-probe.test.ts` | absent | new, 79 | **adapted** (see below) |
| `test/unit/cli/readme-command-parity.test.ts` | absent | new, 114 | **adapted** (see below) |
| `src/cli/main.ts` | +125 (PR #11 `--max-cost-usd`) | +248 | **hand-ported, partial** |

Because our branch carries PR #11 and cae9 does not, cae9's tree *deletes* work we
have (`scripts/preview-release-probe.mjs`, `test/integration/cli/run-cost-cap.test.ts`,
`test/unit/cli/cost-flag.test.ts`, `test/unit/feedback/release-gate-policy.test.ts`,
`test/unit/privacy/redaction.test.ts`, and 115 lines of the developer-preview readiness
report). A `git merge` of `cae9` would have to resolve all of those plus twelve
colliding `.agent_workspace/*.md`. That is why this was a port.

Only `src/run/inspection.ts` needed a dependency check; everything it imports already
exists on our HEAD (`EventLogRecovery` in `event-store.ts:37`, `DomainValidationError`,
`replayRun`, and all six `RunStatus` values in the stop set).

## What landed

### 1. `src/run/inspection.ts` — the follow reader (+177)

Applied unchanged from cae9. Exports `FOLLOW_STOP_STATUSES`, `isFollowStopStatus`,
`DEFAULT_FOLLOW_INTERVAL_MS`, `FollowRunOptions`, `FollowRunResult`, `followRunEvents`.
It polls `EventStore.readAll` (no lock, no writer, no watcher), slices by emitted count
so a torn last line is skipped and re-read rather than printed, stops on the six
statuses nothing advances without an operator, reports `log-vanished` when the log
shrinks, and takes an **opt-in** monotonic idle deadline (`performance.now`) that is
checked after the status check so a status stop always wins.

### 2. `test/unit/run/inspection.test.ts` (+383) and `test/integration/cli/inspect-follow.test.ts` (389, new)

Both applied unchanged. The integration file needed `withIsolatedPiEnv`
(`test/helpers/pi-env.ts`) and `main` / `CliIo` / `formatFollowEventLine` exported from
`main.ts`; the first two already existed, the third I added with the port. Two of its
twelve cases spawn a real `tsx src/cli/main.ts` process, which is the only shape that
proves follow terminates on its own.

### 3. `src/cli/main.ts` — follow flag + USAGE only (+179, not cae9's +248)

Ported: the `inspection.js` import, `export const USAGE`, the `inspect --run --follow`
usage line and its prose paragraph, `formatFollowEventLine`, `followInspect`,
`MAX_FOLLOW_IDLE_TIMEOUT_MS`, `followIdleTimeoutMs`, the `follow` /
`idle-timeout-ms` parse options, the `--summary-json` and `--episode` refusals, the
`--idle-timeout-ms`-without-`--follow` refusal, and the dispatch into `followInspect`.

**Deliberately not ported** (out of slot, and each is listed here so the parent can
route it):

- `pendingAnswerMessageIds` + the `answer --message` correlation guard, its USAGE
  paragraph, the `waiting for answer:` line in prose inspect, and
  `test/integration/cli/answer-correlation.test.ts` (234 lines). This is a real
  fail-closed fix — today a well-formed but uncorrelated `--message` records a
  `USER_ANSWER` that flips a `WAITING_FOR_USER` run to `RUNNING` with nothing left to
  continue it — but it is an `answer`-command change, not a follow change. **Recommend
  as a Round 3 landing.**
- cae9's `--children` USAGE rewrite (`dependsOn` ordering, `inputArtifactIds` grounds
  without creating an edge). It is paired with a README JSON-example change I cannot
  make, so porting only half would leave USAGE and README disagreeing.

**One USAGE edit beyond follow:** the duplicated `--track` sentence fragment. Our USAGE
had `predecessor artifacts, assigns other catalog models…` twice — an orphaned paste
that reads as a broken sentence in `pi-sparkle help`. cae9's fix merges it into one
sentence; I took that, because the parity test I ported asserts it. `--max-cost-usd`
from PR #11 is untouched.

`main.ts` verbatim-preserved everything else: I made five string-replace edits, all
inside USAGE or `inspectCommand`, plus one import and one function block.

### 4. `scripts/market-eval-probe.mjs` (274, new)

Applied unchanged. Runs green on this HEAD (exit 0). It reports, among other things,
that **Node here is v22.14.0 against a declared `engines.node` of `>=22.19.0`**
(`satisfiesDeclaredNodeEngine: false`) — that is the engines/CI floor item the brief
flags for Round 3, now measurable rather than asserted.

### 5. `test/unit/package/market-eval-probe.test.ts` — **adapted**

cae9 asserts `scripts["market:eval"] === "node scripts/market-eval-probe.mjs"`.
Two problems: `package.json` is R2-gpt-B's slot, and the brief tells gpt-B to add the
key as **`market-eval:probe`**, not `market:eval`. Porting cae9's assertion verbatim
would have pinned a key that by design will never exist and would have failed the gate
on another slot's work.

What I wrote instead is name-agnostic and still real: the probe file must exist, the
probe must run and its JSON must pin `pi.extensions === false`, `skills`/`prompts`
present, `private: true`, and ADR-006 `Proposed`; and *any* package script whose command
mentions `market-eval-probe` must be exactly `node scripts/market-eval-probe.mjs`, so a
rename cannot leave a dangling package entry. As of this writing no such script exists
yet (gpt-B's `package.json` edit was still in flight in the shared tree).

**For the parent:** once gpt-B lands the key, this can be tightened to an exact-name
pin in one line.

### 6. `test/unit/cli/readme-command-parity.test.ts` — **adapted**

The reason the USAGE export exists. cae9's version needs README content I am not
allowed to write: our README's `## Commands` table is missing rows for **`unblock`** and
**`help`**, and the README never mentions `--discard-executed`. cae9 also asserts a
README `--children` JSON example that uses `dependsOn` where ours still uses
`inputArtifactIds`.

I kept the whole parity mechanism (dispatch switch read from source, not from a list)
and every direction that is green today: USAGE covers all 19 dispatched verbs, the
README invents no verb, USAGE documents `unblock` / `--discard-executed` /
`inspect --follow` / `--idle-timeout-ms`, and the `--track` fragment is not duplicated.
For the one red direction I used a **self-cleaning** gap list: `KNOWN_UNDOCUMENTED_VERBS
= ["unblock", "help"]` is excluded from the missing-row check, and a final test fails if
either verb *gains* a row — so the row and the removal of the entry must land in the
same diff, and the list cannot outlive the gap. I dropped cae9's README `dependsOn`
example test entirely; it is a README-correctness claim, not command parity.

**Exact README patch for whoever owns README.md** (two rows in the `## Commands` table,
after the `pnpm cli inject` row, plus deleting the two entries from
`KNOWN_UNDOCUMENTED_VERBS`):

```
| `pnpm cli help` | Print the usage block. Every dispatched command has a row in this table and a line in that block — `test/unit/cli/readme-command-parity.test.ts` fails the build when a new verb has neither |
| `pnpm cli unblock --run <runId> --reason <text>` | The **only** thing that ends a `BLOCKED` run: records one `RUN_UNBLOCKED` naming the block it clears plus the operator's `--reason`, reopens the state the block left (`--retry-node <nodeId>` re-drives one FAILED flowchart node; a stall block takes no node), and executes nothing — `resume` then runs the reopened work. A stale or repeated unblock is refused, and so is a `--retry-node` that is not the failed node the block names |
| `pnpm cli unblock --run <runId> --reason <text> --retry-node <nodeId> --discard-executed` | The stronger authorization for the one case ordinary unblock refuses: a descendant of the failed node already executed. Records `RUN_UNBLOCKED_WITH_DISCARD` naming every superseded descendant, its prior state, the routes and child runs behind it, and their charged estimates. The set is computed under the run lock, never listed by the operator; the flag needs a gate block and its exact `--retry-node`, and is refused when nothing downstream executed. Events and evidence survive; the discarded nodes lose their outcome and go back to `PENDING`, and no budget is refunded |
```

cae9's README also gains a `### Follow a running run` section and an
`inspect --run --follow` table row (`git show 73e9677:README.md`, lines 64–120 of the
diff). Not mine to write; the CLI's own `help` fully describes the flag in the meantime.

## Not touched

`scripts/security-probe.mjs`, `src/feedback/`, `.github/`, `package.json`, `README.md`,
`docs/`, and every sibling-owned `.agent_workspace/*.md`. I did not touch
`docs/status-matrix.md`: nothing in the follow port needs a status-matrix note, since
`--follow` is an additive read-only flag on an existing command.

**Shared working tree note:** siblings were editing concurrently. At the time I applied
my first patch, `git status` already showed in-flight modifications to
`.github/workflows/ci.yml`, `package.json`, `scripts/security-probe.mjs`,
`src/cli/adapt.ts`, `src/adaptation/eval-routing.ts`, `src/cli/inspect-format.ts` and
several of their tests. I ran no destructive git command and edited only my eight files.

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx eslint` (my 7 code files) | clean |
| `test/unit/run/inspection.test.ts` | 26/26 pass (was 15 before the port) |
| `test/integration/cli/inspect-follow.test.ts` | 12/12 pass |
| `test/unit/package/market-eval-probe.test.ts` + `readme-command-parity.test.ts` | 10/10 pass |
| `test/unit/cli` + `test/integration/cli` | 262/262 pass |
| `node scripts/run-tests.mjs` (full suite) | **2120 pass, 0 fail, 1 skipped** (1590 top-level, 120 suites, 62.6s) |
| `node scripts/market-eval-probe.mjs` | exit 0 |

The full-suite run includes siblings' in-flight edits and was green with them.

## Recommendations for the parent

1. **Round 3 — `answer --message` correlation guard.** The one genuinely load-bearing
   thing left in `cae9` that I could not take. It is a fail-closed fix to a silent
   state-corruption path (`answer` exits 0 saying "Recorded" while stranding the run),
   and cae9 ships it with a 234-line integration test. It needs `main.ts`'s `answer`
   path, so it wants a slot that owns `main.ts` outright.
2. **README rows.** Two table rows and one `### Follow a running run` section close the
   last parity gap; the patch is quoted verbatim above and the test self-cleans.
3. **`market-eval:probe` wiring.** gpt-B's key, and then a one-line tightening of the
   probe test to an exact-name pin.
4. **Engines floor.** The probe now measures it: this VM is Node v22.14.0 against
   `>=22.19.0`. Worth deciding before the preview tag, not after.

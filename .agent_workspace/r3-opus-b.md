model: claude-opus-5-thinking-high-fast

# R3-opus-B — wire verification display + README parity

Branch `cursor/merge-preview-release-8011`. No commit, no push, no checkout.

## Verdict

`src/cli/inspect-format.ts` is now called. All four wiring hunks from my Round 2
patch landed unchanged, the unit tests exist, the integration test asserts the
new lines end-to-end, and `readme-command-parity` runs with an **empty**
allowlist.

Gate on my last run (with opus-A's redaction and gpt-A/gpt-B's changes already
in the worktree):

```console
$ pnpm typecheck   # exit 0
$ pnpm lint        # exit 0
$ pnpm test        # tests 2137, pass 2136, fail 0, skipped 1
$ pnpm build       # exit 0
$ node scripts/security-probe.mjs         # status ok, passed 16, no open/waived findings
$ node scripts/preview-release-probe.mjs  # status ok
```

The probe reads 16 passed, not Round 2's 14: opus-A's two new
screaming-snake samples are in the tree. That is their number to certify, not
mine — I only note it so nobody reads 16 as drift.

## 1. `main.ts` wiring (4 hunks, additive)

| Path | Change |
|---|---|
| import | `import { formatTaskResultLine, formatUnverifiedSummary } from "./inspect-format.js";` |
| `run --children` | `result:` line now `formatTaskResultLine(terminal)`; `unverified: N/M` printed after the children loop, before `adapt:` |
| `inspect --run` | same `result:` swap; `unverified: N/M` after the children block, before `question`/`answer` lines |
| `run --track` | one `inspectRun` call after the `learn:` line, `unverified: N/M` before `events:` |

Live output, `--executor` default fake:

```console
$ pnpm cli run --project P --objective "Ship it" --children children.json --state-root S
  children: 2
    run_bdde4813… (tsk_one): SUCCESS (1 attempt(s))
      result: SUCCESS verification=PASSED — fake child completed the task
      artifacts: art_fake-tsk_one
      evidence: evd_fake-tsk_one
    run_a429ce41… (tsk_two): SUCCESS (1 attempt(s))
      result: SUCCESS verification=PASSED — fake child completed the task
      …
  unverified: 0/2
  adapt: no actionable model-project issue

$ pnpm cli run --project P --objective "Add a health check" --track --assume-defaults --state-root S
  learn: no actionable model-project issue
  unverified: 0/4
  events: 35 -> …/events.jsonl
```

Four things I checked rather than assumed:

- **`--json` and `--summary-json` are untouched.** `inspect --json` returns
  before the human block; `--summary-json` still emits exactly the four frozen
  `INSPECT_SUMMARY` keys. There is a new integration test that parses every
  `--json` line as JSON so a future summary line cannot leak into the stream.
- **A childless run prints nothing.** `formatUnverifiedSummary` returns
  `undefined` on an empty list, so plain `run` and leaf child runs are
  byte-identical to before. Verified against the seven runs a `--track` +
  `--children` session leaves behind: only the two parent runs gained a line.
- **`--follow` and `--max-cost-usd` are intact.** `inspect --follow` returns
  from `followInspect` before the human children block, so the follow path is
  unchanged and prints no summary — same as `fc6058c`, which predates
  `--follow`. If the parent wants a summary on follow exit, that is a new
  decision, not a port.
- **The `--track` hunk costs one extra `inspectRun`.** It is a replay of an
  already-terminal run's log, after the run has settled, on a path that just
  finished a full cluster. I took it over threading children through
  `startTrackedRun`'s outcome, which would have widened a run-loop type for a
  display line.

## 2. `test/unit/cli/inspect-format.test.ts` (new)

`fc6058c`'s five tests ported verbatim, plus three of mine that pin what the
wiring depends on:

- `formatTaskResultLine` emits **no newline and no surrounding whitespace** —
  `main.ts` embeds it inside `      result: ${…}\n`, so a stray newline would
  silently break the indent of every following child line.
- `unverifiedTaskIds` **preserves children order** and does not sort or dedupe.
  The ids are read against the child list printed directly above them; a
  reordering would make the line unmatchable to its own output.
- A **PASSED verification on a FAILURE outcome** still reads as verified
  (`FAILURE verification=PASSED`, `unverified: 0/1`). Verification is about
  observation, not success; conflating the two would let an observed failure be
  reported as unverified, which is the exact misreading this display exists to
  prevent.

8 tests, all pass.

## 3. `test/integration/cli/cli.test.ts`

The `verification=` assertions from `fc6058c` were still missing. I added that
commit's `run --children and inspect print verification per TASK_RESULT and an
unverified summary` test verbatim (it asserts `result: SUCCESS
verification=PASSED — `, absence of `(unverified)`, and `^ {2}unverified: 0/2$`
in both `run` and `inspect` output), plus the `--json`-purity test described
above.

**Not taken from `fc6058c`, deliberately:**

- The two USAGE assertions in `the CLI entrypoint spawns end-to-end`
  (`/--supervised \(deprecated\)/` and `/compileChildrenToFlowchart/`). Both
  assert doc/behaviour changes this round explicitly excludes — the resume
  deprecation and the `--children`-is-the-flowchart-engine doc correction.
  Adding them would fail against the USAGE block as it stands.
- The rewrite of `supervised resume still refuses a flowchart checkpoint` into
  the deprecation-warning version. The existing test still passes and still
  asserts the refusal; only the deprecation copy is absent, and that copy is
  out of scope.

## 4. README rows + parity allowlist

Two rows added to the `## Commands` table:

- `pnpm cli help` — prints the usage block (same as `--help` / `-h`), and the
  row says the usage block, not the table, is the authoritative flag list.
- `pnpm cli unblock --run <runId> --reason <text>` — written against
  `unblockCommand` and the USAGE text rather than paraphrased: it records the
  authorization and reopens the state but **executes nothing** (`resume` runs
  the reopened work), `--retry-node` re-drives one FAILED node (a stall block
  takes no node), and `--discard-executed` is a separate authorization that
  requires the exact `--retry-node`, computes its discarded set under the run
  lock instead of taking a list, and refunds no budget.

`KNOWN_UNDOCUMENTED_VERBS` is now `[]`. I kept the constant and the
self-cleaning `the known-undocumented list records only verbs that really lack
a README row` test rather than deleting them: the parity assertions now run
with no exemptions, and the machinery is what makes a future entry expire on
its own. Two stale comments went with it — the header's "never got a README
row" and the unblock-usage test's "even while the README row is still missing".

All 7 parity tests pass, including `the README command table invents no verb
the CLI does not dispatch`, which is the direction that would have caught a
typo in either new row.

## Flagged, not taken

`fc6058c` also adds two assertions to `test/unit/run/inspection.test.ts`
pinning that `terminalResult.verification.kind` survives inspection — the exact
contract `formatUnverifiedSummary` reads. That file is in nobody's Round 3
Writes column (opus-A touched it in Round 2 for `--follow`), so I left it. My
integration test covers the same ground end-to-end, so this is a
belt-and-braces unit pin, not a gap: the parent can take it in a later pass
without re-testing anything.

## Files I wrote

- `src/cli/main.ts` (4 additive hunks; nothing else in the file changed)
- `test/unit/cli/inspect-format.test.ts` (new)
- `test/integration/cli/cli.test.ts` (2 tests appended)
- `README.md` (2 command-table rows)
- `test/unit/cli/readme-command-parity.test.ts` (allowlist emptied, 2 comments
  de-staled)
- `.agent_workspace/r3-opus-b.md` (this file)

Untouched, as instructed: `src/feedback/**`, `scripts/security-probe.mjs`,
`.github/workflows/ci.yml`, `package.json`, `docs/specs/release-gate.md`,
`src/run/inspection.ts`. No resume-deprecation hunk, no BLOCKED-gate doc hunk,
no status-matrix or release-gate edit from `fc6058c`.

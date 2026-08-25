# Loop 5 Round 3 — Fable-commits-ep: freeze-safe fix specs for E1 / I1 / C1+C2

Slot: Fable-commits-ep (claude-fable-5-thinking-xhigh). Specification only; no `src/`, `test/`, or
docs edits, no commit by this agent. Input: `loop5-r2-fable-aux.md` findings E1 (episode close
silent WAITING write), I1 (`inject` has no help surface), C1+C2 (`commits` error/JSON dialect).

Base re-verified at HEAD `07ffa00` (`docs(agent): record Loop 5 Round 2 closeout and Round 3
dispatch`). Since the R2 audit base `826a44a`, **none of the three target modules changed**
(`git diff 826a44a..07ffa00 -- src/cli/{episode,inject,commits,pause}.ts src/tools/decision-commit.ts`
is empty; the three relevant test files are also untouched). `src/cli/main.ts` did change (+131
lines: track-clarification reporting and a `missingRun` retarget onto `list`), which matters twice
below: it sets the house wording for run-not-found remedies (C1), and it is another reminder that
`main.ts` is contended (PR #12 also touches it — still OPEN, re-checked via `gh pr list`).

Every pin claim below was re-grepped at HEAD, not inherited from R2.

---

## 0. What "freeze-safe" means here (the gate each spec is written against)

From `loop5-r1-gpt-frozen.md` §3–4 and the D3 convention the Round 1 verbs established:

- No new `Event` type, no `EVENT_TYPES`/`validateEvent` edit, no `RunStatus`/episode-status change.
- `GENERIC_FAILURE_NEXT` and the five `DOCTOR_ROUTED_NEXT` tuples stay character-exact; no sixth route.
- `CliErrorReport` keeps exactly its keys (`ok`,`command`,`stage`,`message`,`next`,`runId?`,`taskId?`).
- Machine JSON surfaces are one compact line, carry a unique literal `type` plus `preview: true`,
  and get an exact-shape (`assert.deepEqual` on `JSON.parse`) pin the day they land; later fields
  are additive-only.
- Pinned USAGE fragments in `main.ts` (thinking levels, Google clamp, resume wrap, unblock lines,
  `adapt promote`, migrate/pref) are untouched; the blocked-next body's exact
  `next: pnpm cli inject --run … --type fact --key <key> --value <text> --state-root …` lines
  (`main.ts:499-503`) are pinned byte-exact by `test/integration/cli/blocked-next.test.ts:141,170,594`.
- Behavior a test pins deliberately (the E1 WAITING write; preview-creates-no-commits; the
  preview→`apply --file` round-trip) is contract: fixes must be additive around it.

All three specs below satisfy this gate; each carries its own pin audit.

---

## 1. E1 — episode close: disclose the WAITING write the refusal already makes

### Current behavior (verified at HEAD)

`src/cli/episode.ts:104-121`: when `episode close --status COMPLETED` is refused because
`decideClosure` returns `acceptance-incomplete` and the episode is not already WAITING, the command
appends a `WAITING_FOR_USER` snapshot and an `EPISODE_WAITING` event (`episode.ts:107-111`), then
prints `acceptance-incomplete: <ids>` and the structured failure report — and never mentions the
write. The write is a pinned contract (`test/integration/m3/episode-cli.test.ts:60-66` asserts the
WAITING snapshot and the `EPISODE_WAITING` tail event); the silence around it is the defect. The
only other `canClose:false` reason `decideClosure` can return is `already-closed`
(`src/episode/closure.ts:11-13`), which takes no write (the guard requires
`reason === "acceptance-incomplete"`).

### Fix specification

All edits in `src/cli/episode.ts`; no `main.ts` change needed.

1. **Disclosure line (required).** Inside the write branch, *after* both appends succeed (after
   `await events.append(waiting.event)` at line 110), add one stderr line:

   ```
   io.stderr(`note: recorded WAITING_FOR_USER for ${episodeId} — this refused close changed the episode status; it now names its missing evidence\n`);
   ```

   Placement after the appends means the line never claims a write that threw (a failed append
   still exits through the catch-all, honestly). Placement *inside* the
   `latest.status !== "WAITING_FOR_USER"` guard means a retried close against an already-WAITING
   episode does not falsely claim a second write. stderr, not stdout: this is the failure path and
   `episode close` has no stdout contract on failure (its `--json` flag is parsed-but-ignored — E7,
   explicitly out of scope here).
2. **USAGE sentence (required).** Append one prose line to the `USAGE` constant
   (`episode.ts:14-17`):

   ```
   A COMPLETED close refused for incomplete acceptance records WAITING_FOR_USER (one EPISODE_WAITING event) so the episode names the evidence it waits for; close FAILED/ABANDONED remains available.
   ```
3. **Optional rider (same diff, one line).** In the refusal path's `else` case (episode already
   WAITING), a symmetric `note: episode is already WAITING_FOR_USER; no new snapshot recorded\n`
   line. Cheap, but the required disclosure alone closes the honesty gap.

Do **not** widen the `cliFail` report: the existing
`next: "satisfy required evidence or close as FAILED/ABANDONED"` (`episode.ts:119`) already carries
the remedy, and `CliErrorReport` has no field for side-effect disclosure — adding one would be a
frozen-interface change this fix does not need.

### Pin and freeze audit

- `episode-cli.test.ts:61` matches `/acceptance-incomplete.*tests/` against `captured.err.join("")`
  — an additional stderr line passes trivially. No test anywhere matches `recorded WAITING`,
  `WAITING_FOR_USER for`, or the current USAGE text of `episode.ts` (grepped at HEAD: zero hits;
  the §4 USAGE census covers `main.ts` only, and `main-dispatch.test.ts` pins only the `list`/`init`
  lines).
- The write itself, its ordering (snapshot then event), and the exit code 1 are pinned and stay
  byte-identical. No event type is added; `EPISODE_WAITING` already exists and is already emitted
  on this path.
- No lock, store, or `closure.ts` change; `LOCK_TIMEOUT` doctor routing untouched.

### Tests at landing

Extend the existing refusal test (`episode-cli.test.ts:40-66`), don't fork it:
`assert.match(captured.err.join(""), /recorded WAITING_FOR_USER/)`. Add one new case: a second
`close --status COMPLETED` against the now-WAITING episode still exits 1, appends **no** second
snapshot (`snapshots.episodes.length` unchanged), and does not print the disclosure line
(`assert.doesNotMatch(..., /recorded WAITING_FOR_USER/)`) — this pins the guard, which today no
test exercises.

### Docs rider (optional, separable)

README row 171 (`pnpm cli episode events|close …`) gains one clause: "a refused COMPLETED close
records `WAITING_FOR_USER` so the episode names its missing evidence". Doc-only; note PR #12 also
edits README and ships a `readme-command-parity` test — land after #12 or reconcile on merge.
`main.ts:275`'s missing `[--outcome <id>]` (E4/G5) is a separate already-queued item; do not fold
it in here, it touches contended `main.ts`.

---

## 2. I1 — `inject --help`: give the CLI's most argument-dense verb a help surface

### Current behavior (verified at HEAD)

`src/cli/inject.ts` has no usage constant and no help check. `inject --help` throws inside strict
`parseArgs` (`inject.ts:21-33`, unknown option) and `inject help` throws on the unexpected
positional; both surface through `main.ts`'s catch-all (`main.ts:2243-2249`) as a generic failure
report with `GENERIC_FAILURE_NEXT` — an error report as the answer to a help request. Every other
multi-form verb prints usage. The only documentation is `main.ts:282`, whose placeholders G5
flagged as bare (`[--key] [--value] …`).

### Fix specification

All edits in `src/cli/inject.ts`, mirroring the shipped `list.ts:136-168` shape exactly:

1. **Usage constant:**

   ```ts
   const INJECT_USAGE = `pi-sparkle inject — record a typed fact/override/skip against a run's decision policy

   Usage:
     pi-sparkle inject --run <runId> --type fact --key <name> --value <json-scalar|text> [--actor <who>] [--state-root <dir>]
     pi-sparkle inject --run <runId> --type override --node <nodeId> --confidence <0-1> [--actor <who>] [--state-root <dir>]
     pi-sparkle inject --run <runId> --type skip --node <nodeId> [--actor <who>] [--state-root <dir>]

   --value parses as a JSON scalar when it is one (true, 42, "text"), otherwise as the bare string;
   objects, arrays, and null are refused. Values are recorded, never executed. Injection into a
   terminal or BLOCKED run fails closed; success echoes the resulting facts/nodes snapshot.
   `;
   ```

   Wording is non-contractual (nothing pins it); the semantics lines restate what
   `parseFactValue` (`src/run/injection.ts:52-67`) and the pinned terminal-refusal behavior
   (`test/integration/cli/pause-inject.test.ts:235-276`) already do — no new claims.
2. **Positional help check before `parseArgs`** (exactly `list.ts:137-141`): if `args[0]` is
   `help`, `--help`, or `-h`, print `INJECT_USAGE` to **stdout** and return `CLI_EXIT.ok`.
3. **`help` boolean option** (`help: { type: "boolean", short: "h", default: false }`) in the
   `parseArgs` options, with the post-parse `values.help === true` → usage/exit-0 check
   (`list.ts:165-168`), so `inject --run X --help` also answers instead of failing.
4. **`try/catch` around `parseArgs`** → `cliFail` with `command: "inject"`,
   `stage: "parse-args"`, the thrown message, and `next: "run pi-sparkle inject --help"`
   (`list.ts:143-163` shape). This turns a typo'd flag from a catch-all generic report into a
   parse-stage report that points at the help that now exists.
5. **Rider, same diff (recommended — R2 batched them as one finding):** the identical four steps
   for `src/cli/pause.ts` with

   ```
   pi-sparkle pause — write a pause token for a live run

   Usage:
     pi-sparkle pause --run <runId> [--reason <text>] [--state-root <dir>]
     pi-sparkle pause --clear --run <runId> [--state-root <dir>]
   ```

   Separable if the parent wants I1 minimal.

**Explicitly out of this fix:** the G5 placeholder repair on `main.ts:280-282`
(`[--key <name>] [--value <json|text>] …`, `[--state-root <dir>]`). It is freeze-safe in itself —
the pinned `main.ts` fragments are elsewhere, and the byte-pinned inject remedy lines are
`main.ts:499-503`, *not* the USAGE line — but it edits contended `main.ts` (PR #12) for cosmetic
gain and belongs in the queued G5 batch. The verb-level help above works without it.

### Pin and freeze audit

- Zero tests match any `inject`/`pause` usage text, `INJECT_USAGE`, `PAUSE_USAGE`, or the current
  catch-all output for `inject --help` (grepped at HEAD). The behavior change (error report →
  usage, exit 1 → 0 for `--help`) is unpinned in both directions.
- `pause-inject.test.ts` pins are untouched: the unknown `--type eval` case (`:225-231`) is not a
  parse error (it fails inside `injectFlowchartRun`) and keeps its catch-all path; terminal/BLOCKED
  refusals don't involve `parseArgs`.
- `blocked-next.test.ts`'s byte-exact inject remedy lines live in `main.ts` and are not edited.
- `GENERIC_FAILURE_NEXT` is not edited; it simply stops being the answer to a help request.
- No new import into `main.ts`; the live import closure is unchanged (no adaptation/topology
  modules touched — §3 live-boundary rules hold vacuously).

### Tests at landing

Model on `validate.test.ts:328` ("validate --help prints its usage and exits 0"): `inject --help`
and `inject help` → exit 0, usage on stdout, `assert.deepEqual(err, [])`; one malformed-flag case
(`inject --run x --typ fact`) → exit 1, `parseCliErrorJson` yields `command: "inject"`,
`stage: "parse-args"`, `next` mentioning `inject --help`. Same trio for `pause` if the rider lands.

---

## 3. C1+C2 — `commits`: one error dialect, one typed machine surface

### Current behavior (verified at HEAD)

**C1.** `src/cli/commits.ts` speaks two error dialects split mid-verb. Raw stderr + `return 1`
(no `next:`, no JSON object, `parseCliErrorJson` returns nothing): missing `--run` in preview
(`:128-129`) and apply (`:155-156`), run-not-found (`:46-47` in `loadCommitInput`), bare `commits`
(`:191-193`), unknown subcommand (`:195-197`). Thrown `DomainValidationError` through the catch-all
(full structured report): missing checkpoint (`:51`), empty node selection (`:69`), bad `--file`
(via `parseDecisionCommitFile`), missing/non-git repo (`:165,169`). Whether a `commits` failure is
machine-readable depends on which half of the function it happened in.

**C2.** `commits preview --json` prints `JSON.stringify({ commits }, null, 2)` (`:135`) —
pretty-printed, no `type`, no `preview`. It predates the D3 convention; it and `INIT_EXAMPLES` are
the last two machine surfaces off-convention.

### Fix specification — C1 (all edits in `src/cli/commits.ts`)

Convert the five raw-stderr sites to `cliFail` (import `CLI_EXIT, cliFail` from `./errors.js`;
`CommitsIo` already satisfies `CliErrorIo`). Exit codes stay 1 throughout (`cliFail` returns
`CLI_EXIT.error`). Thrown `DomainValidationError`s stay thrown — they already exit structured
through the catch-all, and localizing them would change working behavior for no dialect gain.

| Site | `stage` | `message` (current text, kept) | `next` |
|---|---|---|---|
| preview missing `--run` (`:128`) | `parse-args` | `commits preview requires --run <runId>` | `pass --run <runId>` |
| apply missing `--run` (`:155`) | `parse-args` | `commits apply requires --run <runId>` | `pass --run <runId>` |
| run-not-found (`:46`) | `lookup` | `Run ${runId} not found under ${stateRoot}` | `check --state-root, then pnpm cli list --state-root ${stateRoot} for the run ids that exist there` — plus `runId` in the report |
| bare `commits` (`:191`) | `parse-args` | `commits requires a subcommand: preview or apply` | `use commits preview or commits apply` |
| unknown subcommand (`:195`) | `parse-args` | `Unknown commits command: ${sub}` | `use commits preview or commits apply` |

Details that matter:

- The run-not-found `next` copies the wording `missingRun` landed in `main.ts:514-521` since R2 —
  this is now the house remedy and it closes C3 (run-not-found had no remedy at all) in the same
  diff. **Copy the string; do not import `missingRun` from `main.ts`** — `main.ts` imports
  `commitsCommand`, so that import is a cycle, the exact shape `loop5-r1-gpt-frozen.md` §2 banned
  for `validate`. `loadCommitInput` already receives `stateRoot` and `io`; it needs no signature
  change beyond using `cliFail` before returning `undefined`.
- Keep the `io.stderr(COMMITS_USAGE)` print before `cliFail` on the bare/unknown-subcommand paths
  (the `episode.ts:71-78` precedent): usage stays visible, the structured report is appended after
  it. `parseCliErrorJson` scans stderr lines in reverse for the JSON object, so order is safe.
- Optional rider (recommended for symmetry with I1): `try/catch` around the two `parseArgs` calls
  → `cliFail` `stage: "parse-args"`, `next: "run pi-sparkle commits --help"`. Today those throws
  already exit structured via the catch-all (as `stage: "execute"`), so this is attribution polish,
  not a dialect fix; drop it if the diff should stay minimal.

### Fix specification — C2 (one line plus pins)

`commits.ts:134-136` becomes one compact typed line:

```ts
if (values.json === true) {
  io.stdout(`${JSON.stringify({ type: "COMMITS_PREVIEW", preview: true, commits: proposals })}\n`);
  return 0;
}
```

- `preview: true` here is the same key `RUN_LIST`/`EPISODE_LIST`/`VALIDATE_OK` carry, meaning
  *developer-preview contract*, not "the preview subcommand" — worth one sentence in the pin
  test's name or a comment so the collision with the verb name doesn't confuse the next reader.
- `COMMITS_PREVIEW` is a CLI view object, **not** an `Event`: it must not join `EVENT_TYPES` or
  `validateEvent` (same rule `RUN_LIST` landed under).
- Round-trip safety, verified both directions at HEAD: `parseDecisionCommitFile` requires only
  `isRecord(parsed) && Array.isArray(parsed.commits)` and ignores extra top-level keys
  (`src/tools/decision-commit.ts:267-272`), so **new** preview files (with `type`/`preview`) apply
  cleanly, and **old** hand-edited untyped `{ "commits": [...] }` files keep applying. No
  `decision-commit.ts` change.
- One USAGE sentence in `COMMITS_USAGE`: "`preview --json` prints one `COMMITS_PREVIEW` object;
  `apply --file` accepts that output, with or without the `type`/`preview` keys."

### Pin and freeze audit

- No test pins any of the five raw stderr strings (grepped at HEAD; `commits.test.ts`'s only loose
  stderr match is `/git|work tree|not a git/i` on the *thrown* no-repo path, untouched).
- `commits.test.ts:118` parses `--json` output with `JSON.parse` and reads only `.commits` — the
  compact retype passes as-is; the round-trip test (`:109-164`) feeds the new output straight to
  `apply --file`, which the `parseDecisionCommitFile` tolerance covers. The happy-path
  `assert.deepEqual(err, [])` (`:105`) is a success-path pin; no failure path gains stdout output.
- `preview` provably creating no commits (`:177-189`) is behaviorally untouched.
- `COMMITS_PREVIEW` appears nowhere in `src/`, `test/`, or `docs/` today (grepped) — the literal is
  free. `CliErrorReport` gains no keys.
- gpt-frozen §1's "no `package.json`/lockfile edit", §3's doctor/inspect freezes: untouched.

### Tests at landing

Per D3, the retype must land with its day-one exact-shape pin (model: `validate.test.ts:286-326`):
`--json` prints exactly one line; `assert.deepEqual(JSON.parse(line), { type: "COMMITS_PREVIEW",
preview: true, commits: [ …exact proposal shape… ] })` using the deterministic
`tinyCompletedRun` fixture (fixed ids/timestamps make the full deepEqual feasible). Add: one legacy
tolerance case — hand-write an untyped `{ "commits": [...] }` file, `apply --file` succeeds — so
the old-file contract survives future refactors. For C1: `parseCliErrorJson`-based assertions on
missing `--run` (`stage: "parse-args"`), run-not-found (`stage: "lookup"`, `runId` present, `next`
matches `/pnpm cli list/`), and unknown subcommand.

### Docs rider (optional, separable)

README row 174 gains "`preview --json` is one frozen-additive `COMMITS_PREVIEW` object". The
missing `commits` status-matrix row (C5) stays with the R2 §3 docs batch — do not couple it here.
R2 recommended landing C2 in the same slot as the `INIT_EXAMPLES` compaction; that coupling is
still sensible but not required — this spec stands alone if the init slot slips.

---

## 4. Landing order, collisions, and the verification gate

**Order within this batch:** the three fixes are file-disjoint (`episode.ts` / `inject.ts`(+`pause.ts`)
/ `commits.ts`) and can land as one commit each or one combined commit; nothing sequences them
against each other. None requires a `main.ts`, `package.json`, docs, or CI edit.

**Collisions:** PR #12 (OPEN) touches `main.ts`, README, `ci.yml`, `docs/status-matrix.md`,
`cli-children.test.ts` — the core fixes above touch none of those, which is why the G5 placeholder
repair and both README riders are explicitly split out as separable. Land the riders after #12 or
reconcile at merge.

**Verification gate at landing** (beyond the new tests specified per item):
`test/integration/m3/episode-cli.test.ts`, `test/integration/cli/commits.test.ts`,
`test/integration/cli/pause-inject.test.ts`, `test/integration/cli/blocked-next.test.ts` (byte
pins on the inject remedy lines), `test/unit/cli/main-dispatch.test.ts`,
`test/integration/cli/cli.test.ts` (unknown-command stderr consumer),
`test/unit/cli/doctor-routed-next-freeze.test.ts` (proves no routed-next drift), then typecheck,
lint, and the full `pnpm test` gate. A red freeze pin is a design stop, not an expected-file
update.

**Explicit non-changes carried forward from R2:** the E1 WAITING write itself (pinned, designed);
E6 lock-wait parity; E7 `close --json` (refuse-or-document is one line but belongs to the G7
exit-code/usage-stream normalization, not here); C4 partial-apply disclosure (separate one-liner);
I2 inject not-found preflight (fold into the G6 batch that `missingRun` just started); I3 inject
crash-loss semantics (deliberate, documented in source).

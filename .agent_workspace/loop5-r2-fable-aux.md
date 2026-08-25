# Loop 5 Round 2 — Fable-aux-cli: episode/inject/commits UX · Windows smoke coverage · status-matrix rows

Slot: Fable-aux-cli (claude-fable-5-thinking-xhigh). Analysis only; no src/test/docs edits, no commit.
Base: `cursor/pi-sparkle-sota-opt-0da8` @ `826a44a` (Round 1 closed; working tree clean apart from
`loop5-r1-review.md` untracked). Scope per brief: the three verbs Round 1 inventoried but never
UX-audited (`episode`, `inject`, `commits`), whether CI's Windows `cli-smoke` exercises
`list`/`validate`/`init`, and the status-matrix rows the review's §1 flagged as missing.

Verification method: direct reads of `src/cli/episode.ts`, `inject.ts`, `commits.ts`, `pause.ts`,
`main.ts` (USAGE + dispatch + catch-all), `src/run/injection.ts`, `flowchart-run.ts`
(`injectFlowchartRun`/`restoreFlowchartSession`), `src/tools/decision-commit.ts`,
`src/persist/file-lock.ts`, `.github/workflows/ci.yml`, `scripts/run-tests.mjs`,
`docs/status-matrix.md`, the five relevant test files, and pin greps across `test/` for every string
a recommendation below would change. PR #12's file list re-checked via `gh` (still OPEN; touches
`ci.yml`, `docs/status-matrix.md`, README, `main.ts`, `cli-children.test.ts` — all collision-relevant
here).

---

## 1. `episode` / `inject` / `commits` UX audit

### 1.1 `episode` (`src/cli/episode.ts`)

What is right: `cliFail` on every arg/lookup/close failure; `events --json` is a pure NDJSON event
stream (consistent with `inspect --run --json`); COMPLETED close is acceptance-gated through the
shipped `decideClosure`; a stranded WAITING episode can still be closed FAILED/ABANDONED
(`episode.ts:122`) — the escape hatch exists. Close runs under the same `<epId>.lock` delete uses,
and a lock timeout throws the frozen `LOCK_TIMEOUT`, which the catch-all doctor-routes correctly.

Findings, ranked:

**E1 (P1) — a refused COMPLETED close writes state and never says so.** When acceptance is
incomplete and the episode is not already WAITING, the *failing* close appends a WAITING_FOR_USER
snapshot plus an `EPISODE_WAITING` event before reporting failure (`episode.ts:107-111`). The write
is deliberate and pinned (`test/integration/m3/episode-cli.test.ts:40-66` asserts the recorded
WAITING), but nothing operator-visible discloses it: stderr shows only
`acceptance-incomplete: tests` plus the error report, and neither `episode.ts` USAGE nor the README
row mentions that a refused close transitions the episode. An operator who retries `close` after
fixing evidence will find the episode in a status they never asked for and no message explains.
Fix shape: one additive stderr line (`recorded WAITING_FOR_USER for <epId>`) inside the refusal
branch plus one USAGE sentence. Pin-safe: the test matches `/acceptance-incomplete.*tests/` on the
joined stderr, so an additional line passes; the write itself must stay (it is the pinned contract).

**E2 (P1) — not-found remedies still pre-`list`.** `episode events` not-found says
`next: "inspect --run first to get a bound episode id"` (`episode.ts:60`) and `close` not-found says
`next: "inspect --run to find a bound episode id"` (`episode.ts:100`) — both require a run id the
operator equally lacks. `list --episodes` shipped in Round 1 and is the correct retarget. Verified
unpinned: no test matches either string (grep across `test/`). This is the episode half of R1 review
§5.5's G6 batch; reinforce, don't re-scope.

**E3 (P2) — bare `episode` is the only group verb that puts usage on stdout while failing.**
`episode` with no subcommand prints USAGE to **stdout** and exits 1 (`episode.ts:39-41`); bare
`commits` prints usage to **stderr** and exits 1; bare `auth`/`models`/`pref` print usage and exit
0; bare `adapt` stderr + exit 1. G7 (R1) recorded the exit-code split; the stdout-on-failure wrinkle
is new. Any script piping `episode` stdout gets usage text on the failure path. If the G4/G7 batch
lands, normalize this then; not worth its own slot.

**E4 (confirmed still open) — USAGE drift.** `main.ts:269` still omits `[--outcome <id>]`, which
`episode close` accepts and records (`episode.ts:16, 33, 131`); the verb's own USAGE has it. Part of
the G5 remainder already queued.

**E5 (P2, one line) — `episode events` swallows a truncated tail.** `EpisodeEventStore.readAll()`
returns `recovery` and `inspect --episode` warns through `warnTruncatedJsonl`
(`main.ts:988-996, 1011`), but `episodeCommand` discards it (`episode.ts:54`). The same log, read by
two verbs, warns in one and not the other. The warning helper and its exact shape already exist.

**E6 (defer) — no `--lock-wait-ms` on `episode close`.** Close waits the `withExclusiveFileLock`
default 5 s (`file-lock.ts:45`) with no override, while both `delete` targets and `pref` mutations
take `--lock-wait-ms`. The timeout is doctor-routed, so posture is honest; parity is nice-to-have
only if a lock-flags batch happens anyway.

**E7 (trivial) — `episode close --json` silently ignored.** `json` is parsed for both subcommands
(`episode.ts:35`) but only `events` reads it. Refuse or document; either is one line.

### 1.2 `inject` (`src/cli/inject.ts`)

What is right: all four arg refusals are `cliFail` with per-type guidance (fact→key/value,
override/skip→node, override→confidence); user strings become typed facts via `parseFactValue`
(JSON scalar or bare string — objects/arrays refused, `injection.ts:52-67`); a NaN `--confidence`
is refused by `validateConfidenceScore` with a clear message rather than recorded; the success
output echoes the resulting facts/nodes snapshot — genuinely good operator feedback; injection into
terminal/BLOCKED runs fails closed (pinned in `test/integration/cli/pause-inject.test.ts`).

Findings, ranked:

**I1 (P1) — `inject` has no help surface at all, and neither does `pause`.** There is no
`INJECT_USAGE` constant; `inject --help` throws inside `parseArgs` (unknown option) and surfaces as
a *generic failure report* through the catch-all, and `inject help` throws on the positional. Same
for `pause` (`pause.ts:21-29`). Every other multi-form verb (`episode`, `commits`, `list`,
`validate`, `init`, `adapt`, `auth`, `models`) prints usage. The only documentation for the CLI's
most argument-dense verb is the top-level USAGE line — which is exactly the line G5 flagged for
showing `[--key] [--value] [--node] [--confidence] [--actor]` without placeholders
(`main.ts:276`). An operator asking the tool how to use `inject` gets an error report instead of an
answer. Fix shape: an `INJECT_USAGE`/`PAUSE_USAGE` constant + a help check before `parseArgs`,
mirroring `list.ts:138-141`; plus the G5 placeholder fixes on lines 274-276. Unpinned (no test
greps inject/pause usage text).

**I2 (P2) — not-found and wrong-plane errors are thrown, generic, and flowchart-voiced.** A
missing run reaches `restoreFlowchartSession`'s throw (`flowchart-run.ts:1780`) and exits through
the catch-all with `GENERIC_FAILURE_NEXT` — no `list` retarget (contrast `pause`, which preflights
the event log and `cliFail`s with a lookup stage, `pause.ts:50-58`). A plain M0/supervised run gets
`Flowchart run <id> has no durable checkpoint; refusing to invent state` or `…missing flowchart
snapshot` — "Flowchart run" naming a run that is not one is the same flowchart-only voice
Fable-runtime F8 recorded for `pause`; treat them as one batch. Cheap alignment: give `inject` the
same event-log preflight `pause` has (read → `cliFail` lookup with `runId`), leaving deeper plane
errors to the throw path.

**I3 (note, no action) — injection loss on crash is documented only in a source comment.**
`injectFlowchartRun`'s checkpoint-failure path preserves resumable state and the log keeps
`INJECTION_REQUESTED`, but a resume rebuilds from the checkpoint and never replays it
(`flowchart-run.ts:1905-1913`). Internal crash semantics, deliberately chosen; recording it here so
the next auditor doesn't rediscover it as a bug.

### 1.3 `commits` (`src/cli/commits.ts`)

What is right: preview/apply is a real dry-run split and `preview` provably creates no commits
(pinned, `commits.test.ts:177-189`); `apply` refuses a non-work-tree with git's own detail; the
`--file` round-trip into a real repo is integration-pinned; `--repo` defaults to the checkpoint's
`project.rootPath`; `spawnSync("git", …, { windowsHide: true })` is Windows-correct.

Findings, ranked:

**C1 (P1, the G4 concretization) — one verb, two error dialects, split mid-surface.** Arg errors,
run-not-found, and unknown-subcommand are raw stderr + `return 1` (`commits.ts:46, 128, 154,
191-197`): no `next:`, no JSON object, `parseCliErrorJson` returns nothing. But missing checkpoint,
no completed nodes, bad `--file`, and non-git-repo are **thrown** `DomainValidationError`s that exit
through the catch-all with a full structured report. So whether a `commits` failure is
machine-readable depends on which half of the function it happened in. Pin audit done for the
unification: `commits.test.ts` matches loosely (`/git|work tree|not a git/i`) and parses JSON output
with `JSON.parse`; no test pins the raw stderr strings byte-exact. `commits` is therefore the
safest first target of the G4 `cliFail` batch.

**C2 (P1, same clock as INIT_EXAMPLES) — `commits preview --json` is pretty-printed and untyped.**
`JSON.stringify({ commits }, null, 2)` (`commits.ts:135`) with no `type`/`preview` keys — it
predates the D3 day-one convention every Loop 5 surface follows. Two facts make fixing it cheap and
safe now: `parseDecisionCommitFile` requires only `isRecord(parsed) && Array.isArray(parsed.commits)`
(`decision-commit.ts:267`), so adding `type: "COMMITS_PREVIEW", preview: true` keeps the
preview→`apply --file` round-trip working on old *and* new files; and the test pins are
`JSON.parse`-based, so compacting is pin-safe. Recommend doing it in the same slot as the
`INIT_EXAMPLES` compaction (R1 review §2.3) — one "machine surfaces are one compact typed line"
diff, with exact-shape pins added at landing per D3.

**C3 (P2) — run-not-found has no remedy at all.** `Run <id> not found under <root>`
(`commits.ts:46`) — not even a circular one. Joins the E2/G6 `list` retarget batch.

**C4 (P2) — partial apply is undisclosed.** `apply` commits sequentially and returns 1 at the first
git failure (`commits.ts:171-174`); already-made commits stay (correct — they are real commits) and
each success printed `Committed …`, so the evidence is on screen, but nothing states "applied N of
M; the remainder was not attempted". One trailing stderr line on the failure path, or one USAGE
sentence. Low.

**C5 (docs) — `commits` has no status-matrix row** (pre-existing, not a Loop 5 regression) — see §3.

---

## 2. Does CI's Windows `cli-smoke` exercise `list`/`validate`/`init`? — No.

### 2.1 What the workflow actually runs

`.github/workflows/ci.yml` has two jobs. `quality` (typecheck/lint/full `pnpm test`/build) runs on
**ubuntu-latest only** (`ci.yml:10-11`). `cli-smoke` runs on both `ubuntu-latest` and
`windows-latest` (`ci.yml:47-49`) and executes exactly two steps beyond setup:

- `pnpm cli version && pnpm cli help` (`ci.yml:70-71`)
- `pnpm test -- test/integration/m1/cli-children.test.ts test/unit/cli/doctor.test.ts` (`ci.yml:73-74`)

Neither step invokes `list`, `validate`, or `init`, and neither named test file touches them. The
entire Windows exposure of the three new verbs is their USAGE lines scrolling past inside
`pnpm cli help`. `list.test.ts`, `validate.test.ts`, `init-examples.test.ts`,
`main-dispatch.test.ts`, and `inventory.test.ts` run only in the Linux `quality` job. The R1 review
§4 hedge ("likely fine, unverified") stands: nothing executes the new verbs' path handling on
Windows.

### 2.2 The source is Windows-clean; two of the four test files are not

Source audit: `list`/`inventory` build every path with `join` (`inventory.ts:77, 91, 132, 147`);
`init` uses `resolve` and writes utf8 (`init-examples.ts:125-126, 144`); `validate` reads
CLI-supplied paths and `homedir()`-based defaults; `episode`/`commits` are `join`-based and
`commits` spawns git with `windowsHide`. No POSIX-only constructs anywhere in the five command
modules. The risk is not the code — it is that nothing proves it, and the proof artifacts
themselves have two portability defects worth recording before anyone naively adds them to the
Windows matrix:

1. **`validate.test.ts` redirects `HOME`, which Windows ignores.** The no-write guard sets
   `process.env.HOME` to an empty temp dir (`validate.test.ts:72-73`), but `os.homedir()` on
   Windows reads `USERPROFILE`, so on Windows the guard proves nothing (the temp dir trivially
   stays empty while the real profile dir is the actual default root). Worse, the default-root
   prose test builds `new RegExp` from `join(process.env.HOME, ".pi-sparkle")`
   (`validate.test.ts:225`) — on Windows the CLI would print the `USERPROFILE` path, not the temp
   HOME, and the unescaped backslashes corrupt the pattern besides. **This file fails on Windows
   as written.** Fix: set both `HOME` and `USERPROFILE`, and compare with `includes()` or an
   escaped literal.
2. **`init-examples.test.ts`'s byte-identity pin is at the mercy of autocrlf.** The repo has **no
   `.gitattributes`**, and `windows-latest` runners ship git with `core.autocrlf=true`, so a
   Windows checkout converts `examples/*.json` to CRLF while the embedded constants are LF —
   the `examples/` ≡ constants pin (`init-examples.test.ts:100-105`) fails on Windows. Fix: a
   `.gitattributes` declaring `*.json text eol=lf` (or `* -text`). New file, no D3 conflict, and
   PR #12 does not add one (verified against its file list).
3. `list.test.ts`, `inventory.test.ts`, and `main-dispatch.test.ts` are temp-dir/`join`-based with
   no env or platform assumptions — portable as-is.

### 2.3 Recommendation: smoke the verbs directly; it is two lines and dodges both defects

The highest-value change is not porting test files — it is extending the existing smoke step with
direct invocations, which is what "smoke" means here and what actually exercises Windows
`resolve`/`join`/`homedir` end-to-end through the real CLI entry:

```yaml
- name: New-verb smoke (init, validate, list)
  run: |
    pnpm cli init --dir smoke-examples --json
    pnpm cli validate --children smoke-examples/sparkle-children.example.json
    pnpm cli validate --flowchart smoke-examples/sparkle-flowchart.example.json --state-root .sparkle-smoke-state
    pnpm cli list --state-root .sparkle-smoke-state --json
```

Properties: writes only a scratch dir in the workspace; `validate --flowchart` against a fresh
state root checks the example against the default cheap/premium catalog (which the example uses,
so it passes deterministically); `list` on a fresh root prints the empty `RUN_LIST` object, exit 0
(`inventory.ts:83` treats a missing runs dir as empty); and the chain incidentally exercises the
shipped `init → validate` `next:` handoff for real. Optionally add
`test/unit/cli/main-dispatch.test.ts` and `test/unit/cli/list.test.ts` to the smoke test step —
both portable today. Do **not** add `validate.test.ts` / `init-examples.test.ts` to Windows until
§2.2 items 1-2 are fixed; fixing them is worthwhile independent of CI (a test that silently proves
nothing on one OS is a latent honesty gap in its own name).

**Sequencing constraint:** PR #12 (OPEN) edits `.github/workflows/ci.yml` *and*
`test/integration/m1/cli-children.test.ts` (one of the two smoke files). Any `ci.yml` edit from
this campaign should land after #12 merges or be reconciled by whoever merges second — same
supervision posture the R1 review set for `main.ts`/README.

---

## 3. Status-matrix rows for the new verbs — confirmed missing; proposed text

Confirmed at `826a44a`: `docs/status-matrix.md` contains zero occurrences of `list`, `validate`
(as a verb), or `init`; its newest census note is still Loop 4 Round 15. Also absent: any `commits`
row (pre-existing — the verb shipped before Loop 5 and was never matrixed); `episode close`/
`events`, `inject`, and `pause` appear only inside other rows' notes, which is defensible (they are
facets of the runtime rows) but `commits` is a standalone operator workflow with its own tests and
deserves a row. Proposed rows for the **Runtime line** table, written to ADR-004's column
definitions:

| Capability | Present | Wired | Exercised | Outcome-supported | Notes |
|---|---|---|---|---|---|
| `list` (runs + episodes) | yes | yes | unit (`test/unit/cli/list.test.ts`, `test/unit/run/inventory.test.ts`) + dispatch pin (`test/unit/cli/main-dispatch.test.ts`); Linux CI only — the Windows smoke job does not run these | no | Read-only inventory: replays every `runtime/runs/<id>/events.jsonl` through the shipped `replayRun` (all eight `RunStatus` values) and reads each episode's latest validated snapshot. Ordered by id (documented in its USAGE); unreadable records are counted on stderr and listed in `errors[]` while exit stays 0. `--json` prints one frozen-additive `RUN_LIST`/`EPISODE_LIST` object (`preview: true`, not a domain `Event`). Doctor's PLANNING/RUNNING-only crash inventory is unchanged and serves a different purpose. |
| `validate` (children + flowchart) | yes | yes | unit (`test/unit/cli/validate.test.ts`) incl. a no-write guard and `VALIDATE_OK` exact-shape pins; Linux CI only | no | Runs the same decoders as `run`: `parseChildSpec` + `compileChildrenToFlowchart` for `--children` (default cheap/premium compile policy; no catalog check, stated honestly), and the flowchart validator plus the **live** catalog built from `--state-root` for `--flowchart` (same check `run --flowchart` applies, since `42b4c6c`). Creates no run, writes nothing, opens no provider connection. Success `--json` is one frozen-additive `VALIDATE_OK` object; failure prints only the stderr error report. |
| `init` examples | yes | yes | unit (`test/unit/cli/init-examples.test.ts`) incl. `examples/` byte-identity pin; Linux CI only | no | Writes `sparkle-children.example.json` + `sparkle-flowchart.example.json` from embedded source constants (packed installs ship `dist` only — the D6 KEEP rationale); repo `examples/` holds the same bytes for checkout readers. Checks both targets before writing either; refuses overwrite without `--force`; reads and writes no state root. `--json` prints `INIT_EXAMPLES` (currently the CLI's only pretty-printed machine object — compaction pending per R1 review §2.3). Not a project cookiecutter (D6). |

Ride-along candidate (same diff or the next docs slot): a `commits` row — Present yes / Wired yes /
Exercised `test/integration/cli/commits.test.ts` + `test/unit/tools/decision-commit.test.ts` / no —
noting the preview/apply split, `--allow-empty` git writes, checkpoint-derived `--repo` default,
and (until C1/C2 land) the raw-stderr dialect and untyped pretty `--json`.

The "Linux CI only" clause in the Exercised column is deliberate: this matrix's whole ethos is that
Exercised states where the proof ran, and §2 shows the Windows leg currently proves nothing about
these verbs. Drop the clause in the same diff that lands §2.3's smoke lines.

**Sequencing constraint:** PR #12 also edits `docs/status-matrix.md`; same merge-order care as
`ci.yml`. Note #12 additionally ships `readme-command-parity.test.ts` — README rows for the three
verbs already exist (`3bfdc65`), so parity should hold post-merge; the matrix has no such test, so
these rows rely on review discipline.

---

## 4. Pin/freeze audit for everything recommended above

Verified against `test/` at HEAD:

1. `episode.ts` remedy strings (`:60`, `:100`), `inject`'s absence-of-usage, `pause.ts:55`, and all
   `commits.ts` raw stderr strings are **unpinned** — no test matches any of them (grep for the
   exact fragments returned nothing; `commits.test.ts` uses loose `/git|work tree|not a git/i`).
2. `episode-cli.test.ts:60-66` **pins the E1 write** (refused close records WAITING + the
   `/acceptance-incomplete.*tests/` stderr match). The disclosure line must be additive; the write
   must stay.
3. `commits.test.ts` parses `--json` with `JSON.parse` and round-trips it through `apply --file`;
   `parseDecisionCommitFile` tolerates extra top-level keys — C2's compact+typed change is safe on
   both sides, but needs new exact-shape pins at landing per D3.
4. New help paths in `inject`/`pause` and new smoke steps touch nothing the §4 source-pin tests
   (blocked-next body heuristics, doctor-routed constants, four-executor pin) parse; no
   `main.ts` edits are required for any §1 fix except the G5 USAGE placeholder lines, which sit
   outside every pinned fragment (re-verified: the pinned fragments are the thinking-levels wrap,
   Google-clamp sentence, resume wrap, unblock lines, `adapt promote` line, migrate/pref lines).
5. `LOCK_TIMEOUT` from `episode close` already routes through `DOCTOR_ROUTED_NEXT` (frozen, five
   routes) — nothing here adds a sixth route.

---

## 5. Ranked recommendations to the parent

1. **Windows smoke for the new verbs** (§2.3): extend `cli-smoke` with the four direct invocations
   (+ optionally `main-dispatch.test.ts`/`list.test.ts` in the test step). Two-line diff, closes the
   only "nothing establishes Windows behavior" gap the R1 review left open. Sequence after PR #12's
   `ci.yml` merge.
2. **Status-matrix rows** (§3): land the three rows (text supplied) with the honest "Linux CI only"
   Exercised clause, `commits` row as ride-along; sequence against PR #12's matrix edit.
3. **Test portability honesty pair** (§2.2): fix `validate.test.ts`'s `HOME`→`USERPROFILE` blind
   spot and add `.gitattributes` for the `init` byte pin. Small, and item 1's test-step option is
   blocked without it.
4. **episode/inject/commits UX batch** (§1): E1 disclosure line + E4 USAGE `[--outcome]`; I1
   help paths for `inject`/`pause` + G5 placeholders; E2/C3 (+I2 preflight) not-found retargets onto
   `list` — fold into the already-queued G6 batch; E5 truncation warning. All verified unpinned or
   additive.
5. **C1+C2 as the G4 opener**: unify `commits` on `cliFail` and make its `--json` compact and typed
   in the same diff as the `INIT_EXAMPLES` compaction — the two remaining pretty-printed/untyped
   machine surfaces, both pin-safe today, both on the "before external scripts ossify" clock.

Explicit NO_CHANGE: `episode close --lock-wait-ms` parity (E6 — honest without it);
`commits apply` rollback (git history is the honest ledger; C4's one-line disclosure suffices);
inject crash-loss semantics (I3 — deliberate, documented in source); re-litigating the E1 write
itself (pinned, designed).

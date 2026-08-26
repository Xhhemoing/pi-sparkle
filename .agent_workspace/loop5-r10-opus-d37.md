# Loop 5 · Round 10 · D37 — every free verb refuses a blank `--state-root`

Slot: Opus-d37-blank-root (rank 1 implementer). Branch
`cursor/blank-state-root-preflight-0da8`, based on
`origin/cursor/pi-sparkle-sota-opt-0da8` at `be4c7a9`
(`docs(agent): record GPT-r10 FIX riders for D37–D39`), the latest origin SHA when the branch
was cut. Origin advanced to `c533f5c` (`docs(agent): record GPT-d38-recheck dispatch id`) during
implementation; `git diff --name-status be4c7a9..c533f5c -- src test` is empty, so every source
and test blob this batch was built against is unchanged and no rebase was needed. Not merged to
the integration branch and no PR opened — parent merges.

**Spec applied: `.agent_workspace/loop5-r10-gpt-challenge.md` D37 FIX**, i.e. Fable's Rank 1
(`.agent_workspace/loop5-r10-fable-next.md`) *as corrected by GPT*. The corrections that
changed what was built, all five of them, are itemised in §2. The load-bearing one is
**validate: flowchart-only, not `--children`**.

## Files changed

Exactly thirteen, all owned by this slot (`git diff --stat be4c7a9..HEAD`):

- `src/cli/{list,pause,inject,commits,models,auth,validate}.ts` — the guard, one copy per module.
- `test/unit/cli/{list,models,auth,validate}.test.ts`,
  `test/integration/cli/{pause-inject,commits}.test.ts` — sixteen new cases.
- `.agent_workspace/loop5-r10-opus-d37.md` — this report.

`src/cli/main.ts`, `src/cli/errors.ts`, `src/cli/episode.ts`, `src/cli/init-examples.ts`,
`src/cli/migrate-legacy.ts` and `package.json` are byte-identical to the base branch, so D38
and D39 have no file to contend for.

## 1. The guard

When `values["state-root"] !== undefined && values["state-root"].trim() === ""`:

```
stage:   parse-args
message: invalid --state-root "<raw>": state root must be a non-empty directory path
next:    pass --state-root <dir> or omit it to use the default ~/.pi-sparkle
```

`command` is each module's existing dialect and no new spelling is invented: bare `list`,
`pause`, `inject`, `commits`, `validate`; subcommand-qualified `models list` / `models enable` /
`models disable` / `models set-default` and `auth status` / `auth login` / `auth logout`.

The `next` is path-free — it names the flag and never interpolates the raw value, which is the
D34 rider. That matters here specifically: the value being reported *is* the thing that would
break the line, since a raw blank pastes as `--state-root ` and swallows the following word.
That is exactly what the old `pause` remedy did (`pnpm cli list --state-root for the run ids
that exist there`).

Copied per module, not imported. `errors.ts` feeds `main.ts`'s held failure path and `main.ts`
imports these verbs, so a shared helper would either create the cycle D15 forbids or couple
three concurrently dispatched batches to one unmerged branch. Where a module already refuses in
several subcommands (`commits`, `models`, `auth`) the copy is a module-local
`refuseBlankStateRoot`, in the same shape as the `refuseMalformedRun` / `refuseMalformedId` /
`refuseUnknownModel` helpers those files already carry. The identical bytes are owned by
whole-field tests in all six test files rather than by a shared constant.

Nonblank relative roots stay accepted — pinned live and in tests (`--state-root .`, §5).

## 2. What the GPT FIX changed relative to raw Fable

1. **`validate` is guarded on the flowchart branch only.** Fable's probe claimed
   `validate --children … --state-root ""` ran a catalog-parity check against a cwd-relative
   `providers.json`. It does not: `validate.ts` never resolves the state root on that branch,
   and the usage says `--state-root is ignored by --children`. The real target defect is on
   `--flowchart`, which builds its live catalog from the root. The guard therefore sits inside
   the flowchart condition, after the exactly-one-spec and blank-spec checks and before the
   catalog build. `--children` keeps its documented state-root-independent behavior, blank
   values included.
2. **Fable's children-only blank-root test was replaced** with the flowchart pin GPT asked for:
   it proves no cwd `providers.json` is read and pins all four refusal fields (§4).
3. **Placement is per-module precedence, not one line.** Each guard sits immediately before its
   module's first root resolution and after every existing argv check that needs no root, so
   D31/D34/D35 ordering is preserved wherever the earlier remedy can be stated without a root.
4. **The pause mixed case is pinned explicitly**: `pause --run banana --state-root ""` reports
   the blank root, because the run-shape remedy interpolates the root it does not have.
5. **No shared helper**, per GPT's reading of D15 — `errors.ts` and `main.ts` untouched.

## 3. Placement, module by module

| module | kept ahead of the guard | guard sits before |
| --- | --- | --- |
| `list` | runs/episodes, `--status`, `--sort` | `const stateRoot = …` (was line 296) |
| `pause` | required `--run`, `--clear`+`--reason`, blank `--reason` | `isRunId` |
| `inject` | `--type`, `--confidence`, blank `--key`/`--node`/`--actor` | `isRunId` |
| `commits preview` | required `--run` | its root assignment (so before `isRunId`) |
| `commits apply` | required `--run` | its root assignment (so before `isRunId` and blank `--repo`) |
| `models list` | help, blank `--provider`, `--provider` without `--available` | `loadProvidersConfig` |
| `models enable/disable` | help/positional, `tryParseModelRef` | `stateRootOf` and all config I/O |
| `models set-default` | required/malformed `--primary`, malformed `--fast` | `stateRootOf` and all config I/O |
| `auth status` | help | `listStoredCredentials` |
| `auth login` | help, required/blank `<provider>`, mode exclusivity, blank `--key` | `loadProvidersConfig` (so before the provider lookup) |
| `auth logout` | help, required/blank `<provider>` | `deleteStoredCredential` |
| `validate` | exactly-one-spec, blank spec path | catalog construction, flowchart branch only |

`pause`'s and `inject`'s guards precede `isRunId` and `commits`' precede both `isRunId` and the
D32 blank `--repo` check because each of those remedies interpolates the state root. This does
not fight D31 or D32: their existing malformed-run and blank-`--repo` pins all pass a nonblank
root and every byte of them is unchanged (verified by running the files). `auth login`'s guard
precedes the provider lookup for the same reason — an `unknown provider` reported against a
tree the operator never named would send them to the wrong catalog.

## 4. Tests

184 across the six files, up from 159; the sixteen new cases are:

- **`list.test.ts`** (22 → 26): whole-field pins for `""` and `"  "` on `list` and
  `list --episodes`; `list --json --state-root ""` refuses with nothing on stdout and no
  `RUN_LIST` anywhere; a seeded working directory whose own runtime tree is *not* listed under
  a blank root while `--state-root .` does list it; and the four root-free argv refusals
  (`--runs --episodes`, `--status`, `--episodes --status`, `--sort`) still reporting first.
- **`pause-inject.test.ts`** (27 → 34): whole-field pins on `pause` and `pause --clear`, on
  `inject` for both `fact` and `skip`; the mixed-order pin
  (`pause --run banana --state-root ""` → blank root, `doesNotMatch /expected a run id/`) and
  its inject twin; the root-free precedence rows for both verbs; an event-line count proving no
  log was touched; and an `mkdtemp` working directory left empty by a refusal.
- **`commits.test.ts`** (32 → 35): whole-envelope `deepEqual` on preview and apply for both
  blanks; `preview --json` producing no `COMMITS_PREVIEW`; and the placement pin — `--run` is
  still required first, then the blank root outranks both the run-shape and blank-`--repo`
  reports.
- **`models.test.ts`** (28 → 31): all four subcommands (`list`, `list --json`,
  `list --available`, `enable`, `disable`, `set-default`) × both blanks, whole-field, with
  `runId: undefined`; the no-write pin — `models enable openai/gpt-5.2 --state-root ""` from an
  `mkdtemp` cwd leaves that directory empty and prints no `Enabled`; and the D34 refusals
  (malformed id, blank `--provider`, `--provider` without `--available`) still first.
- **`auth.test.ts`** (32 → 37): all three subcommands × both blanks, whole-field, asserting the
  key never appears; the no-write pin — `auth login openai --key … --state-root ""` from an
  `mkdtemp` cwd leaves no `runtime/auth.json`; the D35 refusals still first; the blank root
  reported ahead of the provider lookup; and `--help` on all three still exiting 0 with a blank
  root.
- **`validate.test.ts`** (18 → 21): the flowchart pin (below); `--children` still accepted with
  both blanks; and exactly-one-spec plus blank-spec still outranking the guard.

The validate pin is the GPT correction made executable. From a working directory whose relative
`runtime/providers.json` exposes `local/m1`, against a spec whose node names `local/m1`:

- `--state-root ""` and `--state-root "  "` refuse with all four fields, print nothing on
  stdout, and mention neither `providers.json` nor `local/m1` nor the catalog-build failure —
  the proof that no cwd config was read;
- the same spec against the root the operator meant is refused as
  `unavailable model "local/m1"`, which is the answer the blank root was hiding;
- `--state-root .` still validates against that same tree, so a nonblank relative root is
  unaffected.

Every one of the sixteen new cases fails against the pre-fix modules
(`git checkout HEAD~1 -- src/cli` → `# pass 168 / # fail 16`) and passes after. The three
precedence tests pass in both directions by design: they pin ordering that must not move.

## 5. Verification on this VM

`pnpm install --frozen-lockfile` clean; Node v22.14.0 (engines warning only).

```
$ npx tsx --test test/unit/cli/list.test.ts test/integration/cli/pause-inject.test.ts \
    test/integration/cli/commits.test.ts test/unit/cli/models.test.ts \
    test/unit/cli/auth.test.ts test/unit/cli/validate.test.ts
# tests 184 / # pass 184 / # fail 0

$ npx tsc --noEmit          # clean
$ pnpm lint                 # clean
$ pnpm test                 # 2360 tests / 2359 pass / 1 skipped / 0 fail (whole repo)
```

Live probes from `/tmp/d37-probe/cwd`, invoking `src/cli/main.ts` so the working directory is
the one being defended:

```
$ pi-sparkle auth login openai --key sk-probe --state-root ""
error: invalid --state-root "": state root must be a non-empty directory path
  command: auth login
  stage: parse-args
  next: pass --state-root <dir> or omit it to use the default ~/.pi-sparkle
exit=1

$ pi-sparkle models enable openai/gpt-5.2 --state-root ""      # command: models enable, exit=1
$ pi-sparkle pause --run banana --state-root ""                # command: pause,        exit=1
$ pi-sparkle commits preview --run run_probe0001 --state-root "  "
error: invalid --state-root "  ": state root must be a non-empty directory path
  command: commits
  ...                                                          # exit=1

# after all four: the working directory is still empty — no runtime/auth.json,
# no runtime/providers.json.
```

and the validate triple, with `runtime/providers.json` in the cwd exposing `local/m1`:

```
$ pi-sparkle validate --flowchart /tmp/d37-probe/flw.json --state-root ""
error: invalid --state-root "": state root must be a non-empty directory path
  command: validate
  stage: parse-args
  next: pass --state-root <dir> or omit it to use the default ~/.pi-sparkle
exit=1

$ pi-sparkle validate --flowchart /tmp/d37-probe/flw.json --state-root .
valid: flowchart flw_probe (1 nodes, 0 edges) checked against the live catalog at .
exit=0

$ pi-sparkle validate --flowchart /tmp/d37-probe/flw.json --state-root /tmp/d37-probe/empty-root
error: flowchart node work modelPolicy references unavailable model "local/m1"; CLI catalog: cheap, premium
exit=1

$ pi-sparkle validate --children /tmp/d37-probe/children.json --state-root ""
valid: children 1 tasks → flowchart children (1 nodes)
exit=0
```

The last line is the GPT correction: `--children` ignores `--state-root` as documented, and a
blank value does not turn a deliberately ignored option into an incompatibility.

## 6. Freeze and disjointness

- Every refusal fires before its verb assembles any success payload, so `RUN_LIST`,
  `EPISODE_LIST`, `MODELS_LIST`, `AUTH_STATUS`, `VALIDATE_OK` and `COMMITS_PREVIEW` are
  byte-identical on success; no JSON key is added, removed or renamed anywhere. Pinned by the
  existing `deepEqual` contract tests, all of which still pass.
- No new Event type. No live R1 / `selectArm` / `planTaskTopology`. ADR-006 stays Proposed.
  `INSPECT_SUMMARY` keeps its four keys. `doctor.ts` untouched, so `doctor --json` is
  byte-untouched. D7 Variant B untouched.
- `main.ts` is not opened, so the eleven-case crash probe order and the blocked-next four-line
  routed prefix are untouched trivially. `package.json` untouched.
- Closed decisions reopened only for this new defect: grep confirms no pre-existing test in the
  repo passed a blank `--state-root` anywhere, and the D25/D31/D32/D34/D35/D36 envelopes all
  keep their exact bytes (verified by running the six files plus the full suite).
- File-disjoint from D38 (`init-examples.ts`, `migrate-legacy.ts`) and D39 (`episode.ts`), and
  from PR #12's live source and test lists.
- Operator-contract language only. This is a target-addressing defect — a command answering
  about, or writing into, a directory the operator did not name — and the report states it that
  way throughout. No cybersecurity or exploit framing.

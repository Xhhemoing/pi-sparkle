# Loop 5 · Round 9 · D36 — `validate` unreadable-path and blank-path retargeting

Slot: Opus-d36-validate-paths (rank 3 implementer). Branch `cursor/validate-path-retarget-0da8`,
based on `origin/cursor/pi-sparkle-sota-opt-0da8` at `764e1ad`
(`docs(agent): record D34–D36; open Round 9`). Not merged to the integration branch — parent
merges.

Spec implemented exactly as written: `.agent_workspace/loop5-r9-fable-next.md` Rank 3 (D36).

## Files changed

- `src/cli/validate.ts` — the blank-path guard and the three-way classification inside the existing
  shared catch.
- `test/unit/cli/validate.test.ts` — one updated pin, four new tests.
- `.agent_workspace/loop5-r9-opus-d36.md` — this report.

Nothing else was touched. `src/cli/children-spec.ts`, `src/cli/flowchart-io.ts`, `src/cli/main.ts`
and `package.json` are byte-identical to the base branch (`git diff --stat` shows exactly the three
files above).

## 1. Blank path → `parse-args`, before any read

`--children ""` and `--flowchart "   "` survived the exactly-one check (`"" !== undefined`) and
reached `readFile` as a path, so the operator got `ENOENT … open ''` plus "fix the spec and re-run"
— a remedy for a file they never named. The guard sits immediately after the exactly-one refusal,
whose bytes do not change, and before the `try` block, so no read of any kind happens:

```
command: validate
stage:   parse-args
message: invalid --children "": spec path must be a non-empty string
next:    pass --children <spec.json>
```

and the `--flowchart` twin with `pass --flowchart <flowchart.json>`. `trim() === ""` is the test, so
a whitespace-only value refuses too. The flag and the path both come from two constants computed
once (`specFlag`, `specPath`) — exactly one of the two flags is defined at that point, guaranteed by
the exactly-one refusal above it, and the same two constants are what the catch below names.

Live probe on this VM:

```
$ npx tsx src/cli/main.ts validate --children ""
error: invalid --children "": spec path must be a non-empty string
  command: validate
  stage: parse-args
  next: pass --children <spec.json>
{"ok":false,"command":"validate","stage":"parse-args","message":"invalid --children \"\": spec path must be a non-empty string","next":"pass --children <spec.json>"}
exit=1
```

Note the blank `--flowchart` refusal fires **before** the catalog build as well, so a blank path
under a broken `--state-root` still reports the argv fault rather than the catalog one. That is the
D30/D31 precedence principle (argv refuses before environment-dependent checks) and nothing pinned
the other order.

## 2. Unreadable path → `lookup` naming the flag

The one shared catch now classifies in the spec's order, with no catch added or widened:

1. `error instanceof DomainValidationError` → today's report byte-identical: `stage: "validation"`,
   the parser's own message, `next: "fix the spec and re-run pi-sparkle validate"`. Both parsers
   wrap every JSON and schema fault in this type, so the bad-JSON pin (`Invalid child spec …`) and
   the cycle / missing-dependency / unavailable-model pins keep their exact bytes.
2. else `errorCodeOf(error) !== undefined` (imported from `./errors.js`, the existing export — the
   CLI does not restate what an fs fault looks like) →

```
command: validate
stage:   lookup
message: cannot read --children <path>: ENOENT: no such file or directory, open '<path>'
next:    check the --children path; pi-sparkle init writes example specs this command accepts
```

   with `--flowchart` substituted on the flowchart branch. The flag comes from which branch ran, via
   the same `specFlag` the blank guard uses, so it can never disagree with the flag the operator
   typed.
3. else → today's `stage: "execute"` with the generic message and "fix the spec" next, unchanged.
   Nothing reachable is known to land here today; the branch stays so an uncoded non-domain throw
   still gets a report rather than an unhandled rejection.

The classification is **on the presence of a code, not on ENOENT**: a directory passed as a spec
path throws `EISDIR` and lands in the same class, which the new test pins on both flags so a future
reader cannot narrow the guard to one errno without a failing test.

The flowchart branch's inner catalog-build catch (`could not build the model catalog at …`) is
untouched — it already names its own two repairs, and both its pins hold.

Live probe:

```
$ npx tsx src/cli/main.ts validate --children /tmp/nope.json
error: cannot read --children /tmp/nope.json: ENOENT: no such file or directory, open '/tmp/nope.json'
  command: validate
  stage: lookup
  next: check the --children path; pi-sparkle init writes example specs this command accepts
exit=1
```

## 3. Pin update, in-batch

`validate.test.ts:296-302` asserted the missing `--flowchart` file as `stage: "execute"` with a
message merely *including* the path — a generic-classification pin, not a decision. It now asserts
`stage: "lookup"` and `/^cannot read --flowchart /`, and keeps the original
"the failure names the file it could not read" inclusion assertion and the stdout-empty assertion
alongside, so the update strengthens rather than replaces what that test guarded.

## 4. Tests

`test/unit/cli/validate.test.ts` goes 14 → 18 tests, all green:

- **unreadable `--children`** — whole-field pins (`command`, `stage`, `message`, `next`) on the
  exact ENOENT bytes plus `assert.deepEqual(out, [])`.
- **unreadable `--flowchart`** — the same four whole-field pins under an explicit `--state-root`,
  plus stdout empty.
- **directory as a spec path** — an `mkdir` fixture on both flags, pinning `stage: "lookup"`,
  `/^cannot read --<flag> <dir>: EISDIR/`, the `--children` `next` in full, and stdout empty. This
  is the errno-genericity proof.
- **blank spec path** — `--children ""` and `--flowchart "   "` with whole-field pins on both and
  stdout empty on both.

Every existing pin holds byte-for-byte, verified by running the file: the bad-JSON `validation`
report, the cycle and missing-dependency refusals, the unavailable-model refusal, both broken-catalog
reports, the exactly-one refusals, the mistyped-flag `parse-args` report, `--help`, and both
`VALIDATE_OK` `deepEqual`s (children and flowchart). Nothing on the success path changed, so the
frozen-additive `VALIDATE_OK` contract is byte-identical. `withSpecDir`'s standing assertion that
`validate` writes nothing under the default state root covers all four new tests.

## 5. Verification run on this VM

`pnpm install --frozen-lockfile` clean, Node v22.14.0.

```
$ npx tsx --test test/unit/cli/validate.test.ts
# tests 18 / # pass 18 / # fail 0

$ npx tsx --test test/integration/cli/validate-run-parity.test.ts \
    test/unit/cli/init-examples.test.ts test/integration/cli/commands.test.ts
# tests 19 / # pass 19 / # fail 0

$ npx tsc --noEmit          # clean
$ npx eslint src/cli/validate.ts test/unit/cli/validate.test.ts   # clean
```

The three adjacent files are the only other places in `test/` that mention these flags or the
"fix the spec" remedy (grepped); none of them pinned the converted classification.

## 6. Freeze / disjointness

- No new Event type, no new JSON key, no `main.ts` edit, no shared-parser edit. `run --children` and
  `run --flowchart` reach `parseChildSpec` / `parseFlowchartFile` through `main.ts` and are
  behaviourally unchanged, so there is no PR #12 collision on the shared seam.
- `VALIDATE_OK` byte-identical; `package.json` untouched.
- Neither edited source file is in PR #12's live file list; disjoint from Ranks 1 (D34, `models.ts`)
  and 2 (D35, `auth.ts`) — no file overlap at all.
- Operator-contract only: no auth, network or access-control change. `validate` still creates no
  run, opens no provider connection and writes nothing.

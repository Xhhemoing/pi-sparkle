# Loop 5 · Round 11 — GPT-r11 independent ranking/spec challenge

Verdict: keep all three operator batches, but reorder them **D40 → D42 → D41**.
The durable append-only write in D42 is stronger than D41's late refusal of bad
argv. Contract verdicts are **D40 FIX**, **D41 FIX**, **D42 FIX**. No held item
is a stronger file-disjoint replacement.

## Method

- Challenged latest origin SHA `8bb5086de977715cfe038f1b3906a2323642872e`
  (`docs(agent): record GPT-r11-challenge dispatch id`). The mandatory first
  fetch initially returned `5a88e06cd0265078cf0facac0b20d59e7d97d7cf`
  (`docs(agent): record Round 11 Fable ranking (D40–D42)`). A post-probe fetch
  found the one-line dispatch-id advance to `8bb5086`; this branch was
  fast-forwarded to it. `5a88e06` is an ancestor, and
  `git diff --name-status 5a88e06..HEAD -- src test` is empty.
- Fable ranked at `d056bcf66a70f61b6c0520d372610a2f72b8e889`.
  `git diff --name-status d056bcf..HEAD -- src test` is empty. The complete
  `src` tree is byte-identical at both SHAs
  (`4c12cfeee1a83cce498f81a795a0f45887fc6b97`), as is the complete `test`
  tree (`5b80d3f2c5fc40203d99ab9586b46c3923cd17b2`).
- Read `.agent_workspace/loop5-r11-fable-next.md` and
  `docs/agent-decisions.md` D40–D42 in full, together with the relevant
  D20/D30–D39 decisions. Read live `src/cli/{commits,inject,episode,errors}.ts`,
  `src/tools/decision-commit.ts`, `src/run/{checkpoint-store,event-store,
  injection,episode-store}.ts`, `src/episode/{closure,manager,store}.ts`,
  `src/domain/ids.ts`, the relevant generic catch and inventory sections of
  `src/cli/{main,doctor}.ts`, and all three ranked test files in full.
- Pulled PR #12 live with
  `gh pr view 12 --json files,state,headRefName,url`. It is **OPEN**, head
  `cursor/merge-preview-release-8011`. Its source set is
  `src/adaptation/eval-routing.ts`, `src/cli/{adapt,inspect-format,main}.ts`,
  `src/feedback/redaction.ts`, `src/pi-adapter/runtime.ts`, and
  `src/run/{flowchart-run,inspection}.ts`. Its test set is integration
  `cli/{cli,inspect-follow,run-cost-cap}`, `m1/cli-children`,
  `m2.5/flowchart-run-cap`, `pi-adapter/costgate-cli-warning`; unit
  `adaptation/{eval-routing,promotion}`, `cli/{adapt,cost-flag,inspect-format,
  readme-command-parity}`, `feedback/{redaction,release-gate-policy}`,
  `learning/active-routing`, `package/{market-eval-probe,
  preview-release-probe}`, `pi-boundary`, `privacy/redaction`, and
  `run/{flowchart-learned-routing,inspection}`. None of the six ranked files
  overlaps it.
- `pnpm install --frozen-lockfile` completed successfully. It reported the
  expected Node v22.14.0 versus `engines.node >=22.19.0` warning and pnpm's
  ignored-build-script notice. Baseline
  `npx tsx --test test/integration/cli/commits.test.ts
  test/integration/cli/pause-inject.test.ts
  test/integration/m3/episode-cli.test.ts` passed **92/92**.
- Campaign fixtures and probe artifacts were seeded only below
  `/tmp/r11-gpt-challenge/**`. A TypeScript harness called the live
  `main(...)` with capture I/O, the same pattern as the ranked tests; selected
  checks also invoked `node_modules/.bin/tsx src/cli/main.ts` directly.
  Direct domain probes imported the live `parseFactValue`. Every quoted
  refusal exited 1; quoted successes exited 0.

## D40 — FIX (keep rank 1)

All four defects and the dead remedy are live:

- Default non-flowchart run:
  `message: "checkpoint has no flowchart; decision-to-commit requires a
  flowchart run"`, `stage: "validation"`,
  `next: "fix the reported error, then retry; use pi-sparkle doctor for
  preflight"`. Direct `apply` produced the same envelope.
- Deleted `checkpoint.json`:
  `message: "Run run_absent0001 has no durable checkpoint"`, still
  `stage: "validation"` with the same doctor next.
- `checkpoint.json` containing `not json{`:
  `message: "Invalid checkpoint
  /tmp/r11-gpt-challenge/data/state/runtime/runs/run_corrupt0001/checkpoint.json:
  Unexpected token 'o', \"not json{\\n\" is not valid JSON"`, again the generic
  validation envelope.
- A real BLOCKED flowchart:
  `message: "no completed nodes to commit"`, again the generic validation
  envelope. Direct `apply` reproduced it.
- After removing the separate corrupt-event fixture, `doctor --json` on the
  root containing the absent and corrupt checkpoints reported
  `run-state-inventory` as `ok`, with
  `runStates: {"entries":[],"scanErrors":[]}`. The report contained no
  `checkpoint`; only the unrelated Node-engine check failed.

The classes are correct. `CheckpointStore.read()` maps checkpoint ENOENT to
`undefined`, just as a missing stored record; live `--file` ENOENT is
`stage: "lookup"`, while bad `--file` JSON is `stage: "validation"`.
Therefore absent checkpoint is `lookup`; bad JSON, invalid checkpoint shape,
non-flowchart checkpoint, and zero proposals are `validation`.

Keep Fable's narrow boundaries:

1. `EventStore.readAll()` stays outside every new catch. A corrupt event row
   live-produced `message: "Corrupt event log line 1"` through main's current
   generic envelope, and doctor names that exact run-log family.
2. Around checkpoint read+validate, `assembleDecisionCommitInput`, and each
   `proposalsFromInput`, convert only
   `error instanceof DomainValidationError &&
   errorCodeOf(error) === undefined`. Rethrow coded failures. Replacing a
   checkpoint file with a directory live-produced coded EISDIR and main's
   `stage: "execute"` envelope; a regular file as `--state-root` likewise
   produced coded ENOTDIR.
3. Keep store/plane message bytes and `runId`; do not edit
   `checkpoint-store.ts` or `decision-commit.ts`.

Fable's `--file` coverage does not collide with D32 when ordering is kept.
With a two-node checkpoint, a file containing only `first`, and
`--nodes second`, the node is known to the checkpoint but absent from the
file; live reached `proposalsFromInput` and said
`"no completed nodes to commit"`. With the same file and `--nodes bogus`,
D32 fired first and kept:

`next: "pass --nodes ids from this run's flowchart; pi-sparkle inspect --run
run_… --state-root /tmp/r11-gpt-challenge/data/state lists its nodes"`.

Keep those closed D32 bytes. The D40 catch belongs strictly after
`filterDecisionCommitNodeIds`.

The required FIX is Fable's two new raw-path interpolations. D34 forbids
putting an unquoted raw state-root into executable-looking `next` text.
Do not copy D32's pre-rider spelling into new D40 output. Use these exact
D40 remedies instead:

- absent checkpoint:
  `this run recorded events but no durable checkpoint; pi-sparkle inspect
  --run ${runId} using the same --state-root shows its status — only
  checkpointed runs have a decision ledger`
- zero proposals:
  `pi-sparkle inspect --run ${runId} using the same --state-root lists its
  nodes; commit proposals exist only for COMPLETED nodes`

Interpolating `runId` is acceptable: `isRunId` has already constrained it to a
1–64 character `[A-Za-z0-9_-]` suffix. It is neither a raw path nor an
unquoted free-text value. The live inspect probe did list
`flowchart: BLOCKED (work=RUNNING)`. The arbitrary `stateRoot` must remain
out of the new nexts.

This also keeps D20. The absent-checkpoint wording claims recorded events only
after the nonempty event read. All proposal refusals precede git preflight and
the commit loop; the `apply` tests must pin unchanged git history, not claim a
commit occurred.

## D41 — FIX (keep the batch, move to rank 3)

The defects and domain boundary are live. Direct calls reported all four as
uncoded `DomainValidationError` with
`"fact value must be a JSON scalar or bare string"`:

- `parseFactValue('{"a":1}')`
- `parseFactValue("[1,2]")`
- `parseFactValue("null")`
- `parseFactValue("1e999")`

The finite-number condition is load-bearing: JSON parses `1e999`, but the
result is not a finite scalar. By contrast, `parseFactValue("")` returned the
empty string; `true`, `42`, and bare `text` also returned valid scalars.

Through the CLI today, each invalid fact value reaches a real run first and
then reports `stage: "validation"` with the generic doctor next. Flag
relevance does the same:

- skip `--key k1` → `"injection key is not valid for skip"`
- skip `--value v1` → `"injection value is not valid for skip"`
- override `--key k1` → `"injection key is not valid for override"`
- override `--value v1` → `"injection value is not valid for override"`

Keep Fable's implementation contract: after per-type required flags, reject
`--key`/`--value` on override or skip as `parse-args`; after the existing blank
key/node/actor loop and before the blank-root guard, call `parseFactValue`
exactly once for fact, catch only `DomainValidationError`, and pass that parsed
value into the request. Empty-string value stays legal.

The legal surfaces are confirmed, not inferred. Live probes succeeded for a
fact carrying `--node work`, and for fact, override, and skip each carrying
`--confidence 0.5`. The empty-string fact succeeded and printed
`facts: empty=`.

The ordering does not break D30, D31, or D37:

1. Unknown type remains first. The mixed live probe with bad type, bad run,
   blank key, non-scalar value, and blank root still returned
   `unknown --type "banana"`.
2. Required per-type flags remain before relevance; confidence and the D31
   blank key/node/actor checks remain before fact-value parsing. Thus D31's
   blank-key pin still wins over an invalid fact value.
3. Fact-value parsing is root-free argv work, so it belongs before D37's
   blank-root guard. Today the complete mixed argv
   `inject --run run_missing0001 --type fact --key k --value '{"a":1}'
   --state-root ""` reports the blank root. After D41 it must report the
   `--value` fault without reading state.
4. This does not fight D37's
   `pause --run banana --state-root ""` pin. That pin is in another module;
   D37 expressly keeps inject's root-free argv checks ahead of inject's root
   guard.

The FIX is to make Fable's abbreviated mixed-case test exact. Literal
`--type fact --value '{"a":1}' --state-root ""` omits both the command's
required `--run` and fact's required `--key`, so it cannot prove value-first
ordering. Pin the complete argv in item 3, with a syntactically valid run id
and `--key`, and assert all refusal fields plus no state creation. Fable's
implementation order and refusal bytes otherwise stand.

D41 is still worth keeping, but it ranks behind D42: every bad D41 input
already fails without appending an injection; its defects are classification,
state-read ordering, and remedy quality.

## D42 — FIX (keep the batch, move to rank 2)

The durable-write defect is live and keeps this slot:

- FAILED with `--outcome ""` exited 0, printed
  `Episode ep_blankfailed: FAILED`, and appended
  `"outcomeId":""` to the event JSONL.
- COMPLETED with `--outcome "  "` exited 0 and appended
  `"outcomeId":"  "`.

That is an append-only write, not wording. Keep a close-branch
`parse-args` guard after valid status and before lock acquisition. Pin both
snapshot and event logs byte-identical after refusal. Any nonblank string
remains accepted; do not reopen the held any-string domain or claim Outcome
support.

The re-close correction is also exact. After a real FAILED close:

- COMPLETED re-close printed a duplicate bare `already-closed`, then
  `message: "already-closed"` with
  `next: "satisfy required evidence or close as FAILED/ABANDONED"`.
- FAILED re-close printed the one refusal envelope with
  `next: "inspect --episode to see the terminal status"`.

Copy the FAILED-path envelope for
`decision.reason === "already-closed"` and suppress only that reason's bare
stderr duplicate. The `acceptance-incomplete` bytes must remain untouched.
Live they were:

`note: recorded WAITING_FOR_USER for ep_incomplete — this refused close changed
the episode status; it now names its missing evidence`

then `acceptance-incomplete: tests`, followed by the close envelope whose next
is `"satisfy required evidence or close as FAILED/ABANDONED"`. This is D20's
claim-only-what-happened disclosure and must not be generalized to
already-closed.

The ignored events flags are live:

- `episode events ... --status FAILED` exited 0 and printed the unfiltered
  opened event.
- `episode events ... --outcome oc_probe --json` exited 0 and printed the raw
  event JSON.

Keep Fable's two parse-args refusals before either store read and in both
output modes.

The required order FIX is to refute Fable's literal mixed-case claim.
Live:

`episode events --status FAILED --state-root ""`

reported `message: "episode command requires --episode <epId>"`, not blank
root. That is required by D39, which placed missing episode before blank root.
With `--episode ep_eventsflags` added, the same mixed case reported
`invalid --state-root "": state root must be a non-empty directory path`
before judging `--status`.

Therefore preserve this order:

1. help;
2. unknown subcommand (D33 verb-before-flags);
3. missing `--episode`;
4. blank `--state-root`;
5. malformed episode id;
6. events-only `--status`/`--outcome` relevance;
7. store read.

Replace Fable's no-episode blank-root-first pin with two pins: the literal
command above keeps the missing-episode report, and the complete command with
a valid `--episode` keeps blank-root-first. This does not contradict D33:
once `events` is settled, its flags are judged in the existing D39 order.
An unknown-verb probe carrying malformed episode, status, and blank root still
reported `Unknown episode command: nonsense`.

## Ranking, disjointness, freeze, and held items

The corrected batches remain mutually file-disjoint:

- D40: `src/cli/commits.ts` +
  `test/integration/cli/commits.test.ts`
- D41: `src/cli/inject.ts` +
  `test/integration/cli/pause-inject.test.ts`
- D42: `src/cli/episode.ts` +
  `test/integration/m3/episode-cli.test.ts`

They are also disjoint from PR #12's refreshed list. Closed files reopen only
for NEW defects: D40 does not alter D32 argv/file/filter bytes or D20's
partial-commit disclosure; D41 does not alter D30 type/confidence, D31 blank
key/node/actor, or D37 blank-root contracts; D42 does not alter D33 event
rendering/verb dispatch or D39 corrupt-log catches/blank-root order.

The freeze gate holds: no live R1, topology, ADR-006 status, new Event,
`RunStatus`, doctor JSON key/route, `INSPECT_SUMMARY`, success JSON, package
metadata, store, closure, plane, or `main.ts` edit. D34 is honored by removing
raw state-root interpolation from new D40 nexts while preserving the closed
D32 envelope. D20 is honored by preserving actual-write disclosures and
requiring no-write/no-commit byte pins for new refusals.

Nothing Fable held is a stronger file-disjoint replacement. File-as-root and
corrupt run-event-log families are visible to doctor; pause/inject run-shape
and the observed BLOCKED-inject discrepancy cross PR #12's
`flowchart-run.ts`; the `main.ts` remainder overlaps PR #12; the outcome
any-string question is design, not a replacement for refusing blank values.

Overall: **reorder to D40 → D42 → D41; keep every slot.**

- **D40 FIX** — keep; remove raw state-root from the two new inspect nexts and
  preserve D32's earlier unknown-node envelope.
- **D41 FIX** — keep; use complete required argv for the value-before-root
  order pin. The implementation contract otherwise stands.
- **D42 FIX** — keep; preserve missing-episode before blank-root and add a
  valid episode id to the blank-root-before-events-flags pin.

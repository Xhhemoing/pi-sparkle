# Loop 5 · Round 11 — D40 (Opus-d40-commits-ledger), as corrected by GPT-r11-challenge

Slot: Opus-d40-commits-ledger. Branch `cursor/commits-ledger-envelopes-0da8`, cut from
`origin/cursor/pi-sparkle-sota-opt-0da8` at **`05566af`**
(`docs(agent): record GPT-r11 FIX riders; reorder D40→D42→D41`), the origin tip at dispatch.
Not merged into the parent integration branch; no PR opened.

Files owned and touched — and only these three:

- `src/cli/commits.ts`
- `test/integration/cli/commits.test.ts`
- `.agent_workspace/loop5-r11-opus-d40.md` (this file)

Untouched, deliberately: `src/tools/decision-commit.ts`, `src/run/checkpoint-store.ts`,
`src/cli/main.ts`, `src/cli/errors.ts`, the D41/D42 verb modules and their tests, and
`package.json`. The store's and the commit plane's refusal **messages stay theirs**; only the
envelope converts, inside the verb that owns it.

## The GPT FIX — path-free `next` text is where this departs from raw Fable

Fable's Rank 1 wrote two of the four new remedies with the raw state root interpolated:

- `… pi-sparkle inspect --run ${runId} --state-root ${stateRoot} shows its status …`
- `… pi-sparkle inspect --run ${runId} --state-root ${stateRoot} lists its nodes …`

D34 forbids putting an unquoted arbitrary operator path into `next` text that reads as a
command line, and the GPT challenge's D40 FIX is binding here. The shipped remedies name the
flag instead of pasting its value:

- absent checkpoint: `this run recorded events but no durable checkpoint; pi-sparkle inspect
  --run ${runId} using the same --state-root shows its status — only checkpointed runs have a
  decision ledger`
- zero proposals: `pi-sparkle inspect --run ${runId} using the same --state-root lists its
  nodes; commit proposals exist only for COMPLETED nodes`

Interpolating `runId` is fine and stays: `isRunId` has already constrained it to `run_` plus a
1–64 character `[A-Za-z0-9_-]` suffix, so it is neither a raw path nor unquoted free text. Both
tests assert the shipped `next` does **not** contain the state root the command was given.

The second half of the FIX is ordering. **D32's unknown-`--nodes` envelope is not reopened** —
its remedy still spells `pi-sparkle inspect --run <id> --state-root <root> lists its nodes`,
raw root and all, because those are closed bytes from before the D34 rider. The new
zero-proposal catch therefore sits strictly *after* `filterDecisionCommitNodeIds`, and a pin
drives `apply --file … --nodes bogus` to prove D32 still fires first with its own bytes.

## The four conversions

All four faults previously reached `main.ts`'s generic catch, whose one remedy is
`use pi-sparkle doctor for preflight` — and doctor inventories run *event logs*, never
checkpoint files, so it answers none of them.

| fault | stage | wrapped call |
| --- | --- | --- |
| absent checkpoint | `lookup` | the `raw === undefined` branch of `CheckpointStore.read()` |
| corrupt checkpoint | `validation` | `CheckpointStore.read()` + `validateCheckpoint` |
| non-flowchart checkpoint | `validation` | `assembleDecisionCommitInput` |
| zero completed nodes | `validation` | both `proposalsFromInput` sites |

`lookup` for the absent checkpoint follows the house class: `CheckpointStore.read()` maps
checkpoint ENOENT to `undefined`, which is an absent stored record — the same class this module
already gives a `--file` that is not there. A damaged one is `validation`.

Every catch classifies through one local type guard,
`error instanceof DomainValidationError && errorCodeOf(error) === undefined`, and **rethrows
everything else**. `errorCodeOf` is the only new import, added to the existing `./errors.js`
line.

Two boundaries are held open on purpose:

1. `EventStore.readAll()` stays **outside** every new catch. A corrupt run event log is the one
   family in this command doctor genuinely inventories and names by file, so it keeps main's
   generic envelope and its doctor remedy.
2. Coded filesystem faults keep reaching main. A regular file as `--state-root` produces
   `stage: "execute"` with `ENOTDIR`, and a checkpoint path replaced by a directory produces
   `stage: "execute"` with `EISDIR` — both untouched.

## Live probes on this branch

Seeded only under `/tmp/d40probe/**`, driven through the live `main(...)` with capture I/O.
Every refusal exited 1.

```
{"ok":false,"command":"commits","stage":"lookup","message":"Run run_… has no durable checkpoint","next":"this run recorded events but no durable checkpoint; pi-sparkle inspect --run run_… using the same --state-root shows its status — only checkpointed runs have a decision ledger","runId":"run_…"}
{"ok":false,"command":"commits","stage":"validation","message":"Invalid checkpoint /tmp/d40probe/state/runtime/runs/run_…/checkpoint.json: Unexpected token 'o', \"not json{\n\" is not valid JSON","next":"repair or move aside the checkpoint file named above, then retry; pi-sparkle doctor does not inventory checkpoint files","runId":"run_…"}
{"ok":false,"command":"commits","stage":"validation","message":"checkpoint has no flowchart; decision-to-commit requires a flowchart run","next":"decision commits are generated from a flowchart run's checkpoint; this run was not started with run --flowchart, so it has no decision ledger","runId":"run_…"}
{"ok":false,"command":"commits","stage":"validation","message":"no completed nodes to commit","next":"pi-sparkle inspect --run run_… using the same --state-root lists its nodes; commit proposals exist only for COMPLETED nodes","runId":"run_…"}
```

The last two were produced by `commits apply`, so the refusal is reproduced on the verb that
writes. Passthroughs, same session:

```
{"ok":false,"command":"commits","stage":"validation","message":"Corrupt event log line 10","next":"fix the reported error, then retry; use pi-sparkle doctor for preflight"}
{"ok":false,"command":"commits","stage":"execute","message":"ENOTDIR: not a directory, open '…/package.json/runtime/runs/run_missing0001/events.jsonl'","next":"fix the reported error, then retry; use pi-sparkle doctor for preflight"}
{"ok":false,"command":"commits","stage":"execute","message":"EISDIR: illegal operation on a directory, read","next":"fix the reported error, then retry; use pi-sparkle doctor for preflight"}
```

## Tests

`test/integration/cli/commits.test.ts` grew from 35 to **45** tests; the 35 baseline tests are
byte-untouched.

- Whole-field `deepEqual` pins for the absent-checkpoint, non-flowchart and zero-completed
  envelopes; the corrupt-checkpoint pin fixes command/stage/next/runId exactly and anchors the
  message on `^Invalid checkpoint <path>: ` because its tail is the JSON parser's own reason.
- Non-flowchart and zero-completed are pinned on **both** `preview` and `apply`.
- Every `apply` refusal asserts `git rev-list --all` is still empty, so no commit hides behind
  it. That is D20's claim-only-what-happened rule for a refusal that precedes the commit loop.
- `apply --file <preview of `first` only> --nodes second`, where `second` is a node the
  checkpoint knows but the file does not carry, reaches the D40 zero-proposal envelope through
  the other throw site (`commits.ts`, not `decision-commit.ts`).
- The same file with `--nodes bogus` keeps D32's unknown-id envelope byte-for-byte, including
  its state-root-bearing remedy — the ordering pin.
- Two narrowness pins: a corrupt event log still reports `Corrupt event log line <n>` with the
  doctor remedy and no `runId`, and a regular file as `--state-root` still reports
  `stage: "execute"` with `ENOTDIR`.
- The existing `COMMITS_PREVIEW` key pin and the truncated-log success pin are unchanged and
  still pass, so the JSON success path is byte-identical.

The two run-shape fixtures are checkpoint surgery on `tinyCompletedRun`, the same technique the
baseline file already uses to delete `checkpoint.project`: `delete checkpoint.flowchart` for
the default run kind, and `flowchart.snapshot.nodes.work.state = "FAILED"` for a run with no
completed node. Both survive `validateCheckpoint`.

## Verification

- `npx tsx --test test/integration/cli/commits.test.ts` → **45/45 pass** (35 baseline + 10 new).
- `npx tsc --noEmit` → clean.
- `npx eslint src/cli/commits.ts test/integration/cli/commits.test.ts` → clean.
- `npx tsx --test test/integration/cli/*.test.ts test/unit/cli/*.test.ts` → **500/500 pass**,
  0 skipped — every other CLI suite, including the ones that pin main's generic catch.

## Freeze gate

No live R1; no topology or ADR-006 change; no new `Event` type; no `RunStatus` change; no
doctor JSON key or route touched; no new `stage` value (`lookup` and `validation` both already
existed in this module); `COMMITS_PREVIEW`'s keys and bytes unchanged, because every conversion
fires before the JSON print; `main.ts`, `errors.ts`, `decision-commit.ts`, `checkpoint-store.ts`
and `package.json` untouched. `commits.ts` is reopened outside D32's closed scope (argv, file,
filter bytes) and D20's (partial-apply disclosure) — neither classified the checkpoint-read or
proposal-generation faults, and both keep their bytes. All new `next` text is
operator-contract language with no raw operator path in it.

# Loop 5 Round 1 — independent close

Audited against current `HEAD` `679553e`, after the parent had landed and pushed the final dispatch commit.

## Verdict

| Question | Decision |
|---|---|
| `init` | **REPLACE** with the checked-in examples for this preview. Selectively roll back the `init` command, but keep `examples/*`. |
| `list` vs track clarification | **Keep and wire `list` as the small Round 1 closure; make the track-clarification dead end the highest-value substantive Round 2 fix.** |
| Round 1 rollback | Roll back `init`; unship or repair `validate` before treating its contract as frozen. Keep `list` and the shared children parser extraction. |
| Highest-value Round 2 | Track clarification correctness first, legacy secret detection second, durable resume executor configuration third, then an actually complete adaptation workflow. |

## Dispatch truth

At `679553e`, all three verbs are actually reachable from `src/cli/main.ts`:

- `validateCommand`, `listCommand`, and `initExamplesCommand` are imported at lines 85–87;
- all three have top-level USAGE lines at 261–263;
- all three have switch cases at 2060–2065.

Thus the earlier Fable reports saying `list`/`init` were unreachable are stale after commit `679553e`. The relevant question is now whether those newly exposed surfaces should remain, not whether wiring is absent.

## 1. `init`: the packed-install argument is true but not sufficient

Fable is correct about the mechanics: `package.json#files` excludes `examples/`, so a future packed install containing only `dist` plus the listed docs/skill/prompt trees would not carry repository examples. Embedding the bytes makes them available to an installed binary.

That is not the supported product boundary today. README lines 11–19 define clone + `pnpm install` + `pnpm cli` as the supported path and explicitly call `bin.pi-sparkle` a **future** packed-install surface. The package is also `private: true`. Building a mutating verb now solely to serve a future unsupported distribution is premature; current users already receive the versioned examples in the checkout.

The extra verb has real contract cost:

- `init-examples.ts` creates an overwrite/`--force` API, a machine-output contract, help/README parity, and duplicate embedded/static bytes.
- Its stated no-clobber guarantee is not concurrency-safe: it calls `existsSync` for both paths, then later uses ordinary `writeFile`. A file created between those operations is overwritten even without `--force`.
- The JSON mode is multi-line pretty JSON while the other machine surfaces are one compact line.
- Its tests validate the children example ad hoc rather than through the shared `parseChildSpec` + `compileChildrenToFlowchart` path.
- `isHelp(args)` treats any argument equal to `help` as help, so `init --dir help` cannot create the legitimately named directory.

**Close:** selectively revert the `init` import, USAGE line, switch case, README command row, `src/cli/init-examples.ts`, and its command tests. Retain and link `examples/sparkle-children.example.json` and `examples/sparkle-flowchart.example.json`. Reconsider a scaffold command when packed install becomes supported; that work can either package `examples/` deliberately or introduce a command under an install contract that actually exists.

## 2. `list` wiring was the right small landing; clarification is the bigger problem

`list` is a genuine missing primitive: every inspect/resume/pause/delete workflow needs an id, while doctor intentionally lists only PLANNING/RUNNING crash candidates and no episodes. Exposing an already isolated, read-only implementation was the right immediate Round 1 action. Do **not** roll it back.

Two details should be amended before calling the surface settled:

1. `inventory.ts` sorts random UUID-based ids. That ordering has no recency meaning; operator inventory should default to `lastEventAt` descending with id as a deterministic tiebreak.
2. Fable-cli overstates the implementation when it says truncated-tail recovery is reported. Both inventory loops call `readAll()` and discard `read.recovery`; a recovered truncated run or episode tail is silently presented as complete. Surface that recovery in prose and machine output before consumers ossify the contract.

The track-clarification issue is nevertheless more important than list as engineering work. It is not merely poor guidance:

- `track/loop.ts` persists the questions only in `track-questions.json`; its `RUN_WAITING_FOR_USER` carries only a message id.
- `inspection.ts` builds pending questions only from child `QUESTION` messages, so it cannot show track questions.
- Generic `answer` appends `USER_ANSWER` without detecting this plane or correlating the pending clarification.
- `replayRun` clears `sawWaiting` on any `USER_ANSWER`; because the clarification log already has `RUN_STARTED`, the stranded run then replays as **RUNNING**, although no track continuation consumes the answer.

So `answer` turns an honest WAITING dead end into a phantom RUNNING run that doctor can mistake for an interrupted execution. `list` makes that state visible but does not repair it.

**Close:** keep the list landing, then put track clarification first in Round 2. At minimum, inspect must show the persisted question and continuation instruction, and `answer` must refuse on this plane rather than append a state-changing event with no consumer. A true same-run continuation is the complete solution and needs an explicit lifecycle design.

## 3. Round 1 landing that should not ship as-is: `validate`

The shared parser extraction is sound and should stay: `run --children` and `validate --children` both import `parseChildSpec` from `children-spec.ts`.

The flowchart validation claim is not sound:

- `run --flowchart` builds the live catalog from the selected state root and passes its ids to `parseFlowchartFile`.
- `validate --flowchart` calls `parseFlowchartFile(path)` without ids or a state root. That silently uses the static `cheap`/`premium` catalog from `cliCatalogModelIds()`.

Therefore `validate` can reject a flowchart that `run` accepts with an enabled concrete model, and can accept aliases that the selected live catalog does not expose. `VALIDATE_USAGE` nevertheless says it performs “the same CLI catalog check,” and README says it parses the same specs as `run`. The test that rejects `"mystery"` under an empty HOME proves only the static fallback, not parity with a real run.

This is exactly the wrong point to freeze `VALIDATE_OK`: success does not yet mean what the command claims.

**Close:** if it cannot be repaired immediately, remove the `validate` dispatch/USAGE/README claim while preserving `children-spec.ts`. Re-land one of two honest contracts:

1. structural validation by default, explicitly reporting catalog validation as skipped; optional `--catalog --state-root <dir>` performs the live check; or
2. always require/select a state root and run the exact live catalog path.

Do not keep the present implicit static-catalog behavior.

## 4. Round 2 priority corrections

1. **Track clarification — under-ranked by Fable-runtime.** It belongs above output polish, approval labels, storage metrics, and Ctrl-C handling because a documented command accepts an answer, changes durable status, and has no consumer.
2. **Legacy secret detection — under-ranked even within Fable-persist.** Historical `09f325c` stored credentials at `<root>/auth.json`; current auth reads/deletes `runtime/auth.json`. Doctor detects only legacy feedback/runs, and the migrator omits auth/providers/preferences/learning. Detection plus explicit re-login/removal guidance should precede broad retention inventory. Do not auto-copy secrets.
3. **Durable resume executor configuration — under-ranked/omitted by the Fable Round 2 lists.** Resuming on an ambient/default model and thinking level can silently change behavior and cost. Persist only non-secret effective executor configuration and audit explicit overrides.
4. **Deletion honesty + lock-wait propagation — correctly high in Fable-persist.** The CLI says a timeout removes nothing, while invocation/feedback cleanup intentionally happens before the target lock. Correct the claim and pass the same wait bound to the invocation-log lock.
5. **Adaptation vertical slice — Fable-adapt over-ranks `adapt show` ahead of dataset export.** Candidate content and author identity are awkward but already recoverable from the registry; the replay dataset has no producer at all and routing-policy promotion cannot proceed without it. Land `show` + dataset as one end-to-end slice, or dataset first—not `show` alone as another polished cul-de-sac.

Broad `cliFail` dialect cleanup, USAGE wording, approval labels, shell completions, storage byte counts, and shelf adaptation modules remain lower-value polish until these state/lifecycle and secret-disclosure gaps are closed.

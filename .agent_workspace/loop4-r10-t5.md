# Loop 4 · Round 10 · R10-5 (opus-fast) — tracking-plane posture pair

Branch `agent/opt-continuous`, working tree only. No `git checkout`, no commit, no push. Base HEAD `7d6c016`.

Mandate: parent sign-off **record the posture; do not rename**. Comment-only in `src`, plus additive pins. Both halves landed; no behaviour change.

---

## 1. Census (first, against the working tree)

`independentEvidence`, word-boundary sweep of `src/`:

| Site | Kind |
|---|---|
| `src/tracking/prescore.ts:23` (now :29) | declaration on `PrescoreInput` |
| `src/tracking/prescore.ts:77` (now :89) | `void input.independentEvidence;` — the only dereference in `src` |
| `src/tracking/from-child.ts:167` (now :177) | the write, in `prescoreInputFromObservation` |

Nothing else in `src` mentions it. `turn.ts:79-82` spreads `...input.prescoreInput` into `computePrescore` without touching the field, so the spread is not a read. Outside `src`: `docs/superpowers/plans/2026-08-18-phase-a-tracking-supervisor.md` (three plan literals) and five test files that construct `PrescoreInput` fixtures — all writes, none read it.

Producers of a `PrescoreInput` in `src`: `from-child.ts::prescoreInputFromObservation` only (the sole-production-path census in `criteria-are-guidance.test.ts` already holds this; re-verified). So the flag's *only* value in production is `verification?.kind === "PASSED" || verification?.kind === "FAILED"` — and since R9-2, on the pi path that `kind` can come from the child's own `sparkle_report_task_result`. The name promises corroboration the value cannot supply.

`applyChildThreeLine` in `src/run/child-tracking.ts`: one declaration, one call site (`flowchart-run.ts::executeClusteredNode`), which takes `events` and discards the result — R9-6's pin 3. `GateApplyResult` is already imported as a type at `child-tracking.ts:8`, so `{@link GateApplyResult}` resolves with **no new import** (hence no live-closure import; I ran `live-isolation.test.ts` anyway).

Path check before writing (R9-5's lesson): `src/tracking/from-child.ts`, `src/tracking/prescore.ts`, `src/run/child-tracking.ts`, `test/unit/tracking/` all exist; `test/unit/routing/live-isolation.test.ts` exists at that path.

## 2. What landed

### 2a. `independentEvidence` posture — recorded in three places, all comments

- **`from-child.ts`, on the write** (10 added comment lines): not third-party verification despite the name; it says only that the verifier reached a verdict, and since R9-2 that verdict can be the child's own report of what it ran; nothing reads it today, which is what keeps the gap harmless; a future consumer reading it as independent corroboration would be scoring a claim as if it were a check; recorded and deliberately **not** renamed (R10-5, parent-signed); names the pin file.
- **`prescore.ts`, on the `void`** (7 added comment lines): the discard is load-bearing, not a stray `void` — the flag is not corroboration and may not move the score; reading it here or anywhere is a decision with its own justification.
- **`prescore.ts`, on the declaration** (5 added JSDoc lines): what the field means (a verdict exists) versus what it does not mean (a party other than the actor confirmed it), and where the producer is. This is the place a future consumer actually looks first, which is why the posture is there and not only at the two use sites.

The field is **not renamed**, its type and value are unchanged, and no reader was added.

### 2b. `applyChildThreeLine` pointer — one line

```ts
/** Ledger, not control: callers append `events` and discard the rest — see {@link GateApplyResult}. */
export function applyChildThreeLine(input: {
```

This is the pointer R9-6 prescribed when it had to land the posture on the return type in `gate-apply.ts` (unowned file then). `runStatus` gains no consumer; `gate-apply.ts` untouched by me (R10-1 sole).

### 2c. Pins — `test/unit/tracking/independent-evidence-posture.test.ts` (new, 5 tests, additive)

1. **The record.** The posture is present at the write, at the discard, and on the declaration — matched after whitespace collapse against three phrase sets, so a rewrap cannot break the pin.
2. **The absence, whole-tree.** A recursive AST sweep of all `src/**/*.ts` collects every *dereference* of `independentEvidence` (property access, index access, destructure — declaring and writing are producer acts and deliberately not reads) and tags each with whether `void` immediately discards it. `deepEqual` against exactly one entry: `src/tracking/prescore.ts: void input.independentEvidence`. So both "somebody read it" and "somebody kept the read but dropped the `void`" are failures.
3. **The pins hold *these* sources down.** Mutations applied in memory to the real files, nothing written: rewrapping the real line comments at widths 58 and 96 and joining the real JSDoc's continuation lines leaves all three prose pins green (rewrap-safety proved on the actual source, R9-6's standard); restating the write-site posture in other words throws; deleting each of the three comment blocks throws; adding `const trusted = observation.independentEvidence;` to the real `from-child.ts` crosses the sweep; replacing the real `void input.independentEvidence;` with `if (input.independentEvidence) qualitySum += 1;` crosses it too; and a synthetic module that only declares and writes the field yields zero reads.
4. **The fact, at the producer.** Over `PASSED`/`FAILED`/`UNOBSERVED`/absent × three `evidenceIds` shapes × two `artifactIds` shapes, the flag is a function of `verification.kind` alone. Evidence and artifact ids are the facts that most *look* like a second party's corroboration; they provably do not reach it.
5. **The fact, at the consumer.** A 144-cell sweep of `PrescoreInput` (required/completed checks × constraints × retained ids × progressed × claims) asserts `computePrescore` is `deepEqual` with the flag `true` and `false`. The flag is inert today — which is the evidence behind "the mismatch is harmless *today*", rather than an assertion of it.

## 3. Comment-only proof

Filtering the added lines of my three `src` files through a comment pattern:

```
$ git diff -U0 -- src/tracking/from-child.ts src/tracking/prescore.ts src/run/child-tracking.ts \
    | grep -E '^\+[^+]' | sed 's/^\+//' | grep -vE '^\s*(//|/\*\*?|\*/?|\*\s)' | wc -l
0
$ git diff -U0 -- ... | grep -cE '^-[^-]'
0
```

Per file: `from-child.ts` +10/−0, `prescore.ts` +12/−0, `child-tracking.ts` +1/−0. **Zero non-comment added lines, zero removed lines** across all three.

## 4. Verification

- **Scoped eslint** over the three `src` files and the new test: exit 0.
- **Whole-tree `tsc --noEmit`**: contaminated by concurrent siblings (§5). To prove my own diff typechecks, I extracted `git archive HEAD` to `/tmp`, copied in **only** my four files, and ran `tsc --noEmit` there: **exit 0**. (Temp copy removed; no scratch files in the repo.)
- **Keep-green, in that same isolated tree** (HEAD's tests + my `src` comments + my pin file), `test/unit/tracking` + `gate-status-posture.test.ts` + `flowchart-run-abort.test.ts` + `gate-apply.test.ts` + `routing/live-isolation.test.ts`: **128 tests, 128 pass, 0 fail, 0 skipped.** That covers the criteria-are-guidance contract prose pins (which read `prescore.ts`/`from-child.ts` prose and are the pins my comments could most plausibly have disturbed), the 270-cell sweep, the sole-production-path census, R9-6's 8 `gate-status-posture` tests, and R6-2's FAIL-unreachable tripwire.
- **In the live working tree**, `test/unit/tracking` + `gate-status-posture.test.ts`: 90 tests, 89 pass, **1 fail — not mine** (§5).
- **My pin file 3×** in the working tree: 5/5 each time. **No new skip** anywhere (0 skipped in every run above; the standing `PI_SMOKE` skip is not in these files).
- Node v22.14.0 vs the `>=22.19.0` engine field: the expected warning, no other effect.

## 5. Shared-tree transients (attribution, timestamped)

The working tree is being edited by siblings while I ran. At 23:07:05Z whole-tree `tsc` reported errors in `src/run/events.ts` (R10-1, mid-edit adding `RUN_UNBLOCKED_WITH_DISCARD`), `test/unit/run/event-row-fuzz.test.ts` (R10-1), `test/integration/m2.5/resume.test.ts` (R10-4), `test/unit/run/episode-contract-boundary.test.ts` (R10-7), `test/unit/run/gate-status-posture.test.ts` (R10-9). A run one minute earlier produced a *different* subset, which is the churn itself. **Zero errors in any file I touched**, in either run.

The one live-tree test failure is `gate-status-posture.test.ts:423` — "currentGateStatus gives a matched discard authorization the same ledger status", which references `RUN_UNBLOCKED_WITH_DISCARD` before R10-1 has landed it. `git diff --stat HEAD` on that file shows **+39/−0** in the working tree and I did not touch it (my own diff, above, lists three `src` files and one new test file). R9-6's original 8 tests in that file pass in both trees. As of 23:08:43Z this is R10-9's pending work racing R10-1's, not a regression from my diff.

## 6. Disclosures

1. **Three comment sites, not one.** The mandate allowed "the field write and/or the void"; I also put a short JSDoc on the declaration in `PrescoreInput`, because that is where a future consumer looks before either use site, and the pin would be weaker if the type were silent. Still comment-only, still no rename.
2. **The pointer line is 100 characters.** No line-length rule is configured (`eslint.config.js` has none) and eslint is clean, but it is longer than the surrounding prose typically wraps. Kept on one line because the mandate asked for one and the `{@link}` reads better unsplit.
3. **The "harmless today" claim is scoped, and pinned as such.** Pin 5 shows the flag is inert *in `computePrescore`*. It does not — and cannot — show that no future scoring path will read it; that is what pin 2's absence sweep is for. I state both rather than letting the inertness pin imply more than it proves.
4. **I did not pin the `child-tracking.ts` pointer's prose.** R9-6's pin already holds the posture at `GateApplyResult` and holds `runStatus`'s zero-reader property across all of `src`; a prose pin on a one-line pointer would freeze wording without adding a fact, and `gate-status-posture.test.ts` is R10-9's file this round. The pointer's `{@link}` target is checked by `tsc` in the ordinary way.
5. **`prescore.ts` and `from-child.ts` are option-(a) files.** R10-2 is deferred, so the collision the brief warned about did not occur. When option (a) lands (Round 11), whoever gives `independentEvidence` a per-criterion meaning inherits pin 2 deliberately: it will fail on the first read, which is the point.

## 7. Handoff

- Recorded, not renamed, as signed off. A rename remains available to a later round; the posture comments and pin 2 are what make it a decision rather than a drive-by either way.
- If R10-1's discard lands and adds a `src` module, pin 2's sweep picks it up automatically (recursive, whole-`src`) — no coordination needed.
- Files touched: `src/tracking/from-child.ts`, `src/tracking/prescore.ts`, `src/run/child-tracking.ts` (all comment-only), `test/unit/tracking/independent-evidence-posture.test.ts` (new). Net `src`: +23/−0, every line a comment.

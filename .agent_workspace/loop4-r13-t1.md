[Model: opus-fast]

# Loop 4 · Round 13 · R13-1 — the two false "no writer" docstrings, retired

**Landed. Not stopped-and-reported.** Both mandated passages are truthed up; the whole diff is mechanically comment-only; **no pin had to move**, so neither of the two test files I conditionally owned was touched.

Branch `agent/opt-continuous`, working tree only. No `git checkout`, no commit, no push.

## 1. Census, taken first, against the working tree

Taken **2026-08-25 01:28–01:30 UTC**, HEAD `aa7282f`. Every path the brief handed me exists; I verified each before writing.

| Path | State at census | Mine? |
|---|---|---|
| `src/run/replay.ts` (528 lines) | exists; false text present at **107–110**, exactly as quoted | sole, comment-only |
| `src/tracking/prescore.ts` (208 lines) | exists; false text present at **168–176** (brief said "~168-176" — exact) | sole, comment-only |
| `test/unit/tracking/option-a-preconditions.test.ts` (7 pins) | exists | conditional — **not edited**, §2 |
| `test/unit/tracking/criteria-are-guidance.test.ts` (11 pins) | exists | conditional — **not edited**, §2 |

Both quoted line ranges were accurate at HEAD; no drift to report.

**Shared-tree transients observed, with timestamps, none mine:** `docs/status-matrix.md` modified **01:29:06** and `docs/specs/m0-m2-architecture.md` **01:29:22** (R13-4, which also picked up `docs/data-dictionary.md` and the phase-A plan by 01:31); `test/integration/run/criteria-gate.test.ts` **01:29:42** and `test/integration/m2.5/resume.test.ts` by **01:31** (R13-2); `src/cli/main.ts` + `test/integration/cli/blocked-next.test.ts` by **01:31** (R13-3); sibling reports `.agent_workspace/loop4-r13-t{4,5,6,7,8,9,10}.md` appeared untracked during my window.

**HEAD moved mid-slot: `aa7282f` → `3862b10`** (three commits, `dfb185b`/`e744b4a`/`3862b10`, all orchestrator bookkeeping). `git diff aa7282f..3862b10 -- src/run/replay.ts src/tracking/prescore.ts` is **empty** — neither of my files was touched — but I re-ran every proof and every check against the new base rather than trusting that, and §4/§5 report the post-move numbers. My two files remain the only `src` entries in `git status` that are mine; `src/cli/main.ts` is R13-3's.

## 2. Pins-first census — the load-bearing result

I censused every consumer that reads these two files' **source text** (not just the two files the brief named), because a prose pin can live anywhere. Whole-`test` grep for `run/replay.ts` and `tracking/prescore.ts`, then read each hit.

| Consumer | What it matches | Sits in the prose I rewrote? | Action |
|---|---|---|---|
| `option-a-preconditions.test.ts:620` | region regex `export interface FlowchartCheckpointState \{[\s\S]*?^\}$` | no — structural | none |
| `option-a-preconditions.test.ts:622` | `taskCriteria\?: TaskAcceptanceCriteria\[\]` | no — the declaration at 112 | none |
| `option-a-preconditions.test.ts:623` | `never \*synthesized\*` | **no — replay.ts:98**, the paragraph *above* the false one | none |
| `option-a-preconditions.test.ts:624` | `not from the bound episode` | **no — replay.ts:98–99**, same paragraph | none |
| `resume.test.ts:411-412` | same declaration + `never \*synthesized\*` | no | none (and not mine) |
| `episode-contract-boundary.test.ts:110` | AST interface members of `FlowchartCheckpointState` | no — comments are invisible to the parse | none |
| `criteria-are-guidance.test.ts:384` | prose *"a criterion this dimension reads … not evidence about it"* | no — prescore.ts:141–142 | none |
| `criteria-are-guidance.test.ts:390` | prose ``/`unmet-acceptance-criterion` anomaly/`` | no — prescore.ts:147, the R11-1 paragraph | none |
| `criteria-are-guidance.test.ts:397` | raw `/flowchart-run-abort\.test\.ts/` on the **whole file** | **YES — the only occurrence in `prescore.ts` is line 175, inside the paragraph I rewrote** | **carried through verbatim** |
| `independent-evidence-posture.test.ts:39` | whole-`src` `independentEvidence` census (declaration + one `void`) | no — I added and removed zero mentions | none |

**The near-miss, stated plainly:** the string `test/unit/run/flowchart-run-abort.test.ts` appears in `prescore.ts` exactly once, and it is inside the false paragraph. A rewrite that dropped the FAIL-unreachable tripwire sentence — which is the natural thing to do when the paragraph around it shrinks — would have turned `criteria-are-guidance.test.ts:397` red. The mandate's "keep FAIL-unreachable tripwire sentence" and that pin are the same requirement reached from two directions. I kept the sentence, so the pin matches unchanged.

**Conclusion: no pinned sentence had to move.** Both conditional test files are byte-untouched, which is the outcome the "replacement not deletion" rule prefers. Nothing to disclose there beyond this census.

Mutation-proved in memory (no shared-tree mutation, siblings were live): rewriting obligation 1 *without* the tripwire sentence flips `/flowchart-run-abort\.test\.ts/` from `true` to `false`, i.e. the pin bites the exact mistake this slot could have made. Shipped text: green.

## 3. What changed

### 3.1 `src/run/replay.ts` — 4 comment lines out, 7 in

Was (false since `81f5b81`):

> No `src` writer fills this yet — the flowchart checkpoint writer is `run/flowchart-run.ts`, outside this diff's ownership. Declared and validated here so the shape is fixed and a malformed value fails closed; the writer is prescribed in `.agent_workspace/loop4-r11-t1.md`.

Now, R12-1 §8.1's prescribed prose, kept faithful and rewrapped:

> `run/flowchart-run.ts` fills this: the caller's child specs when a run accepts them, and any logged `TASK_REQUEST` that carries criteria, first-write-wins and ordered by ascending `taskId`. A logged request with no criteria is deliberately ignored — on the log it is indistinguishable from a substituted one — so absence still means unknown, and only the caller's own spec can say known-none. Declared and validated here so the shape is fixed and a malformed value fails closed.

Two deliberate retentions and one deliberate omission:

- I kept **"Declared and validated here so the shape is fixed and a malformed value fails closed."** That clause was true before the writer and is still true — it is why the field's validator lives in this file rather than in the writer's — and dropping it would have lost a fact while fixing a falsehood.
- I wrote **"ordered by ascending `taskId`"** rather than §8.1's bare "ascending `taskId`" so the sentence reads as the writer producing the shape the paragraph two above already requires of the validator, not as a second, competing rule.
- I dropped the pointer to `.agent_workspace/loop4-r11-t1.md`. A prescription file is the right citation for work that has not happened; once the writer exists, `run/flowchart-run.ts` is the citation, and it is now the sentence's subject.

### 3.2 `src/tracking/prescore.ts` — obligation 1, 9 comment lines out, 11 in

Was: *"resumed child specs are re-synthesised with empty criteria"* as a standing fact, plus *"which is declared and validated but has no writer yet."*

Now obligation 1 opens **"a resumed child spec is re-synthesised with empty criteria only where nobody recorded the node"**, names `run/flowchart-run.ts` as the writer and its two record sources, and says a recorded node is re-asked on resume for exactly what it was dispatched with. "has no writer yet" is gone. The obligation stays **open** and stays **one of two**, because it genuinely still is: a node neither source names still carries no spec, and this function still does not satisfy that — which is the whole point of the paragraph.

Everything downstream of that is byte-preserved: the unknown-not-unmet sentence, `unmet-acceptance-criterion` fires only on a reported FAILED, a node that never ran reports nothing, and the FAIL-unreachable tripwire sentence naming `test/unit/run/flowchart-run-abort.test.ts`.

## 4. Mechanically comment-only — proven two independent ways

The mandate's hard constraint, so I did not eyeball it.

1. **Token-stream identity.** Scanned both files at `HEAD` and in the working tree with the real TypeScript scanner in `skipTrivia` mode (comments are trivia and are dropped), joined every token's kind and text with `NUL`, and compared. **Identical for both files** — `sha(head) == sha(work)` = `5a9609728477` for `replay.ts`, `a40ff78fa63e` for `prescore.ts` — while the raw bytes differ. Zero non-comment tokens changed, added, or removed. Re-run after the HEAD move against `3862b10`: same two hashes, still identical.
2. **Textual filter over the diff.** Every added/removed line in `git diff -U0` for both files, with leading whitespace stripped, filtered to lines not beginning `*`, `/**`, or `*/`: **empty set.**

**`coverageOutcome` body byte-identical:** confirmed by extracting the function from both sides and comparing — `true`, 265 bytes, `sha256:feb4e48cdd87f9cd…`; re-confirmed against `3862b10`. I never entered the function; only the docstring above it moved.

**Pinned sentences, re-asserted directly against the working tree** (all PASS): the `FlowchartCheckpointState` region regex still matches; `taskCriteria?: TaskAcceptanceCriteria[]`; `never *synthesized*`; `not from the bound episode`; prescore's asked-for-is-not-evidence sentence under the pin's own `prose()` normalization; ``​`unmet-acceptance-criterion` anomaly``; raw `flowchart-run-abort.test.ts`.

**No behavioural `src`.** Follows from (1): the compiled output of both files is unchanged.

## 5. Verification

Run twice: first at **01:29–01:30 UTC** on `aa7282f`, then re-run in full at **01:31–01:32 UTC** on `3862b10` plus the siblings' in-flight working tree. Both passes identical; the numbers below are the later one. Node v22.14.0 (engine warning only).

- **Whole-tree `pnpm exec tsc --noEmit`: exit 0** — green with R13-2's, R13-3's and R13-4's in-flight edits also in the tree.
- **Scoped `pnpm exec eslint src/run/replay.ts src/tracking/prescore.ts`: exit 0**, zero findings.
- **Consumer tests 3×.** I edited no test file, so nothing is "owned tests" in the strict sense — but my edit changes the bytes four files grep, so I ran all four consumers three consecutive times: `option-a-preconditions.test.ts` + `criteria-are-guidance.test.ts` + `episode-contract-boundary.test.ts` + `independent-evidence-posture.test.ts` — **28/28 pass, 0 fail, 0 skipped** on each of the three runs, on each of the two passes. I introduced no skip.
- **No full `pnpm gate`** (parent's job), **no crash-probe** (no writer, lock, or fs primitive is reachable from a comment).
- **No `live-isolation.test.ts` run:** the diff adds no import of any kind.
- **No scratch files.** Both verifications ran as inline `node --input-type=module -e` invocations; nothing was written to disk, in `/tmp` or in tree, and the shared tree was never mutated (the §2 mutation proof is in-memory precisely because siblings were running).

## 6. Frozen contracts, re-checked after my diff

`taskCriteria` writer untouched as shipped (no `src` behaviour changed at all — §4); `independentEvidence` still exactly one `void` in whole `src`; the eight `RunStatus` members untouched; ADR-006 untouched (I edited no docs); `coverageOutcome` still has no FAIL in its range and its body is byte-identical; the FAIL-unreachable tripwire reference survives; `childTasksFromLog` and the reconstruction pins untouched. I edited none of `src/run/flowchart-run.ts`, `src/cli/main.ts`, `docs/**`, `unblock-flow.test.ts`, `replay.test.ts`, or any writer/reader implementation.

## 7. Residuals

1. **`src/run/replay.ts:85–93` narrates the laundering hazard in the present tense, and is now half-stale.** It says `childTasksFromLog` "gives a node whose `TASK_REQUEST` was never logged `acceptanceCriteria: []`; the node then runs and appends a real `TASK_REQUEST` carrying that empty list, which the last-request-wins rule makes authoritative for every later resume." Since `81f5b81` that is only true of a node **neither** source recorded — for a recorded node, `withRecordedCriteria` restores the spec at `childTasksFromLog`'s sole call site before the node runs. I did **not** touch it: it is outside the mandate (which names the two "no writer" docstrings and quotes their exact text), the parent's sign-off is scoped to those, and the claim about `childTasksFromLog` *itself* remains literally true because the reader is a post-step at the call site rather than inside that function. It is nonetheless the next honesty-debt spot in this docstring, and a reader who takes it as current state will over-estimate the hazard the field still carries. Flagging for a future comment-only slot; it needs its own sign-off, not my improvisation.
2. **`test/unit/tracking/option-a-preconditions.test.ts:618` still points at `.agent_workspace/loop4-r11-t1.md`** for "the prescribed edit", which R12-1 landed in `resume.test.ts`. It is a test-file comment, not an assertion, and no pin reads it. I own that file only for moving a pinned sentence, which was not needed, so I left it. Cheap for whoever next owns that file.
3. **`docs/**` carries the same two false claims** (`docs/specs/m0-m2-architecture.md:367`, `docs/status-matrix.md:36,60`) — R13-4's, and it was editing both files during my window (§1 timestamps). My corrected source is now the citable one, which is the sequencing the brief asked for.
4. **No behavioural risk introduced and none closed.** This slot moves prose only; it adds no test and therefore no proof. The facts the new prose states are the ones `81f5b81` proved and the R12 review verified — I re-read the writer's three sources and the empty-logged-request guard in `flowchart-run.ts` before writing the sentence, rather than copying §8.1 on trust.

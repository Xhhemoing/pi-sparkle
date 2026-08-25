MODEL_SLUG: claude-opus-5-thinking-high-fast

# Loop 4 · Round 22 · slot R22-1 — `docs/kernel-reuse.md` truth-up under the lifted freeze

Slot HEAD: `ab9c6dd` on `cursor/opt-r22-42b1` (`63a4443` + the Round 22 audit commit).
No commit made, no branch moved, no `src/` edit, no test edit, no runtime change.
Scope executed exactly as ROUND22-BRIEF §4 R22-1 specifies; ownership respected
(`docs/kernel-reuse.md` and `.agents/skills/pi-sparkle/references/kernel-reuse.md` only).

## 1. Census first (before editing)

- Both handed paths verified present at HEAD.
- Working tree verified clean at slot start (`git status --short` empty).
- Every fact I wrote was re-read from source at this HEAD, not from the brief:
  - `src/execution/contract.ts:61` — `steerText?(text: string, agentInstanceId?: AgentInstanceId): void;`
  - `src/pi-adapter/pi-executor.ts:712-737` — targeted branch resolves `liveKernels.get(agentInstanceId)`,
    throws `DomainValidationError("cannot steer: no agent run is in flight for …")` on a miss;
    untargeted branch is unchanged sole-live-or-refuse (0 live → refuse, >1 live → refuse).
  - `src/pi-adapter/pi-executor.ts:739-745` — `deliver` records into `acceptedSteers` only after the
    kernel took the text.
  - `src/pi-adapter/pi-executor.ts:572-583` — replay is latched (`replayPending`) and fired inside the
    `TURN_FINISHED` branch, i.e. at the attempt's *first* `TURN_FINISHED`.
  - `src/pi-adapter/pi-executor.ts:640-690` — `acceptedSteers` is execution-scoped: opened and deleted
    inside `runWithRetry`; `:662` snapshots `[...steers]` before each attempt.
  - `src/run/coordinator.ts:369-382` — `startRun` calls `steerChannel.open(record, agentInstanceId)` →
    **targeted**. `src/run/coordinator.ts:804-813` — `startParentRun` calls `open(record)` with no
    instance → **untargeted**.
  - `src/run/coordinator.ts:274-279` — `this.executor.steerText(text, this.target)` runs *before*
    `record(text, actor)`, so a targeted miss throws before any write.
  - Commit dates confirmed by `git log`: `4412fac` (R18-1) and `57ade59` (R20-2) are both **2026-08-25**,
    which is the supersede date the brief specifies and the date I used.
- Cited test files verified to exist with the exact names my "Verified by" parentheticals describe:
  - `test/integration/pi-adapter/steer-retry.test.ts:183` "a steer accepted before a retried provider
    failure reaches the retry's context"; `:246` "a steer survives more than one retry and is
    re-delivered exactly once per attempt".
  - `test/integration/pi-adapter/steer-target.test.ts:184` "a steer aimed at a run in retry backoff is
    refused, not delivered into a run sharing the executor"; `:290` "a steer through a live run's own
    handle reaches that run and no other on the same executor"; `:434` "a parent run steers whichever
    child is live, naming no agent instance".
- **Census terminator (consumers of the changed claims).** Outside the two owned files, the only file
  in the repo still carrying the superseded steer wording is
  `docs/reports/2026-08-24-kernel-reuse-audit.md` (`:86`, `:202`, `:213`) — the dated report the brief
  explicitly freezes as historical. Verified untouched (byte-identical, §4 below). No other doc, skill,
  ADR, spec, or script asserts the old signature or the old retry-drop semantics as current:

  ```
  rg -n 'steerText|queued steering|survive a retry|survive a retried|document-and-drop' \
    --glob '!node_modules/**' --glob '!src/**' --glob '!test/**' --glob '!.agent_workspace/**' \
    --glob '!docs/kernel-reuse.md' --glob '!.agents/skills/pi-sparkle/references/kernel-reuse.md' .
  # → only docs/reports/2026-08-24-kernel-reuse-audit.md (frozen, historical),
  #   docs/decisions/0001-pi-adapter-boundary.md:13 (describes Pi's own Agent API, not sparkle's
  #   contract — not a superseded claim), and scripts/kernel-reuse-probe.mjs (source regexes).
  ```

- **No line-number cross-references exist into either file**, so the line shifts my edits cause break
  nothing: `rg -n 'kernel-reuse\.md'` outside the two files matches only four bare-filename mentions in
  the dated report.
- No scoped `eslint` / `tsc` run: this diff is two Markdown files, no `src/`, no `test/`.

## 2. What changed

### `docs/kernel-reuse.md` (5 hunks)

1. **`:3` Status header** — refreshed to `current as of 2026-08-25 (branch cursor/opt-r22-42b1)` and it
   now names the truth-up and both superseding commits, plus the rule that dated subsections stay
   historical and carry a bracketed pointer where they asserted a superseded fact as current.
2. **`:54` → `:58` wired-today steering row** — rewritten to the shipped contract:
   - optional `steerText?(text, agentInstanceId?)` on `src/execution/contract.ts`;
   - `startRun` opens its steer window **targeted** at that run's own root agent instance;
   - `startParentRun` has no agent of its own and opens **untargeted**, keeping the disclosed
     whichever-child-is-live semantics;
   - a targeted miss is refused loudly — a `DomainValidationError` thrown **before any write**, so a run
     in retry backoff never has its text handed to a sibling the same executor is driving;
   - untargeted behaviour explicitly unchanged sole-live-or-refuse;
   - accepted steers are noted as re-delivered on later retry attempts of the same execution, pointing at
     the "Retry resets the agent" bullet;
   - Status cell now reads `wired (landed mid-round 2026-08-24; targeted 2026-08-25)`;
   - **"Verified by" gains `test/integration/pi-adapter/steer-target.test.ts` and
     `test/integration/pi-adapter/steer-retry.test.ts`** (both with a parenthetical matching their real
     test names), alongside the three suites already listed.
3. **`:131-136` → `:143-158` "Retry resets the agent" bullet** — rewritten to the shipped truth: a fresh
   `Agent` per attempt means nothing held *inside the discarded kernel* survives (its steering/follow-up
   queues, `sessionId`, and only the last attempt's events form the invocation record), **but** a steer
   accepted through the contract is kept for the rest of the execution and re-delivered on the next
   attempt at that attempt's first `TURN_FINISHED` — where the loop polls its steering queue — latched
   once per attempt and execution-scoped to `runWithRetry` (R18-1). Extender guidance now splits: steer
   through the contract and re-delivery is handled; anything queued straight onto a kernel is still lost
   and such a feature must re-arm itself or document the drop.
4. **`:213-214` → `:232-242` worked example step 2** — the section bills itself as "the answers filled
   in", so the current answer is filled in: the executor forward is **now targeted** (R20-2, `57ade59`),
   a target with no attempt in flight is refused loudly rather than delivered into whichever sibling is
   live; and the retry decision **was initially document-and-drop … and was superseded 2026-08-25 by
   R18-1 (`4412fac`)** with per-attempt re-delivery, with kernel-queued text still lost.
5. **Journal pointers, prose untouched** — `:72` (now `:76-82`) and `:80-82` (now `:88-94`) each gained a
   **bracketed superseded-pointer appended after byte-identical prose**, no rewrite:
   - after the `steerText?(text)` bullet: `[Superseded 2026-08-25 by R20-2 57ade59: … two-parameter
     steerText?(text, agentInstanceId?), and the channel opens targeted on startRun, untargeted on
     startParentRun. See the wired-today table above.]`
   - after the "Retry semantics unchanged … documented as dropped" bullet: `[Superseded 2026-08-25 by
     R18-1 4412fac: … re-delivered at each retry attempt's first TURN_FINISHED. Only text queued directly
     on the discarded kernel is still lost. See "Retry resets the agent" below.]`

   Machine-checked: stripping exactly those two bracketed blocks from the working tree's Round 2 + Round 3
   journal reproduces the HEAD journal **byte-for-byte** (script in §4).

### `.agents/skills/pi-sparkle/references/kernel-reuse.md` (2 hunks, in lockstep)

6. **`:42-47` Executor bullet** — two-parameter `steerText?(text, agentInstanceId?)`; targeted delivery to
   that instance's live kernel; targeted-miss refusal loud (`DomainValidationError`, before anything is
   written) with the retry-backoff example and the "never handed to a sibling on the same executor"
   consequence; untargeted keeps sole-live-or-refuse. The "missing method means steering unsupported"
   sentence is preserved.
7. **`:112-118` item 6** — retry semantics truthed up: `followUpText` messages and `sessionId` still do
   not survive (kept, as required), only the last attempt's events surface (kept), but steers accepted
   through the contract survive and are re-delivered at the next attempt's first `TURN_FINISHED`, once
   per attempt (R18-1), so a `RunningRun.steer` feature needs no re-arm of its own while kernel-queued
   text is still lost with its attempt.

## 3. Regression greps — old claim strings gone

Baseline captured before editing, re-run after. All greps run from `/workspace`.

**Before (HEAD):**

```
$ rg -n 'steerText\?\(text\)' docs/kernel-reuse.md .agents/skills/pi-sparkle/references/kernel-reuse.md
.agents/skills/pi-sparkle/references/kernel-reuse.md:42:   - *Executor.* `AgentExecutor` declares optional `steerText?(text)`
docs/kernel-reuse.md:72:- `AgentExecutor.steerText?(text)` on the contract; `RunningRun.steer(text,

$ rg -n 'went to document-and-drop' docs/ .agents/
docs/kernel-reuse.md:213:   in flight. The retry decision went to document-and-drop: queued steering

$ rg -n 'do not survive' docs/ .agents/
.agents/skills/pi-sparkle/references/kernel-reuse.md:114:   and follow-up messages do not survive a retry, and only the last
docs/kernel-reuse.md:132:  attempt. Queued steering/follow-up messages and `sessionId` do not survive a
```

**After (this diff):**

```
$ rg -n 'went to document-and-drop' docs/ .agents/          → exit 1 (no match)
$ rg -n 'do not survive a retried attempt' docs/ .agents/   → exit 1 (no match)
$ rg -n 'do not survive a retry' docs/ .agents/             → exit 1 (no match)
$ rg -n 'targets the single in-flight kernel' docs/kernel-reuse.md                       → exit 1
$ rg -n 'refuses when zero or several runs are live' docs/kernel-reuse.md                → exit 1
$ rg -n 'zero or several agents are in flight, otherwise forwards' .agents/…/kernel-reuse.md → exit 1
```

So the one-parameter sole-live claim at `:54`, the skill's one-parameter Executor bullet, the
"went to document-and-drop" sentence, and both unqualified "do not survive a retry(-ied attempt)"
assertions are all gone as current-semantics claims.

**One literal string deliberately remains, and it is annotated — read this bit.** The guard names
"`steerText?(text)` one-parameter at `:54`/`:72`". At `:54` that was never a literal (the row said
"optional `steerText?`" plus sole-live prose) and it is now fully rewritten. At `:72` the brief's own
§4 requires the opposite of deletion — that dated journal bullet "get[s] a bracketed superseded-pointer
only, no rewrite … All other journal prose stays byte-identical". The two instructions are reconcilable
only under the guard's own qualifier, "as unqualified current semantics": the literal survives inside
historical prose, but no longer asserts anything as current. Evidence:

```
$ rg -n 'steerText\?\(text\)' docs/kernel-reuse.md .agents/skills/pi-sparkle/references/kernel-reuse.md
docs/kernel-reuse.md:76:- `AgentExecutor.steerText?(text)` on the contract; `RunningRun.steer(text,
```

— one hit, in the Round 2 dated journal, immediately followed by its pointer:

```
76:- `AgentExecutor.steerText?(text)` on the contract; `RunningRun.steer(text,
77-  { actor? })` wired through a `SteerChannel` that is open only while
78-  execution is in flight, delivers to the executor before logging, and
79-  blocks run settlement on the event-log write.
80-  [Superseded 2026-08-25 by R20-2 `57ade59`: the contract signature is the
81-  two-parameter `steerText?(text, agentInstanceId?)`, and the channel opens
82-  targeted on `startRun`, untargeted on `startParentRun`. See the
83-  wired-today table above.]
```

Machine-checked as a property rather than by eye — **no occurrence of the one-parameter literal exists
without a superseded pointer within its bullet**:

```
$ rg --pcre2 -n -U --multiline-dotall 'steerText\?\(text\)`(?!(?:.){0,400}Superseded)' \
    docs/kernel-reuse.md .agents/skills/pi-sparkle/references/kernel-reuse.md
exit 1   # no unannotated occurrence
```

If the parent wants the literal gone from the journal too, that is a one-line change to `:76` — but it
would contradict §4's "no rewrite / byte-identical journal prose", so I did not make it unilaterally.

## 4. Frozen surfaces — machine-checked byte-identical

Extracted each frozen block from `git show HEAD:<path>` and from the working tree and compared bytes:

```
BYTE-IDENTICAL  docs cost-stop-outranks-steer bullet  (1468 bytes)
BYTE-IDENTICAL  docs 'No CLI verb for live steer exists yet' paragraph  (439 bytes)
BYTE-IDENTICAL  docs verification-gates section  (700 bytes)
BYTE-IDENTICAL  docs ADR-001/006 rule text  (387 bytes)
BYTE-IDENTICAL  docs facade-only row  (202 bytes)
BYTE-IDENTICAL  skill :120-130 cost-stop drop path  (695 bytes)
BYTE-IDENTICAL  skill ADR-001/006 rule text  (165 bytes)
BYTE-IDENTICAL  skill verification section  (612 bytes)
BYTE-IDENTICAL  docs/reports/2026-08-24-kernel-reuse-audit.md (whole file)

ALL FROZEN BLOCKS BYTE-IDENTICAL
```

Journal prose check (same method, Round 2 + Round 3 sections):

```
pointers removed: 2
journal prose byte-identical after removing the bracketed pointers: True
```

One deliberate non-change worth naming: the section heading `## What is wired today (verified
2026-08-24)` still says 2026-08-24. The brief scopes the date refresh to the `:3` Status line, and
bumping the heading would claim I re-verified **every** row today when I only re-read the steering row's
source. The `:3` header carries the 2026-08-25 truth-up note instead, which is the honest split.

Also confirmed: **nothing in this diff pre-describes R22-2 or R22-3.** I added no mention of a
`--max-cost-usd` flag, a flowchart run-level cap, `onCostGate` CLI wiring, or any unlanded surface. The
Spend-ceiling row is untouched. The Markdown table is still well-formed — every row in the wired-today
table has exactly 5 pipes (4 cells), verified programmatically. No trailing whitespace introduced.

## 5. Probe

```
$ node scripts/kernel-reuse-probe.mjs
PASS live-stream: subscribe events feed an async yielding path
PASS kernel-facade: src/pi-adapter/kernel.ts exports steerText
PASS executor-steer: PiAgentExecutor forwards steerText to a live kernel
probe exit=0
```

**3 PASS, exit 0** — unchanged from the pre-edit baseline I captured at slot start, as expected: the
probe greps `src/` only and reads neither doc.

## 6. Hygiene and one thing the parent should know

- No commits, no `git checkout`, no PROGRESS tick. No mutations run (none owed: no runtime, no tests).
  No out-of-tree copies created, therefore none to delete. I created **no** scratch files anywhere.
- I ran no tests (only the probe, which is a pure grep script), so I did not clear `/tmp/tsx-*`.
  `/tmp/tsx-1000` exists but predates this slot and is not mine; deleting it could break a concurrently
  running sibling, so I left it alone.
- **R22-2 is editing the same working tree concurrently; none of that is mine.** The tree was clean when
  I started (`git status --short` empty at slot start) and I touched only the two Markdown files I own.
  By the time I finished, `git status --short` also showed `src/run/flowchart-run.ts`,
  `docs/specs/m0-m2-architecture.md`, `docs/data-dictionary.md` and an untracked
  `test/integration/m2.5/flowchart-run-cap.test.ts` — exactly R22-2's declared ownership set, carrying
  its work (`FlowchartRunInput.maxCostUsd`, pre-lock fail-closed validation, `RUN_CREATED.limits`
  stamping, `attachChildRuntime` carriage at both call sites). It grew *during* my slot, so R22-2 is
  running in parallel rather than in the briefed R22-1 → R22-2 order. Consequences for whoever stages
  this: my landing is **exactly** these two paths —

  ```
  docs/kernel-reuse.md
  .agents/skills/pi-sparkle/references/kernel-reuse.md
  ```

  plus this report. Stage nothing else on my behalf. Two knock-on notes: the parent's "no scratch files
  at report time" and "working tree clean" checks cannot be satisfied by me alone while a sibling writes
  to the same tree; and since R22-2 is landing the flowchart cap in parallel, someone should re-check at
  merge time whether its diff stale-ifies anything here (I believe it does not — my diff says nothing
  about the cost plane, and per §3 of the brief R22-2 may not edit these two files anyway).

## 7. Verdict

`docs/kernel-reuse.md` and the skill reference now describe the steering contract that actually shipped:
two-parameter targeted `steerText`, targeted-miss refusal before any write, `startRun` targeted /
`startParentRun` untargeted, and per-attempt re-delivery of contract-accepted steers across retries —
with kernel-internal queues, `followUpText` and `sessionId` still honestly documented as not surviving.
Dated journal prose is untouched apart from two bracketed pointers. Every surface the brief froze is
byte-identical, and the probe is still 3 PASS.

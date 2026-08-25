MODEL_SLUG: claude-fable-5-thinking-xhigh

# Round 2 report — R2-fable-A (spec union + kernel-reuse Round-2 status)

This file replaces the prior cycle's SOTA re-review report, per the same
convention R1-fable-A used for round-1 files.

**Round shape note:** the tree mutated under me mid-round. My first
verification pass found P0 inject→steer unwired (`RunningRun` exposed only
`runId`/`done`/`cancel`), and I drafted the docs accordingly; the P0 wiring
(plus P1 `cost-gate.ts` and an overlay update) then landed in the working
tree while I was writing. I re-ran every gate and corrected all three
deliverables to the post-landing state before finishing. Everything below is
the final state, verified after the landing.

## Delivered (exclusive write paths only; nothing committed)

1. **`docs/specs/m0-m2-architecture.md`** — the `ExecutionEvent` union in
   the Pi Adapter section now matches `src/execution/contract.ts`: added
   `{ type: "THINKING_DELTA"; bytes: number }` (comment states CoT text
   never enters the stream) and `{ type: "MESSAGE"; message: AgentMessage }`
   (kept because code has it: emitted by `src/pi-adapter/pi-executor.ts`,
   `src/testing/fake-executor.ts`, `src/cli/main.ts`; consumed by
   `src/run/child-coordinator.ts` and `src/run/flowchart-executor.ts`).
   Added a dated correction paragraph naming `src/execution/contract.ts` as
   authoritative. Closes audit §4.1 / R1-fable-A's "spec drift needs an
   owner" handoff.
2. **`docs/kernel-reuse.md`** —
   - Wired-today table: split the last row. Live steering
     (`RunningRun.steer` → `AgentExecutor.steerText?` → facade) is now
     **wired (landed mid-round)** with its evidence and three test suites;
     `followUpText`/`reset`/`sessionId` stay "exposed, not product-wired".
   - New "Round 2 status" subsection: what landed, the persistence policy
     (steer text + actor as `STEER_INJECTED`; verbatim is correct because it
     is user-authored input, not CoT), retry drop-on-retry unchanged, the
     gate correction (below), and what stays open.
   - Worked example retitled "(landed 2026-08-24)" and rewritten as the
     plan-vs-actual mapping: handle on `RunningRun`, optional contract
     method, document-and-drop retry, separate event type from flowchart
     inject, tests at all three layers.
   - Corrected the mechanical ADR-001 merge gate in both places it
     appears: raw-substring grep → import-specifier grep (see finding 2).
3. **`docs/reports/2026-08-24-kernel-reuse-audit.md`** — appended "§5
   Round 2 addendum": the mid-round mutation stated explicitly, P0 landing
   evidence itemized, §4.1 marked resolved (with the remaining
   `AgentExecutionRequest` drift flagged), the stale-gate finding with exact
   hit lines, gates re-run. Also corrects §2's "index.ts export" phrasing
   (the index re-exports the `SparkleKernel` class, not the method names).
4. This report.

## Verification (commands run on this VM, 2026-08-24, post-landing)

- **P0 landed, but the circulated claim gate misses it:**
  `rg -n "RunningRun.steer" src/run/coordinator.ts` → **no match (exit 1)**
  even post-landing, because `steer(text, options?)` is declared inside the
  multi-line `interface RunningRun` block (coordinator.ts:79–101). Gates
  that do distinguish: `rg -n "steer\(text" src/run/coordinator.ts` (hits
  100, 128) and `rg -n -U "interface RunningRun \{[\s\S]*?steer\("
  src/run/coordinator.ts` (hits 79). Both `startRun` (line 315) and
  `startParentRun` (line 639) return the `steer` handle. Per the brief's
  rule I could not flip status on the literal gate alone, so the docs claim
  "landed" on the direct-read + multiline-grep + passing-test evidence and
  record the gate correction explicitly.
- `src/execution/contract.ts` read directly: `steerText?(text)` on
  `AgentExecutor` (line 53) with the inject-vs-steer distinction in its doc
  comment; union has `THINKING_DELTA { bytes }` and `MESSAGE`; request
  gained `maxCostUsd` (P1 work, not mine to claim).
- `STEER_INJECTED` exists in `src/run/events.ts` (payload text, steering
  principal is the event's `actor`) and `src/run/replay.ts:155`.
- Steer tests: `pnpm exec tsx --test steer-inflight.test.ts
  steer-blocked-tool.test.ts test/integration/m0/steer.test.ts` —
  **8 pass, 0 fail, 1 skip**. The skip is the pre-landing placeholder
  `test.skip("RunningRun.steer forwards in-flight text…")` in
  `steer-inflight.test.ts`; its coverage now lives in `m0/steer.test.ts`.
- Original three suites (`kernel`, `translate-thinking`, `live-stream`)
  plus the three steer suites, final re-run on the latest tree: 14 pass,
  0 fail, 1 skip (the stale placeholder). `node
  scripts/kernel-reuse-probe.mjs` — PASS, exit 0; the probe gained a third
  check mid-round (`executor-steer`) and all three pass.
- Boundary gate: `rg -n "@earendil-works" src/ --glob '!src/pi-adapter/**'`
  is **not empty** — six data-mention hits in `src/pi-compat/check.ts`
  (49, 50, 135, 136, 154, 155). The import-specifier form
  `rg -n "(from|import\(|require\()\s*[\"']@earendil-works" src/ --glob
  '!src/pi-adapter/**'` returns empty; its positive control matches the real
  imports inside `src/pi-adapter/`. Matches `hasPiPackageImport` semantics
  in `test/unit/pi-boundary.test.ts`.

## Findings / handoffs

1. **Claim-gate wording for future briefs:** single-line greps for
   `Interface.member` miss multi-line declarations; the P0 landing was
   nearly reported as "not landed" on that basis. Prefer member-signature
   greps or `-U` multiline forms in claim gates.
2. **Stale mechanical gate, overlay still affected:** the raw-substring
   ADR-001 grep false-positives on `src/pi-compat/check.ts` data mentions.
   Fixed in `docs/kernel-reuse.md`; the overlay
   (`.agents/skills/pi-sparkle/references/kernel-reuse.md`) was updated
   mid-round by its owner for the steer landing but still carries the raw
   form in two places (checklist item 1 and "Verification before
   reporting"). Its owner should adopt the import-specifier form.
3. **Stale skip to remove (test/, outside my scope):** the placeholder
   `test.skip` in `test/unit/pi-adapter/steer-inflight.test.ts:88` predates
   the landing and now only adds a confusing SKIP to green runs.
4. **Remaining spec drift, out of directed scope:** the spec's
   `AgentExecutionRequest` (profile/model fields) differs from the code's
   (`agentInstanceId`, `modelId?`, `providerId?`, `cluster?`, and now
   `maxCostUsd?`). I only had a directive for the `ExecutionEvent` union;
   the request shape needs the same treatment by a spec owner.
5. **Still open after P0:** no CLI verb for live steer (product surface is
   the `RunningRun` handle); `followUpText`/`reset`/`sessionId` remain
   facade-only.

## Policy conformance

No `src/` or `test/` edits (docs + this report only). Nothing committed
(parent commits). Every landed/not-landed claim was re-verified after the
mid-round tree mutation; the P0 "landed" claim rests on direct reads, the
multiline grep, and 8 passing steer tests run on this tree today.

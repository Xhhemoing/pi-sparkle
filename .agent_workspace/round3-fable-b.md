MODEL_SLUG: claude-fable-5-thinking-xhigh

# Round 3 report — R3-fable-B (kernel-reuse overlay: ADR-001 gate + claim refresh)

Date: 2026-08-24. Branch `cursor/pi-kernel-reuse-e1e3`. No `src/` writes, no
commit (parent commits). One file edited plus this report.

## Files changed

- `.agents/skills/pi-sparkle/references/kernel-reuse.md` — four edits, no
  new reference files, SKILL.md untouched:
  1. **Item 1 gate is now import-specifier, not raw substring.** The
     merge gate reads
     `rg -n "(from|import\(|require\()\s*[\"']@earendil-works" src/
     --glob '!src/pi-adapter/**'` — the exact pattern
     `docs/kernel-reuse.md` already uses, taken verbatim so the two
     gates cannot drift. Rationale is stated inline: ADR-001 confines
     *imports*, and `src/pi-compat/check.ts` legitimately names both
     packages in plain string literals to read the pins; the old
     substring grep flagged those six lines as breaches, and a gate that
     cries wolf gets ignored.
  2. **Item 2 gains a second dated per-layer snapshot: the cost
     ceiling.** `startRun` forwards `RunLimits.maxCostUsd` on the
     execution request; `startParentRun` hands it to the child builder,
     which applies the tighter of the per-task and run-level caps;
     the contract carries `AgentExecutionRequest.maxCostUsd`; the
     adapter's `CostGate` arms only when cap *and* catalog prices both
     exist and installs Pi's `shouldStopAfterTurn` only when armed —
     unpriced models leave the run visibly uncapped via `onCostGate`,
     never priced with invented USD.
  3. **Item 6 documents the cost-stop vs steer ordering collision** (the
     brief's "known collision"): Pi consults `shouldStopAfterTurn`
     *before* draining the steering queue, so text steered during the
     ceiling-crossing turn is dropped with the attempt; reordering would
     need a Pi fork; the loss is auditable through the already-persisted
     `STEER_INJECTED` event plus the "stopped at the cost ceiling"
     `TASK_RESULT`. Wording mirrors the adapter's own comment at
     `src/pi-adapter/pi-executor.ts` so the overlay never outruns the
     source of truth.
  4. **Verification footer** uses the same import-specifier gate and the
     claim-gate grep now includes `maxCostUsd`.
- `.agent_workspace/round3-fable-b.md` — this report (replaces the
  aux-features-loop report previously at this path, per ownership
  convention; that content is preserved in git history).

## Evidence — final re-grep immediately before this report

- **Gate correctness, both directions.** Ungated, the import-specifier
  pattern hits all 11 real imports (static `from "..."`, the dynamic
  `await import("@earendil-works/pi-ai/providers/all")` in
  `src/pi-adapter/runtime.ts`), every one inside `src/pi-adapter/`.
  Gated with `--glob '!src/pi-adapter/**'` it returns nothing (exit 1).
  The old substring form returned six false positives, all
  `src/pi-compat/check.ts` pin-reading strings.
- **Cost cap — wired end to end, which is *newer than the brief*.** The
  brief said "Coordinator does not yet pass maxCostUsd"; that is now
  stale. Current grep: `src/run/coordinator.ts:250` (`startRun` request
  spread), `:455` (`startParentRun` → `ChildCoordinator` dep);
  `src/run/child-coordinator.ts:334-339` (`costCapFor` = min of per-task
  and run-level caps), `:357` (child `Run.limits`), `:542` (child
  execution request). This landed *between two of my greps minutes
  apart* — the first `maxCostUsd` grep of this session showed no
  `src/run/` hits; a `Read` moments later showed line 250 populated.
  Another Round 3 agent was wiring target 1 concurrently. The overlay
  records the incident as the sharpest instance yet of its own
  re-grep-before-claiming rule.
- **Steer — all three layers still wired.** Facade
  `src/pi-adapter/kernel.ts:183`, contract `src/execution/contract.ts:53`,
  `PiAgentExecutor.steerText` (`src/pi-adapter/pi-executor.ts:427` — the
  line number moved from 420 to 427 during this session; the overlay
  cites paths, not line numbers, so it is robust to this drift),
  product `RunningRun.steer` via `SteerChannel` in
  `src/run/coordinator.ts`, both `startRun` and `startParentRun`.
- **Ordering caveat source.** `src/pi-adapter/pi-executor.ts:294-299`
  comment: hook consulted before the steering drain, reorder needs a Pi
  fork, auditable via STEER_INJECTED + TASK_RESULT. Item 6's new text is
  a restatement of exactly that.
- **Pin unchanged.** `package.json:48-49` both `0.84.3`.
- `rg -n "test.skip" test/` → no matches; the steer-inflight skip the
  brief flagged is gone (fixed by its owner, not me — that file showed
  as modified by a concurrent agent).

## Invariants kept

- 1–2 reference cap: one existing reference edited; no new reference
  files, no new cross-reference obligations; SKILL.md routing row and
  Activation Rule untouched.
- ADR-001/ADR-006 framing intact — the gate got *stricter about what it
  claims* (imports) while still catching every real import form
  (`from`, `import(`, `require(`).
- Thinking text never in logs (item 4 untouched); steer text remains
  documented as loggable with its actor.
- No `src/`, `docs/`, `test/`, `package.json`, or `prompts/` writes; no
  commit.

## Leftovers for other owners

1. `docs/kernel-reuse.md` has no cost-cap capability row yet (its table
   covers streaming/abort/steer). The doc owner should add one; the
   overlay's item 2 snapshot has the per-layer evidence ready to lift.
2. If the workspace moves again before the parent commits (it moved
   twice during this session), re-run the overlay's three verification
   greps — every claim above is a 2026-08-24 snapshot.

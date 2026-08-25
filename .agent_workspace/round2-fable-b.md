MODEL_SLUG: claude-fable-5-thinking-xhigh

# Round 2 report — R2-fable-B (kernel-reuse reference overlay)

## Files changed

- `.agents/skills/pi-sparkle/references/kernel-reuse.md` — three edits, no
  new reference files, no SKILL.md changes:
  1. Item 2 ("verify wiring before claiming it") rewritten as a
     **per-layer** rule: Pi `Agent` ships it → `SparkleKernel` exposes it
     → executor contract carries it → product surface calls it. The
     worked example is live steering with all three Sparkle layers
     grep-plus-test verified as of today (facade `steerText`, executor
     `AgentExecutor.steerText?` / `PiAgentExecutor`, product
     `RunningRun.steer` via `SteerChannel`), plus the steer-vs-inject
     distinction and the note that steer *text* is logged with its actor
     — user-authored text is loggable, unlike thinking text. The closing
     paragraph keeps the day's claim history as the caution: the grep
     went zero matches → facade-only → all three layers within hours, so
     every status line is a dated snapshot and re-grepping before
     repeating a claim is mandatory.
  2. Item 4 ("never persist thinking text") upgraded from hypothetical to
     landed: `{ type: "THINKING_DELTA"; bytes: number }` is defined in
     `src/execution/contract.ts`, the raw delta stops inside
     `translatePiEvent`, coordinators persist only `thinking delta
     (N bytes)` summaries. Rule added: reuse the landed channel, never
     build a parallel one carrying text.
  3. Verification footer: report `wired | not wired | unknown` per
     capability *and per layer* (facade vs product).
- `.agent_workspace/round2-fable-b.md` — this report (replaces the prior
  cycle's overlay-polish report, per ownership convention).

No writes to `src/`, `docs/`, `test/`, `package.json`, or `prompts/`. Not
committed (parent commits).

## Evidence — grep-verified three times because the workspace moved twice

The mid-round drift is itself the round's best evidence for item 2. In
sequence, all on 2026-08-24:

1. **First pass.** `steerText` existed only on the facade
   (`src/pi-adapter/kernel.ts`, exercised by
   `test/unit/pi-adapter/kernel.test.ts`); `RunningRun` had only `runId`,
   `done`, `cancel()`; no product call site. I drafted the overlay as
   "facade wired / product not wired" per my brief.
2. **Second pass (pre-freeze re-grep).** The executor layer had landed:
   `AgentExecutor.steerText?(text)` in `src/execution/contract.ts:47`,
   implemented by `PiAgentExecutor` (`src/pi-adapter/pi-executor.ts:373`;
   empty-text guard, refuses when zero or multiple agents are in flight,
   forwards via a per-agent `liveKernels` map). Overlay reworked to three
   layers.
3. **Third pass.** The product layer had landed too:
   `RunningRun.steer(text, options?)` (`src/run/coordinator.ts:100`),
   implemented by `SteerChannel` — validates text and actor, throws
   `DomainValidationError` when blank / no execution in flight / executor
   lacks `steerText`, delivers to the executor *before* logging, then
   records the steer text with its actor; wired in both `startRun` and
   `startParentRun`. Tested by `test/integration/m0/steer.test.ts`
   (5 tests: delivery + actor recording, log ordering, blank refusal,
   unsupported-executor refusal, out-of-window refusal). Per the brief's
   "update grep-before-claim after opus-A lands," the overlay's final
   text states all three layers wired, with the day's flip-flop kept as
   the cautionary history.

Other claims verified:

- **THINKING_DELTA bytes-only — landed end to end.**
  `src/execution/contract.ts:24` (`{ type: "THINKING_DELTA"; bytes }`),
  `src/pi-adapter/pi-executor.ts:95` (only `Buffer.byteLength` of the
  delta crosses the boundary), `src/run/coordinator.ts` and
  `src/run/child-coordinator.ts` persist `thinking delta (N bytes)`,
  `src/run/events.ts` registers the event kind.
- **Invariant gates.** `rg "@earendil-works" src/ --glob
  '!src/pi-adapter/**'` → only `src/pi-compat/check.ts` string literals
  naming the packages for pin reading (no type or runtime imports). Pin
  unchanged: `package.json:48-49` both `0.84.3`.

## Invariants kept

- Activation cap untouched: the overlay edits exactly one existing
  reference; no new reference files, no cross-reference obligations
  added; SKILL.md routing row and Activation Rule (1–2 references)
  unmodified.
- ADR-001 / ADR-006 framing in the reference intro unchanged; no
  extension surface introduced or described.

## Verification

- `pnpm exec tsx --test test/unit/package/pi-manifest.test.ts` — 4/4 pass
  after the overlay edits.
- Final re-grep of `src/` and `test/` immediately before this report;
  claims above reflect pass 3.

## Leftovers for other owners

1. `test/unit/pi-adapter/steer-inflight.test.ts:88` still carries
   `test.skip("RunningRun.steer forwards in-flight text…")` with "not
   available yet" — now stale, superseded by
   `test/integration/m0/steer.test.ts`. Its owner should enable or delete
   it; I did not touch `test/`.
2. If a spec section lands for the `inject` (policy fact) vs `steer`
   (conversational turn) distinction, the reference's product bullet
   should link the term rather than keep its two-line explanation —
   keeps the file inside the activation-cap budget.

MODEL_SLUG: claude-fable-5-thinking-xhigh

# Round 1 report — R1-fable-B (skill overlay, kernel-reuse reference)

## Files changed

- `.agents/skills/pi-sparkle/references/kernel-reuse.md` (new) — extender
  checklist for secondary development on the slim kernel. Six items:
  (1) implement on the `SparkleKernel` facade, never on Pi's `Agent`, with
  a merge-gate grep for Pi imports outside `src/pi-adapter/**`;
  (2) verify wiring before claiming it — capability claims fail closed
  without a `src/` grep hit plus a test; (3) consume live events — first
  `TEXT_DELTA` must arrive before idle resolves, abort still maps to
  `agent.abort()`; (4) never persist thinking text — `THINKING_DELTA`
  carries bytes only, mirroring the response-hash telemetry rule;
  (5) pin stays 0.84.3, bumps go through `pi-version-adapt.md`, prose is
  never the source of truth for the pin; (6) retry uses a fresh Agent per
  attempt, so steering/follow-up queues do not survive retries and
  `sessionId` is advisory. Plus anti-patterns and a pre-report
  verification block (`wired | not wired | unknown`, never a guess).
- `.agents/skills/pi-sparkle/SKILL.md` — exactly one new row in Routing to
  References for `references/kernel-reuse.md`. Activation Rule (1–2
  reference cap) untouched.
- `.agent_workspace/round1-fable-b.md` — this report (replaces the prior
  cycle's 0.84.3-adaptation report, per this round's ownership table).

## Evidence gathered before writing

- **`steer` wiring: two observations, both grep-verified.** At the start of
  my work, `rg -n "steer|followUp|SparkleKernel|thinking_delta|THINKING_DELTA" src/`
  returned zero matches and `src/pi-adapter/kernel.ts` did not exist — the
  reference's item-2 worked example records that moment. Re-grepped at end
  of round after parallel agents landed: `steerText` is now wired
  (`src/pi-adapter/kernel.ts:165` calls `agent.steer(userMessage(text))`)
  and exercised by `test/unit/pi-adapter/kernel.test.ts` ("builds user
  messages for steering and follow-ups", asserting the forwarded message's
  role/content/timestamp). `THINKING_DELTA` also landed in
  `src/run/events.ts` and `src/run/coordinator.ts`, persisting bytes only
  — consistent with checklist item 4. The reference's example remains
  accurate as a dated observation and demonstrates exactly why the rule
  exists: the same claim flipped from false to true within one round.
- **Kernel capability confirmed at the source.** 0.84.3's installed
  `agent.d.ts` shows `steer(message)`, `followUp(message)`,
  `steeringMode`/`followUpMode` queue modes; `thinking_delta` appears in
  `pi-ai` type declarations. Capability exists in the kernel; wiring does
  not exist in `src/` — the reference keeps those two claims separate.
- **Live-yield gap confirmed.** `PiAgentExecutor.runAttempt` pushes
  translated events into an array and `execute()` yields only after
  `runWithRetry` (post-`waitForIdle`) returns; `translatePiEvent` ignores
  `thinking_delta`. Checklist items 3–4 are written against this observed
  behavior, and item 6's retry caveat comes from `runWithRetry` creating
  a fresh `Agent` per attempt with only the last attempt's events
  surfaced.
- **Pin confirmed 0.84.3** for both `@earendil-works/pi-agent-core` and
  `@earendil-works/pi-ai` in `package.json` (lines 48–49).

## Verification

- `npx tsx --test test/unit/package/pi-manifest.test.ts` — 4/4 pass. The
  reference-scan test picks up `references/kernel-reuse.md` from the new
  SKILL.md row and confirms the file exists; refs ≥ 6 holds; frontmatter
  and no-extension checks unchanged.
- Did not touch `src/`, `docs/`, `test/`, `package.json`, or `prompts/`.
  No new top-level skill; no nested sub-skill. Did not commit (parent
  commits after the round).

## Notes for later rounds

1. `kernel.ts` landed within this round (see evidence above). Item 2's
   worked example stays valid as history; a Round-2 pass may add a
   one-line "verified wired 2026-08-24 (kernel.ts:165 + kernel.test.ts)"
   annotation to the reference if the orchestrator wants live status in
   the doc rather than in reports.
2. `THINKING_DELTA` landed persisting a byte count only
   (`coordinator.ts:163`), matching item 4's `{ type, bytes }` example —
   no reference update needed. If the shape is later hashed instead,
   update the example; the no-raw-text rule itself does not change.
3. If the facade grows methods beyond the PROGRESS.md list (`prompt`,
   `abort`, `steerText`, `followUpText`, `reset`, `waitForIdle`,
   `sessionId`), item 1's surface enumeration should be refreshed from
   the exported type, not from PROGRESS prose.

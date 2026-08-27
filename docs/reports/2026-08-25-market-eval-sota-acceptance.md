# SOTA acceptance report — market-eval loop, Round 3 (final) — 2026-08-25

Branch `cursor/agent-market-eval-opt-cae9`, committed baseline `5c1421c`
("feat: close Round 2 H0 honesty and live-follow gaps"). This is the closing
acceptance for the three-round market-eval loop (Round 1 landscape:
[agent-ecosystem-eval.md](../research/agent-ecosystem-eval.md); Round 2
briefing: `.agent_workspace/ROUND2-BRIEF.md`), judged against the six
properties of the [2026-08-24 SOTA acceptance
report](2026-08-24-sota-r3-acceptance.md) plus this loop's own H0 landings.
Every claim cites file:line verified against this tree on 2026-08-25
(~08:40–09:00 UTC). Nothing here claims Outcome-supported, closes Checkpoint
F-PROD or the P0 privacy sign-off, or recommends enabling live R1 / bandit /
topology; ADR-006 stays **Proposed**.

**Tree-state disclosure.** At verification time the working tree was *not*
clean: Round 3 sibling slots were landing in parallel. Uncommitted at the
time of writing: an opt-in `--idle-timeout-ms` for `inspect --follow`
(`src/run/inspection.ts`, `src/cli/main.ts`, `README.md`,
`test/integration/cli/inspect-follow.test.ts`,
`test/unit/run/inspection.test.ts` — R3-opus-B), the skill-overlay cost-stop
alignment (`.agents/skills/pi-sparkle/SKILL.md`,
`references/kernel-reuse.md` — R3-opus-A), the R3-final marking of the
ecosystem evaluation (`docs/research/agent-ecosystem-eval.md`), and a new
AST-based MCP-absence tripwire (`test/unit/package/mcp-absence.test.ts` —
R3-gpt-B). Line numbers below for those files are working-tree line numbers
and are flagged where it matters; every other cited file is byte-identical to
`5c1421c`. §5 registers the in-flight work; the acceptance verdict rests on
the committed baseline.

## Acceptance standard

Unchanged from 2026-08-24: "SOTA" for a **developer-preview** local runtime
is not benchmark supremacy — that claim is structurally forbidden until
F-PROD/G. It is six properties, each *enforced or measured*, not asserted:

1. **Fail-closed persistence.**
2. **Provable plane isolation.**
3. **Privacy behavior that matches its own documentation exactly**,
   including documented gaps.
4. **Honest telemetry** — unknown is `undefined`, never zero.
5. **Proposal-first adaptation** with no self-promotion path.
6. **Docs that match the dispatcher**, with preview framing intact.

This loop adds its own H0 acceptance surface (§2): the eight Round-2 items
the ROUND2-BRIEF reported as landed had to be re-verified against the
*committed* tree, per the ecosystem evaluation's own §0 instruction.

## Verdict

**Accepted as the preview H0 closeout of the 2026-08-25 market-eval loop.**
All six properties hold on the committed tree at `5c1421c`, with property 6 —
the one Round 1 found drifted — now mechanically pinned rather than manually
restored (§1.6). All eight H0 items are committed and verified at file:line
(§2). No blocking gaps.

Evidence basis for this verdict: Round-2 parent gate green over `5c1421c`
(2082 tests, 2081 pass, 0 fail, 1 deliberate `PI_SMOKE` skip, Node
v22.14.0). Round 3 targeted re-runs by this reviewer, all green on this
tree: `readme-command-parity`, `market-eval-probe`, `inspect-follow`,
`answer-correlation` (26/26); `live-isolation`, `pi-boundary`, `cost-stop`,
`mcp-absence`, `inspection` (47/47); `pnpm market:eval` (isolation tripwires
3/3, `pi.extensions=false`), `pnpm security:probe` (14/14 passed, no open or
waived findings), `pnpm pi:probe` (pin 0.84.3 PASS). R3-opus-B additionally
reports the full gate green over the combined working tree (2095 tests, 2094
pass, 0 fail, 1 skip — sibling-reported in `.agent_workspace/r3-opus-b.md`,
not independently re-run here). The full gate over the final combined tree
remains the parent's step before commit, as in every prior round.

## 1. The six properties, re-verified on this tree

### 1.1 Fail-closed persistence — holds, and the new reader inherits it

A truncated final JSONL line is recovered as an incomplete tail; a corrupt
middle line throws instead of being skipped
(`src/persist/jsonl.ts:51–63`), and the event store surfaces that recovery
to every reader (`src/run/event-store.ts:126–132`).
`CheckpointStore.read()` returns `undefined` only for ENOENT and throws a
path-naming `DomainValidationError` for malformed JSON
(`src/run/checkpoint-store.ts:50, 58`). Atomic publish never adopts a
crashed writer's temp file (`src/persist/atomic-file.ts:50`); locks are
exclusive-create with timeout-only staleness (matrix, persist-file-lock
row). The one persistence-adjacent surface this loop added is a pure
*reader*: `followRunEvents` takes no lock, opens nothing for writing, and
reads through the same fail-closed `EventStore.readAll`, so a torn tail is
skipped and picked up next poll rather than printed
(`src/run/inspection.ts:288–316` doc contract, `:338` read, `:341–343`
log-vanished refusal — working-tree lines; the committed `5c1421c` version
differs only by the in-flight idle-deadline option). Weakening nothing was
the acceptance bar for property 1, and nothing was weakened.

### 1.2 Plane isolation — proof unchanged, tripwires re-run green

`test/unit/routing/live-isolation.test.ts` still builds the real transitive
import closure from the four live entry points (`:44–49`: `src/cli/main.ts`,
`src/run/flowchart-run.ts`, `src/run/supervisor.ts`, `src/track/loop.ts`)
and judges it against the pinned two-entry allowlist (`:87–112`), with
`selectArm` asserted to have zero callers inside the closure (`:262–269`),
the shadow router pinned as its only `src/` caller (`:292–308`), and
`planTaskTopology` pinned defined-but-unused (`:316–325`). Pi-SDK
confinement to `src/pi-adapter/` holds (`test/unit/pi-boundary.test.ts`,
re-run green). The only learned input to live routing remains the promoted
routing-policy pointer, hash-verified on load
(`src/learning/learned-routing.ts:129–131`). Round 2's additions did not
touch the routing graph: `--follow` is a reader, the answer correlation
reads the run's own event log, and the steer refusal is inside the adapter.

### 1.3 Privacy = docs — cascade and disclosures unchanged

`delete --run` filter-rewrites the shared invocation log and fails closed on
a corrupt middle line (`src/privacy/deletion.ts:237`, reader rule at
`:709`), invalidating the derived p50 snapshot with the rows (`:274`,
`:817–836`). `delete --episode` strips both free-text fields, tombstones
ids, and *reports* residual episode text instead of pretending append-only
logs were rewritten (`findResidualEpisodeText`, `deletion.ts:523`;
`residualEpisodeTextRunIds` at `:388–394`), with the CLI printing the
per-run `delete --run` recipe (`src/cli/main.ts:2260`, working-tree line).
Redaction is unconditional at the plane write (`src/feedback/store.ts:135`)
against the closed `REDACTION_CLASSES` vocabulary
(`src/feedback/types.ts:14–25`, record field at `:54`); an unknown class
fails the read closed (`store.ts:331–346`). The documented gaps stay
documented, not patched over: the delete-vs-live-appender residual and
timed-out-append row drop are in the matrix delete-cascade row verbatim.
Nothing this loop landed touches deletion or redaction code.

### 1.4 Honest telemetry — strengthened by the steer refusal

Failed calls persist usage as `undefined` via `usageIsTrustworthy`
(`src/pi-adapter/pi-executor.ts:937, 954–955`). Calibration moves a rate
only for `callOutcome === "ok"` rows and counts both exclusion kinds
(`src/routing/cost-calibration.ts:65`;
`src/telemetry/usage-aggregate.ts:20–32`). Provider retry stays bounded and
honest: 3 attempts, 8 s backoff cap, 30 s `Retry-After` cap, 401/403 never
retried (`src/pi-adapter/provider-retry.ts:24, 72–75`). The Round-2
addition closes a *fabrication* hole in this property: once the cost
ceiling's stop has latched, `steerText` throws a `DomainValidationError`
instead of queueing text into an agent loop that has already exited —
before delivery, so no `STEER_INJECTED` is recorded for words the model can
never read and the text never enters `acceptedSteers` for a retry to
resurrect (`pi-executor.ts:725–754` targeted path, `refuseIfCostStopped` at
`:769–779`, delivery-order guarantee at `:781–788`). Pinned by
`test/integration/pi-adapter/cost-stop.test.ts:164, 208` (refusal, both
kernel states) with the negative cases pinned too — an armed-but-unreached
ceiling and a disarmed ceiling never refuse (`:316, 334`).

### 1.5 Proposal-first adaptation — no new path, kill switch intact

The auto loop still returns `promoted: false` on every branch
(`src/learning/auto-loop.ts:206–207, 286–291`), and `SPARKLE_AUTO_ADAPT=0`
stops everything that learns while reporting `banditUpdated: false`
(`auto-loop.ts:157–163`). The only promotion path remains the CLI verb
requiring `--candidate`, `--expected` (CAS), `--content-file`,
`--review-file`, and `--approve`, refusing without persisted
independent-review provenance (`src/cli/adapt.ts:249, 261`; contract stated
in USAGE at `adapt.ts:37` and echoed at `:108`: "adapt auto never
CAS-promotes"). Nothing in Round 2 or Round 3 touches promotion.

### 1.6 Docs = dispatcher — restored **and made mechanical**

This is the property Round 1 found drifted (README omitted `unblock`, the
only exit from a BLOCKED run), and it is the loop's headline closure: the
truth-up landed *with an anti-drift test*, so recurrence is a red test, not
an audit finding. `test/unit/cli/readme-command-parity.test.ts` extracts
the verb list from the dispatch `switch` in `src/cli/main.ts` source — not
from an exported list nobody dispatches on (`:34–46`) — and asserts three
directions: every dispatched verb has a README command-table row (`:60–69`),
every dispatched verb appears in USAGE (`:71–75`), and the README invents no
verb the CLI does not dispatch (`:77–82`). The original regression is
pinned by name — `unblock` and its `--discard-executed` authorization must
both be documented (`:84–91`) — alongside the USAGE duplicated-sentence fix
(`:93–100`) and the `--children` example teaching `dependsOn`, the only
field the compiler builds edges from, with `inputArtifactIds` asserted
absent (`:102–114`). All six tests pass on this tree. Preview framing is
intact: `package.json` stays `private: true`, and `doctor --json` pins
`preview: true` / `liveAdaptive: false` (unchanged frozen contract).

**Requirement 4 of this acceptance is therefore confirmed: property 6 now
has a mechanical test.** The ecosystem evaluation's §8 flip from "drifted,
closing" to "restored, pinned by test" is warranted.

## 2. H0 landings verified on the committed tree

All eight ROUND2-BRIEF / ecosystem-eval §9 items are committed at `5c1421c`
(or earlier, where noted) and verified here:

| # | Item | Evidence on this tree |
|---|---|---|
| H0-1 | Ecosystem eval promoted to R2 synthesis | `docs/research/agent-ecosystem-eval.md` (R3-final marking in flight, §5) |
| H0-2 | Market-eval probe pinned as a check | `scripts/market-eval-probe.mjs`; `package.json:39` (`market:eval`); `test/unit/package/market-eval-probe.test.ts:54–79` asserts `pi.extensions === false` and ADR-006 `Proposed` |
| H0-3 | README ↔ dispatcher parity + anti-drift test; USAGE dedup; `dependsOn` example | §1.6 |
| H0-3b | Fail-closed non-flowchart `answer` correlation | `pendingAnswerMessageIds` derives the owed set from `RUN_WAITING_FOR_USER` minus `USER_ANSWER`, no second source of truth (`src/cli/main.ts:1899–1910`); an uncorrelated id is refused at stage `correlate` with the pending id named, recording nothing (`:2009–2033`); `inspect` prints `waiting for answer: <msgId>` (`:1420`). Pinned by `test/integration/cli/answer-correlation.test.ts:72–227` — fabricated id, wrong-but-well-formed id, double answer, and never-asked run all refused |
| H0-4 | `inspect --follow`, read-only live view | Stop contract `FOLLOW_STOP_STATUSES` = terminal (`COMPLETED`/`FAILED`/`CANCELLED`) plus operator-owned (`BLOCKED`/`WAITING_FOR_USER`/`PAUSED`) (`src/run/inspection.ts:224–235`); lock-free 250 ms poll through the fail-closed reader (`:288–363`); `--json --follow` keeps stdout a pure NDJSON event stream, closing status on stderr; exit 0 means "the log stopped", never "the run succeeded" (`src/cli/main.ts:1164–1172`); incompatible with `--summary-json`, unavailable for `--episode` (USAGE `:378–379`). Pinned by `test/integration/cli/inspect-follow.test.ts:72–135` (terminal exit, no lock/no append, pure stream, torn-line pickup) |
| H0-5 | Cost-stop steer refusal | §1.4 |
| H0-6 | MCP/interop position note | `docs/research/mcp-position.md` — a documented *no, in either direction, by architectural decision* under ADR-001; §5 preconditions before a client is even discussable; recommends building nothing in this loop |
| H0-7 | Node-floor evidence, engines deliberately unchanged | `docs/research/node-engine-floor.md`; `doctor`'s failure detail cites it (`src/cli/doctor.ts:679–689`); `package.json:29` still `">=22.19.0"` — lowering is a maintainer decision, not an agent's (committed `60ae1ea`) |
| H0-8 | Negative-case discipline | Ecosystem eval §4.6 / §7 grew during R2 and are not edited toward optimism; this report's §4 continues the practice |

The A3 cell of the ecosystem evaluation (supervised interruption,
downgraded to `Partial` in Round 2 on the transcript-proven fabricated-id
defect) is entitled to return to `Present`: the fail-closed correlation is
committed and its test suite passed on this tree. The in-flight R3-final
edit to that document records exactly this flip.

## 3. Standing invariants confirmed (requirement 3)

Checked directly on this tree, 2026-08-25:

- **ADR-006 is Proposed.**
  `docs/decisions/0006-pi-extension-reverse-adapter.md:5` reads `Proposed`;
  the market-eval probe test asserts the status parse contains `Proposed`
  (`test/unit/package/market-eval-probe.test.ts:73–78`).
- **No `pi.extensions`.** `package.json#pi` (`package.json:20–26`) declares
  exactly `skills` and `prompts`; the probe test pins
  `piManifest.extensions === false` (`market-eval-probe.test.ts:65`);
  `@earendil-works/pi-coding-agent` is not a dependency.
- **MCP is absent from `src/`.** `rg -i mcp src/` returns nothing (run
  twice during this review, before and after sibling landings). The only
  `test/` mention is the new in-flight tripwire that *enforces* the absence
  by parsing every `src/**/*.ts` for MCP-shaped module specifiers and
  identifiers (`test/unit/package/mcp-absence.test.ts:97–109` — prose
  mentions in comments/strings deliberately do not count). The only prose
  mentions repo-wide remain in `docs/research/`, which is
  [mcp-position.md](../research/mcp-position.md)'s stated design: the empty
  grep is a position, not silence.

## 4. Leftovers — explicitly NOT closed by this loop (requirement 5)

None of these is closed, and this acceptance does not narrow any of them.

1. **Follow idle hang (default path).** At `5c1421c`, `--follow` on a
   SIGKILL-orphaned `RUNNING` log polls until Ctrl-C — deliberately, because
   "no event for N seconds" is a real state for a slow provider call. An
   *opt-in* `--idle-timeout-ms` (exit 1, idle-not-total deadline) was landing
   uncommitted in the Round-3 working tree at the time of writing
   (`src/run/inspection.ts:245–262, 355–360`, working-tree lines;
   R3-opus-B). It does not change the default, and the default behavior
   remains a documented operator hazard (`doctor` inventories the crash
   candidates), not a closed item.
2. **Engines floor.** `package.json:29` keeps `">=22.19.0"` while 22.14.0
   hosts run the full suite green (recorded in
   `docs/research/node-engine-floor.md`); `doctor` fails closed and points
   at the evidence (`src/cli/doctor.ts:688`). The lower-or-keep decision is
   the maintainer's and remains open.
3. **Retention.** `runtime/invocations.jsonl` and `runtime/episodes/` grow
   unboundedly; the probe measures and reports `unbounded: true` without
   failing (matrix retention-bounds row; `scripts/retention-probe.mjs`).
   Bounding is an open policy decision (H1-b in the ecosystem eval).
4. **Checkpoint F-PROD** (and therefore Checkpoint G / any
   Outcome-supported marking) — open by ADR-005 policy; closing it in docs
   would be a violation, not progress.
5. **P0 privacy sign-off** — a human reviewer act; the 2026-08-24 cascade
   extensions widen the evidence but cannot self-certify.
6. **Feedback-id content hash.** Ids remain a content-only preimage —
   `` fbk_${hash32(`${summary}:${score}:${modelId}`)} `` at
   `src/learning/auto-loop.ts:316` — so identical child summaries collide
   across episodes and one episode delete can over-suppress other episodes'
   learning signals (privacy-safe direction: over-deletion, no leak).
   Widening the preimage with episode/run/task identity is an open H1
   prerequisite.

Also open, carried without change: the cost-gate CLI arming flag and
`onCostGate` disarm wire (the refusal landed; the arming ergonomics did
not — ecosystem eval §4.6 item 5); real-provider CI-shaped coverage (still
opt-in `PI_SMOKE` plus the offline loopback harness); the plain-`--children`
contract-less start (documented decision, pinned by
`cli-contract-honesty.test.ts`); and the README `## Documentation` section
still not linking the three research notes (mcp-position, node-engine-floor,
agent-ecosystem-eval) — a hygiene gap, not dispatcher drift, since parity
governs the command surface.

## 5. Round-3 in-flight work registered, not accepted here

Uncommitted at the time of writing, all consistent with loop scope (no MCP
client, no ADR-006 movement, no live-plane change), all exercised green in
this reviewer's targeted runs where testable: the opt-in follow idle
deadline with 13 new tests (R3-opus-B, who reports the full gate green over
the combined tree); the skill-overlay truth-up aligning
`references/kernel-reuse.md` with the landed steer refusal (R3-opus-A,
closing the ROUND2-BRIEF §2 drift flag); the ecosystem evaluation's R3-final
marking including the A3 `Partial → Present` flip and the C3 comparative-row
retirement per its own §10 ruling 1; the MCP-absence AST tripwire
(R3-gpt-B); and the Round-3 probe re-run record (R3-gpt-A,
`.agent_workspace/r3-gpt-a.md`). These strengthen, and cannot weaken, every
verdict above; the parent gate over the combined tree is the remaining step
before they are part of a committed baseline.

## 6. What would revoke this acceptance

Unchanged from 2026-08-24, plus one addition from this loop:

- Any change making an R1/shadow/holdout module reachable from a live entry
  point, or allowlist growth without re-justification.
- Any promotion path not requiring the five-flag human approval artifact.
- A privacy claim in README/matrix/dictionary that stops matching
  `src/privacy/deletion.ts` / `src/feedback/store.ts` behavior — in either
  direction.
- Any Outcome-supported marking, F-PROD closure, or P0 sign-off recorded
  without the human acts those gates name.
- **New:** a dispatcher verb added without its README row and USAGE line —
  now enforced, so green parity tests after such a change mean the tests
  were edited, which is the louder alarm. Likewise an MCP import in `src/`
  once the absence tripwire lands: deleting or loosening that test to admit
  one would itself be the revocation event, per mcp-position.md §5's
  tripwire-before-dependency rule.

## Standing constraints

Re-affirmed unchanged: nothing in this repository is Outcome-supported;
Checkpoint F-PROD and the P0 privacy sign-off stay open; ADR-006 stays
Proposed with no `extensions/` directory and no `pi.extensions` manifest
entry; live R1, bandit, and topology stay off the execution path; MCP stays
out of `src/` as a documented position; the package stays `private: true`
developer preview.

# SOTA acceptance report — persistent-optimization loop, Round 3 (final) — 2026-08-24

Branch `agent/sota-persistent-opt-7e63`, on top of commit `e25c9d7` plus the
Round 3 working tree. This is the closing architecture acceptance for the
three-round loop ([Round 1 audit](2026-08-24-sota-architecture-audit.md),
[Round 2 re-audit](2026-08-24-sota-r2-architecture.md)). Every claim cites
file:line in the tree it was verified against. Nothing here claims
Outcome-supported, closes Checkpoint F-PROD or the P0 privacy sign-off, or
recommends enabling live R1/bandit/topology (ADR-005; ADR-006 stays Proposed).

## Acceptance standard

"SOTA" for a **developer-preview** local runtime is not benchmark supremacy —
that claim is structurally forbidden here until F-PROD/G. It is the following
six properties, each of which must be *enforced or measured*, not asserted:

1. **Fail-closed persistence.** Crash windows and corrupt state degrade to
   refusal, never to invented state.
2. **Provable plane isolation.** Learned/exploratory routing cannot reach live
   execution, and the proof survives refactoring.
3. **Privacy behavior that matches its own documentation exactly**, including
   documented *gaps* — an undisclosed hole fails acceptance the same way a
   false capability claim does.
4. **Honest telemetry.** Unknown is `undefined`, never zero; failed spend is
   never billed into rates.
5. **Proposal-first adaptation** with no code path that promotes without a
   human-supplied approval artifact.
6. **Docs that match the dispatcher**, with preview framing intact.

## Verdict

**Accepted as a SOTA developer-preview runtime** under the standing policy
gates in §2. Round 2 parent gate: `pnpm typecheck` / `lint` / `test` / `build`
green, **1314 pass / 0 fail / 1 skip**, security probe 14/14. During Round 3,
all three P0 leftovers from the Round 2 audit landed in the working tree —
persisted `redactionClasses`, the collect-only kill switch, and residual
episode-text reporting (§3.0) — alongside `cluster-tools` / `auth-session`
units, the promote-USAGE assertion, and the retention probe. These are
verified at file:line below but still need the parent gate re-run over the
combined tree. Per-capability evidence follows.

## 1. Accepted capabilities (evidence)

### 1.1 Isolation is proven over the module graph, not asserted

`test/unit/routing/live-isolation.test.ts` builds the real transitive import
closure from the four live entry points (`live-isolation.test.ts:40–45`) and
judges reachability against a pinned two-entry allowlist (`:83–95`). The two
exceptions are structurally constrained, not waved through:
`src/routing/bandit.ts` may be reached only via `learning/bandit-store.ts` and
only as a reward *writer* — `selectArm` and `loadProjectBandit` are asserted to
have zero callers in the closure (`:245–255`) — and `src/routing/topology.ts`
only as the parked `planTaskTopology`, pinned to exactly one occurrence in
`src/run/supervisor.ts` (`:258–272`). R1, shadow, and holdout modules must be
unreachable (`:203–208`), and a vacuous-guard test pins that the closure still
contains every module the old per-file check guarded (`:194–201`).
Complementary boundaries: plane storage prefixes
(`test/unit/privacy/plane-boundary.test.ts`) and Pi-SDK confinement to
`src/pi-adapter/` (`test/unit/pi-boundary.test.ts`). The only learned input to
live routing is the promoted routing-policy pointer, verified by content hash
on load (`src/learning/learned-routing.ts:129–131`).

### 1.2 Privacy deletion is a cascade with disclosed edges

`delete --run` removes the runtime subtree and filter-rewrites the shared
`runtime/invocations.jsonl`, failing closed on a corrupt middle line rather
than reporting a partial delete as success
(`src/privacy/deletion.ts:119, 480–505`), then invalidates the derived
`catalog-observed.json` aggregate instead of pretending a percentile can have
one run subtracted (`deletion.ts:522`). `delete --episode` removes the
episode log, event log, **and** the operational lock (`deletion.ts:166–175`),
and strips both free-text fields — `body` and `summary` — from bound feedback
(`deletion.ts:52, 422–451`)
while tombstoning ids. Round 3 closed the last undisclosed edge: an episode
delete now scans attached runs for surviving copies of the episode's text —
`EPISODE_OPENED` snapshots, objective copies, and unreadable logs are reported
rather than assumed clean (`findResidualEpisodeText`, `deletion.ts:243`;
reasons at `:67`) — and the CLI prints a per-run `delete --run` recipe
(`src/cli/main.ts:1392`). Append-only run logs are deliberately not rewritten;
the operator decides. Preference cascade on episode delete is a documented
deliberate non-goal with its reasons in the source (`deletion.ts:189`). The
remaining edge (delete-vs-appender race) is documented where an auditor will
look, which is the acceptance criterion: no undisclosed holes.

### 1.3 Redaction removes values, unconditionally, at the plane write

Every adaptation-plane feedback write passes through `redactFeedback` with
`redactPII: true` and a 400-char cap (`src/feedback/store.ts`, exported as
`FEEDBACK_REDACTION_POLICY` so the decision is reproducible); rules remove PEM
blocks, bearer/vendor tokens, JWTs, keyed assignments, and
email/IPv4/phone/Luhn-card/path values with stable placeholders
(`src/feedback/redaction.ts`), ReDoS-hardened. Round 3 made the decision
auditable at rest: the record persists `redactionClasses` against a closed
vocabulary (`src/feedback/types.ts:54`; `REDACTION_CLASSES` at `:14–20`), an
unknown class fails the read closed (`store.ts:125–129`), and the three states
are deliberately distinct — `undefined` legacy rows are unknown, not clean; a
list without `secret` means the pass ran and found none; `secret`/`path`/
`oversized` means a value was found and removed.

### 1.4 Telemetry never fabricates

Failed calls persist usage as `undefined` via the `usageIsTrustworthy` gate
(`src/pi-adapter/pi-executor.ts:364, 381–382`). Calibration moves a rate only
for `callOutcome === "ok"` rows and *counts* both exclusion kinds so a stalled
calibration is diagnosable (`src/routing/cost-calibration.ts:63–70`;
conservative legacy rule at `src/telemetry/usage-aggregate.ts:13–17, 20–27`).
Provider retry is bounded and honest: 3 attempts, 8s backoff cap, 30s
`Retry-After` cap, 401/403 never retried
(`src/pi-adapter/provider-retry.ts:22–25, 71–77`).

### 1.5 Adaptation cannot promote itself

`runAutoAdaptLoop` documents and implements "never CAS-promotes"
(`src/learning/auto-loop.ts:73`); its proposal path returns
`promoted: false` on every branch (`auto-loop.ts:221, 226`). The kill switch
now separates observation from learning: `SPARKLE_AUTO_ADAPT=0` still
collects and diagnoses, but skips both the bandit update and the proposal
(`auto-loop.ts:101–114`), and the result reports `banditUpdated` explicitly
(`auto-loop.ts:64`). The only promotion path is the CLI, which refuses
without `--candidate`, `--expected` (CAS), `--content-file`, `--review-file`,
and `--approve` (`src/cli/adapt.ts:240–263`); the USAGE string states the
full contract (`src/cli/main.ts:231`) and an integration test pins it
(`test/integration/cli/commands.test.ts`, Round 3 working tree).

### 1.6 Fail-closed persistence

Truncated final JSONL lines are recovered; corrupt middle lines fail closed
(matrix event-log row; exercised across `inspect`, migrate, and the deletion
rewrite). Checkpoint atomic-rename semantics survived dedicated crash-window
tests with zero source changes (`test/unit/run/checkpoint-store.test.ts`) —
the Round 2 finding was that the design was already right. File locks are
exclusive-create with the fd leak fixed; stale locks are timeout-only by
documented design (`test/unit/persist/file-lock.test.ts`).

### 1.7 Operational honesty

The README command table matches the sixteen-command dispatcher, including the
full `adapt promote` form and the extended delete-cascade description
(README §Commands, this round). `doctor --json` is a frozen additive-only
contract pinning `preview: true` and `liveAdaptive: false`
(`src/cli/doctor.ts:21–34`). `pnpm test -- <dir>` works because the runner
expands directories (`scripts/run-tests.mjs:20–37`); `pnpm prerelease` chains
the gate and the security probe (`package.json:40–42`). Unbounded retention is
now *measured* rather than merely admitted (`scripts/retention-probe.mjs`,
Round 3 working tree; `unbounded: true` is reported, not failed).

## 2. Policy-gated, not code-gapped

These stay open by decision, and closing them in code or docs would be a
violation, not progress:

| Gate | Why it stays open |
|---|---|
| Checkpoint F-PROD | Sealed holdout with paired utility CI has not run (ADR-005). No adaptive-gain claim is permitted before it. |
| Outcome-supported (Checkpoint G) | Forbidden until F-PROD; the status matrix correctly shows **no** row Outcome-supported. |
| P0 privacy sign-off | Reviewer re-verification of Q1/Q2 remediation is a human act; the 2026-08-24 cascade extensions widen the evidence but cannot self-certify. |
| ADR-006 | Stays Proposed; no `extensions/pi-sparkle/` import. |
| Live R1 / bandit / topology | Off the execution path until F-PROD; enforced by §1.1, not by promise. |

## 3. Round 3 closures and ranked leftovers

### 3.0 Closed during Round 3 (verified in the working tree; parent gate must re-run over the combined tree)

1. **Redaction decisions persisted at rest.** `redactionClasses` is now on the
   record (`src/feedback/types.ts:54`) with a closed vocabulary
   (`types.ts:14–20`); the store validates it on read and an unknown class
   fails the read closed (`src/feedback/store.ts:125–129`). Legacy rows read
   as `undefined` = unknown — never rewritten, never assumed clean. This
   closes Round 2 P0-3.
2. **Kill switch is collect-only.** `SPARKLE_AUTO_ADAPT=0` now stops
   everything that learns — the `updateProjectBandit` write moved behind the
   `isAutoAdaptEnabled` check (`src/learning/auto-loop.ts:101–114`) and the
   result reports `banditUpdated: false` (`auto-loop.ts:64, 107`). Closes
   Round 2 P0 "kill-switch still writes `bandit.json`".
3. **Residual episode text is detected and reported.** `delete --episode`
   scans attached runs for `EPISODE_OPENED` snapshots, objective copies, and
   unreadable logs (`src/privacy/deletion.ts:243`, reasons at `:67`), returns
   `residualEpisodeTextRunIds` (`deletion.ts:94`), and the CLI prints the
   `delete --run <id>` recipe per residual run (`src/cli/main.ts:1392`).
   Append-only run logs are deliberately not rewritten. Closes Round 2 P0
   "episode text copies survive" via the documented-recipe option.
4. **Preference cascade declared a deliberate non-goal**, with the three
   engineering reasons in the source (`deletion.ts:189`). Closes the
   implement-or-declare decision.
5. **Adapter units and probes.** Fake-backed `auth-session` and
   `cluster-tools` units (`test/unit/pi-adapter/auth-session.test.ts`,
   `cluster-tools.test.ts`), the promote-USAGE integration assertion
   (`test/integration/cli/commands.test.ts`), and the retention sizing probe
   (`scripts/retention-probe.mjs`).

### P1 — architecture asymmetries (open)

1. **Plain CLI `--children` starts contract-less.** The compile path
   (`src/cli/main.ts:735, 751`) passes no `contract`, so the coverage gate
   never fires there and the run records `skipContract: true`
   (`src/run/flowchart-run.ts:781`), while `--track` always builds one
   (`src/track/loop.ts:245`). Documented (matrix coverage-gate row); the open
   decision is derive-a-contract-from-`acceptanceCriteria` vs. keep-and-keep-
   documenting.
2. **Real-provider coverage stays smoke-only** (`PI_SMOKE=1`). Retry (§1.4)
   removed the known 429 failure mode, but there is no CI-shaped proof of the
   compiled-children path against a live provider. Only opt-in coverage may
   close this — never an outcome claim.
3. **Delete-vs-live-appender race.** The invocation rewrite takes the log's
   cooperative lock but the live appender appends without it
   (`src/privacy/deletion.ts:476–478` contract note); deleting a
   still-executing run can race. Disclosed; the fix would be lock-coupling
   the appender.

### P2 — hardening and hygiene (open)

4. **Retention bounding decision.** The probe measures growth
   (`scripts/retention-probe.mjs`); the policy (age/size bounds,
   cascade-consistent) is still an open product decision.
5. **`inspect --json` lacks `requiredEvidence`** from `STALL_DETECTED`; the
   evidence a blocked run needs is only in the raw event log. Additive field;
   check the payload's freeze status first.
6. **Node engines floor** `>=22.19.0` (`package.json:28–30`) vs. known
   22.14.0 hosts; `doctor` fails closed (correct). Lower with a
   compatibility test, or keep documenting the requirement.
7. **Closure-walker limits.** The isolation walker is regex-based
   (`live-isolation.test.ts:110–111`): commented-out imports count (fails
   closed — acceptable), computed dynamic imports would not be seen (none
   exist in `src/` today; the watchlist test would still catch a rename).

## 4. What would revoke this acceptance

- Any change making an R1/shadow/holdout module reachable from a live entry
  point, or allowlist growth without re-justification — §1.1's tests turn red;
  green tests after such a change mean the tests were edited, which is the
  louder alarm.
- Any promotion path that does not require the five-flag human approval
  artifact, or an auto-loop branch returning `promoted: true`.
- A privacy claim in README/matrix/dictionary that stops matching
  `src/privacy/deletion.ts` / `src/feedback/store.ts` behavior — in either
  direction.
- Any Outcome-supported marking, F-PROD closure, or P0 sign-off recorded
  without the human acts those gates name.

## Standing constraints

Re-affirmed unchanged: nothing in this repo is Outcome-supported; Checkpoint
F-PROD and the P0 privacy sign-off stay open; ADR-006 stays Proposed; live R1,
bandit, and topology stay off the execution path; the package stays
`private: true` developer preview.

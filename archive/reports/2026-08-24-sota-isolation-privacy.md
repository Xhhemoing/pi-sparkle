# Isolation, privacy-claim, and ADR honesty audit — 2026-08-24

Scope: cross-cutting review of (1) live-vs-shadow routing isolation, (2)
privacy claims vs implementation, (3) ADR status lines vs repo reality, run
as Round 1 slot fable-2 of the SOTA polish loop. Evidence only; the only
edits made alongside this report are honesty patches to
`docs/data-dictionary.md`, `docs/decisions/0004`, and `docs/decisions/0005`.

Baseline: branch `agent/sota-persistent-opt-7e63` at commit `9a7cb17`, with
Round 1 sibling agents' uncommitted working-tree changes present (notably the
implemented PII redaction in `src/feedback/redaction.ts` and the pi-executor
usage-trust gate). Where the committed state and the working tree differ,
both are stated.

## 1. Isolation proof: live execution vs R1 / bandit / shadow / topology

Method: transitive static import closure computed over relative imports from
each live entry point (script reproduced in §1.4), cross-checked with
call-site greps. This is stronger than the shipped
`test/unit/routing/live-isolation.test.ts`, which only scans the literal
source text of a fixed ten-file list and cannot see transitive imports.

### 1.1 Closure results

| Entry point | closure | r1 | shadow | shadow-compare / sim-holdout / r1-shadow-report | bandit | topology | r0 |
|---|---|---|---|---|---|---|---|
| `src/cli/main.ts` (whole binary) | 158 files | absent | absent | absent | **present** | **present** | present |
| `src/run/flowchart-run.ts` (public orchestrator) | 93 | absent | absent | absent | absent | absent | present |
| `src/track/loop.ts` (`run --track`) | 122 | absent | absent | absent | **present** | absent | present |
| `src/run/supervisor.ts` (DAG supervisor) | 65 | absent | absent | absent | absent | **present** | — |

### 1.2 The two module-graph leaks, characterized

- **bandit** — chain: `cli/main.ts → learning/auto-loop.ts →
  learning/bandit-store.ts → routing/bandit.ts`. Only the learner half is
  used: `updateProjectBandit` calls `createBanditState`/`recordReward` to
  update `adaptation/learning/projects/<key>/bandit.json` after a run.
  The selector `selectArm` has exactly one non-test caller —
  `routing/shadow.ts` — which is unreachable from every live entry point.
  `loadProjectBandit` has **zero** callers in `src/`. Live selection stays
  `createModelRouter` (preferred-constraint → cheapest eligible,
  `src/routing/live-selection.ts`). Verdict: no adaptive *selection* on the
  live path; the ADR-005 ban on "bandit routers" holds at the call graph,
  but not at the strict module graph. Recorded as an ADR-005 enforcement
  note.
- **topology** — chain: `cli/main.ts → run/supervisor.ts →
  routing/topology.ts` (module-level import at `src/run/supervisor.ts:40`).
  The exported `planTaskTopology` is parked: the run loop never calls it,
  which `live-isolation.test.ts` pins ("must stay defined but unused").
  `decideTopology` is pure/deterministic and reads no learned state.
  ADR-005's import ban names "R1, bandit, or shadow routers" — not topology;
  `docs/status-matrix.md`'s row wording ("R1 / bandit / topology … must not
  import into live execution") is broader than both the ADR and the code.
  Handed to fable-1 (status-matrix owner) to align the wording.
- **r0** — chain: `… → routing/live-cascade.ts → routing/cascade-evidence.ts
  → routing/r0.ts` (value import of `applyCascade`). The live path calls only
  the pure evidence gate `resolveEvidenceCascade`; `routeR0`/`applyCascade`
  load but are not invoked live. The doc comment in `src/routing/r0.ts`
  ("Live flowchart execution does not import this module") is **false at the
  module-graph level** and should be reworded by the owning slot. R0 is the
  approved static policy, so this is a comment-honesty issue, not a safety
  issue.

### 1.3 What live behavior *is* allowed to adapt

Live routing consults the learned routing policy **only** through the
CAS-promoted registry pointer: `loadLearnedRouting` reads
`adaptation/registry.json`'s active `routing-policy` version, verifies the
content hash, and refuses leftover `routing.json` files
(`src/learning/learned-routing.ts`; `saveLearnedRouting` throws). Promotion
requires `adapt promote --approve`; `runAutoAdaptLoop` structurally cannot
promote (`proposeAndMaybePromote` always returns `promoted: false`), and the
default/installed approval profiles have `autoPromoteClasses: []`,
`maxAutoPromotions: 0`. This matches ADR-004's proposal-first decision.

One kill-switch nuance: `SPARKLE_AUTO_ADAPT=0` disables *proposing* but the
auto-loop still persists feedback signals **and still updates the project
bandit file** (`updateProjectBandit` runs before the `isAutoAdaptEnabled()`
check in `src/learning/auto-loop.ts`). The doc comment says "still collects";
whether bandit-state updates count as "collection" should be stated
explicitly — the file influences nothing live today (no reader), so this is
a documentation nuance, not a control-plane hole.

### 1.4 Reproduction

```bash
node /tmp/import-graph.mjs src/cli/main.ts src/routing/r1.ts \
  src/routing/bandit.ts src/routing/shadow.ts src/routing/topology.ts
# script: BFS over `from "..."` / `import("...")` relative specifiers,
# .js -> .ts resolution, rooted at /workspace. Results in §1.1.
```

## 2. Plane isolation: runtime vs adaptation roots

- The state root split (`runtime/` vs `adaptation/`,
  `src/privacy/state-layout.ts`) is consistent across every durable path
  constructor checked; `test/unit/privacy/record-classes.test.ts` pins
  path-completeness and owner/plane prefix agreement (16 tests green).
- The adaptation→runtime **data** boundary is enforced by
  `test/unit/privacy/plane-boundary.test.ts` with exactly five allowlisted
  exceptions, all justified: three type-only imports of the `Event` shape
  (`learning/auto-loop.ts`, `learning/signals.ts`,
  `learning/from-episode.ts`), plus `learning/from-episode.ts →
  run/event-store.js` (sanctioned PASS/FAIL derived-signal reader) and
  `→ run/episode-bind.js` (episode-id resolution for that reader).
- The boundary test's `RUNTIME_MODULES` prefix list covers
  `run/ episode/ telemetry/ config/ pi-adapter/ routing/cost-calibration`.
  Adaptation modules also import `supervisor/model-router.js` and
  `routing/assign.js` (pure code reuse for offline replay/eval — no runtime
  *data* access), which the test intentionally does not flag. That
  distinction (data boundary, not code boundary) is correct but worth a
  comment in the test next round.

## 3. Redaction: claim vs implementation

- **Committed state (`9a7cb17`)**: `redactPII: true` only adds the `pii`
  label; email/IP/phone/card/path values survive verbatim. `path` and
  `prompt-injection` classes were declared but never produced. This matches
  the known finding in
  `docs/reports/2026-08-22-weak-areas-data-collection.md` §4.1 and is what
  `scripts/security-probe.mjs` gates on (PII must be REMOVED, not labeled).
- **Working tree (Round 1, redaction owner)**: `redactSensitiveText` now
  removes values with stable placeholders — vendor key shapes, PEM blocks,
  Bearer/JWT, keyed `key[:=]value` forms, home/ssh/Windows-profile paths,
  email, IPv4, E.164 + CN-mobile phones, Luhn-gated card numbers — applied
  to **both `body` and `summary`**, ordered before the forbidden-substring
  strip. `prompt-injection` stays deliberately undetected with a written
  rationale in the module. Privacy suites pass 16/16 + integration 6/6
  against this.
- **Residual honesty nuance (persists after the fix)**: the write-path policy
  in `src/feedback/store.ts` hardcodes `redactPII: true`, and the `pii` class
  is added unconditionally as a "pass ran" marker — so every appended record
  persists `redacted: true` whether or not anything was found or removed.
  The on-disk record does not carry `decision.classes`, so "scanned clean"
  and "content removed" are indistinguishable after the fact. Documented in
  the data dictionary (this round); a schema-level fix (persist classes or
  rename the flag) is next-round work.

## 4. Delete cascade and tombstones: remaining holes

Verified working as claimed: run subtree removal; episode dual-shape removal;
episode→feedback cascade (body strip + tombstone persist, idempotent);
first-layer tombstone filter in `readFeedback`; fail-closed CLI (unknown id
exits 1); preference deletion physically removes the payload and tombstones
the id; `exportForDataset` strips `evidenceEpisodeId` and always lists
tombstone ids; authorized export omits tombstones unless
`includeTombstones`. Integration `test/integration/cli/delete.test.ts` and
`test/integration/m3/redaction.test.ts` green.

Holes found (now disclosed in `docs/data-dictionary.md`):

1. **P1 — cascade strips `body` but not `summary`.** The auto-loop writes
   derived user text into `summary` (`user: <answer>`, peer-message bodies,
   subagent assistant text, ≤400 chars — `src/learning/signals.ts`
   `persistSignals`). After `delete --episode`, that text remains on disk in
   `records.jsonl` (hidden from `readFeedback` by the tombstone filter, but
   present for `readFeedbackRecordsRaw` and raw file access).
   `record-classes.ts` also lists only `body` as sensitive for the feedback
   class. Fix owners: `src/privacy/deletion.ts` +
   `src/privacy/record-classes.ts` (not writable by this slot).
2. **P1 — episode objective text survives inside attached runs.**
   `bindEpisodeToRun` appends `EPISODE_OPENED` (full episode incl. objective)
   into `runtime/runs/<runId>/events.jsonl`; `delete --episode` never touches
   run logs. Removal currently requires deleting the attached runs too.
3. **P1 — `delete --run` cannot deliver `model-invocation`'s declared
   run-scoped `delete-files`.** `runtime/invocations.jsonl` is one global
   file (`src/cli/main.ts:627`); a deleted run's rows (ids, hashes, usage
   numbers — no text) survive, as do its `catalog-observed.json` aggregates.
   Either filter-rewrite the log on run delete or weaken the declared class.
4. **P2 — declared `run-event → episode` deletion propagation is not
   implemented** (deliberate — episodes outlive runs — but the declaration in
   `record-classes.ts` contradicts the code comment in `deletion.ts`).
5. **P2 — no preference cascade on episode delete**: observations keep
   `evidenceEpisodeId` links and payloads referencing a deleted episode.
6. **P3 — `runtime/episodes/<id>.lock`** survives episode delete (no user
   text).

## 5. ADR status lines vs repo reality

| ADR | Status line | Repo reality | Verdict |
|---|---|---|---|
| 001 pi-adapter boundary | Accepted | No `src/` file outside `pi-adapter/` imports Pi packages; no file anywhere imports `pi-coding-agent` | honest |
| 002 event log + checkpoints | Accepted | EventStore/CheckpointStore as described | honest |
| 003 structured protocol | Accepted | `protocol/v1.js` in use | honest |
| 004 controlled adaptation | Accepted (2026-08-21) | Proposal-first enforced (approval profiles, CAS pointer, no auto-promote); **but the Follow-up paragraph still said "This ADR remains Proposed until…"** | stale line fixed this round |
| 005 checkpoint F holdout | Accepted (2026-08-19) | Selection ban holds at call graph; bandit/topology module-graph nuances above | enforcement note appended this round; decision unchanged |
| 006 pi extension / diagnostic overlay | **Proposed** | No `pi.extensions` in `package.json` (pinned by `test/unit/package/pi-manifest.test.ts`), no `pi-coding-agent` import anywhere, `extensions/pi-sparkle/` does not exist; skill front-matter says "Diagnostic overlay only; does not register extensions" | honest — **left Proposed**, as required |

Additional honesty observations (not patched — outside this slot's writable
paths, handed off):

- `docs/status-matrix.md` "R1 / bandit / topology … Must not import into live
  execution until F-PROD" over-states relative to ADR-005 and to the module
  graph (§1.2) — fable-1 owns that file.
- `src/routing/r0.ts` header comment "Live flowchart execution does not
  import this module" is false at the module-graph level (§1.2).
- `docs/reports/2026-08-22-p0-privacy-review-package.md` §inputs says "17
  durable record classes"; the dictionary and code now carry 18. Historical
  document; left as is.
- `PI_EXTENSION_IMPORT_ALLOWED` (ADR-006 / adaptive-plan) exists only as
  prose — no code-level flag; the real guards are the manifest test and the
  absence of the import. Consider either implementing the guard or rewording.

## 6. Dataset export / preference tombstone honesty

- `exportForDataset` (preferences): filters tombstoned ids, exports only
  `{scope, scopeKey, key, value, weight, createdAt}` — `evidenceEpisodeId`
  and observation ids stripped; always lists tombstone ids, never payloads.
  Matches dictionary claims. Verified by `test/integration/m3/redaction.test.ts`.
- `exportAuthorizedPreferences`: full observations (including
  `evidenceEpisodeId`) — this is the *authorized* export and is documented as
  such; tombstones only on `includeTombstones: true`. Matches claims.
- Feedback has no dataset exporter of its own; it reaches adaptation only via
  the write-time redaction pipe (`appendFeedback`). Consistent with the
  dictionary's "runtime data reaches adaptation only as derived signals or
  through the redaction pipes".
- `deleteObservation` physically removes the payload from `preferences.json`
  and tombstones the id — stronger than the feedback cascade (which leaves
  the shell + summary). No over-claim found.

## 7. P0 sign-off status

Unchanged and NOT closed by this report: P0 remains open pending independent
reviewer re-verification of the Q1/Q2 remediation
(`docs/reports/2026-08-22-p0-privacy-review-package.md` §7). Nothing in this
audit claims Outcome-supported, closes F-PROD, or flips ADR-006.

## 8. Tests run

- `pnpm tsx --test test/unit/privacy/record-classes.test.ts
  test/unit/privacy/plane-boundary.test.ts
  test/unit/routing/live-isolation.test.ts
  test/unit/privacy/redaction.test.ts` — 16/16 pass.
- `pnpm tsx --test test/integration/m3/redaction.test.ts
  test/integration/cli/delete.test.ts` — 6/6 pass.
- Import-closure audit script (§1.4) — results in §1.1.

All runs were against the shared Round 1 working tree (includes sibling
slots' uncommitted redaction/doctor/pi-adapter changes).

# Isolation & privacy SOTA review, Round 2 — 2026-08-24

Scope: Round 2 slot fable-2 re-audit of live-vs-shadow isolation, privacy
claims vs code, and ADR honesty, measured as a delta against the Round 1
report (`2026-08-24-sota-isolation-privacy.md`). Evidence only; the edits made
alongside this report are honesty updates to `docs/data-dictionary.md` and the
ADR-005 enforcement note.

Baseline: branch `agent/sota-persistent-opt-7e63` at commit `9ceaad8`
("round-1 SOTA polish"), plus Round 2 sibling agents' uncommitted working-tree
changes. Sibling work landed **while this audit ran**; every claim below names
the tree state it was verified against, and the final verification pass is
recorded in §6.

## 1. Isolation delta vs Round 1

### 1.1 Round 1's top isolation gap is closed

Round 1's finding: `test/unit/routing/live-isolation.test.ts` scanned the
literal source text of ten hand-listed files and could not see transitive
imports, so the two module-graph leaks (bandit via the learner chain, topology
via the parked supervisor import) slipped past it.

The Round 2 working tree replaces that test with a **transitive
import-closure check** (the upgrade recommended in Round 1 §1.4):

- Walks the real module graph from four live entry points (`cli/main.ts`,
  `run/flowchart-run.ts`, `run/supervisor.ts`, `track/loop.ts`).
- Forbids `routing/r1.ts`, `routing/shadow.ts`, `routing/r1-shadow-report.ts`,
  `experiments/shadow-compare.ts`, `experiments/simulation-holdout.ts`
  anywhere in the closure, with a readable import chain on failure.
- Pins the two known reachable learned-routing modules as an explicit
  allowlist **with their exact importers**: `routing/bandit.ts` may be
  imported only by `learning/bandit-store.ts`, `routing/topology.ts` only by
  `run/supervisor.ts`. Gaining or losing an importer fails the test.
- Guards the *call* level, not just the module level: `bandit-store.ts` may
  import only `BanditState`/`createBanditState`/`recordReward`; no in-closure
  module other than `routing/bandit.ts` may mention `selectArm`; no in-closure
  module other than `bandit-store.ts` may mention `loadProjectBandit`; no
  module other than `run/supervisor.ts` may mention `planTaskTopology`.
- Keeps the old ten-file list as a vacuousness guard: all ten must remain
  inside the closure or the entry-point list has drifted.

Independent re-verification: this slot re-ran its own Round 1 closure walker
against the current tree. Results identical to Round 1 — r1/shadow/report/
compare/holdout **absent** from all four closures (158/93/122/65 files);
bandit present only via `cli/main.ts` and `track/loop.ts` (learner chain);
topology present only via `cli/main.ts` and `run/supervisor.ts`; r0 present
everywhere via the evidence-cascade value import. The new test and the
independent walker agree.

### 1.2 Supporting isolation hardening landed by siblings

- **`bandit.json` reads are now validated** (`isBanditState` in
  `learning/bandit-store.ts`, gpt-sol-1): a malformed or structurally invalid
  file returns `undefined` instead of being trusted as `BanditState`.
  Direct persistence tests added (`test/unit/learning/bandit-store.test.ts`),
  including "no runtime-plane writes" and corrupt-state recovery.
  `loadProjectBandit` still has zero callers in `src/` — now pinned by the
  closure test's reader check rather than resting on a grep.
- **`plane-boundary.test.ts` prefix gap closed**: `../supervisor/` and
  `../cli/` added to the runtime prefix list (Round 1 §2 noted their absence).
  The allowlist gained the one import this exposed —
  `adaptation/eval-routing.ts → supervisor/model-router.js` — pinned as
  **type-only**, and a new test asserts every type-only exception stays
  `import type` (a value import now fails) and that stale exceptions are
  dropped. The five Round 1 exceptions are unchanged.
- **`src/routing/r0.ts` header comment fixed** (Round 1 handoff item): it now
  states the module-graph truth — r0 IS inside the live closure via
  `live-cascade → cascade-evidence` (value import of `applyCascade`), and what
  live execution does not do is call `routeR0`.

### 1.3 Bounded caveats of the new enforcement (not regressions)

- The closure walker (test and this slot's independent script alike) resolves
  double-quoted static/dynamic relative specifiers. Repo style is
  double-quoted specifiers throughout; a computed `import(expr)` would be
  invisible to both. Acceptable today, worth a lint-level backstop eventually.
- The forbidden/watch lists are enumerated modules. A **new** learned-router
  file would need a conscious list edit; the importer-pinning makes silent
  growth of the two allowances impossible, but does not auto-discover new
  exploratory modules.
- `plane-boundary.test.ts` remains a **direct-import** scan over the five
  adaptation directories. It is not transitive: an adaptation module could
  reach runtime data through an intermediate non-runtime helper without
  tripping it. No such laundering exists today (checked); this is the main
  boundary gap left for Round 3 (§4).

## 2. Privacy delta vs Round 1

Round 1 disclosed six delete-cascade holes in the data dictionary. The Round 2
working tree (opus-2, landed mid-audit) closes four of them **in code**; this
slot verified each directly against a scratch state root
(`/tmp/verify-delete.mts`, results below) plus the shipped suites.

### 2.1 Closed this round (verified on-disk, not just claimed)

1. **Cascade now strips `summary` as well as `body`** — `stripFreeText` in
   `src/privacy/deletion.ts` removes both free-text fields; the rewritten
   JSONL line carries neither. Verified: a record with
   `body`+`summary` bound to the deleted episode is rewritten to the bare
   shell `{id, episodeId, kind, rubricVersion, score, evidenceRefs, redacted,
   createdAt}`; text gone from disk, id tombstoned. `record-classes.ts` now
   lists `sensitiveFields: ["body", "summary"]` for feedback.
2. **`delete --run` now reaches the global invocation log** —
   `dropRunFromInvocationLog` filter-rewrites `runtime/invocations.jsonl`
   under the log's cooperative lock, fails closed on a corrupt middle line
   (nothing deleted rather than a partial delete reported as success), and
   reports dropped-row counts. Verified: 2 of 3 rows (the target run's)
   dropped, the other run's row kept byte-identical.
3. **`catalog-observed.json` is invalidated on run delete** — a percentile
   aggregate cannot have one run subtracted, so the stale snapshot is
   unlinked; the class's declared recovery ("rebuild from invocations.jsonl")
   already covers it and readers treat a missing file as "no observations".
   Verified: file gone after a run delete that dropped rows.
4. **Episode `.lock` removed on `delete --episode`.** Verified.
5. **`record-classes.ts` propagation declarations reconciled** (Round 1 hole
   4): `run-event` no longer declares the unimplemented `episode`
   propagation and now declares what the code does
   (`run-checkpoint`, `run-pause`, `track-questions`, `model-invocation`);
   `feedback → preference-dataset` and `candidate → experiment` phantom
   propagations emptied with in-code justifications;
   `deletionPropagatesTo` is now documented as a behavioral claim, with
   intended-but-unimplemented propagation belonging in the dictionary.
6. **Cost-calibration eligibility wired** (Round 1 leftover 3, runtime data
   quality): `calibrateCatalogRates` now gates on `isCostEligible` — only
   `callOutcome: "ok"` rows move a rate; failed calls and legacy
   outcome-less rows are excluded and **counted**
   (`excludedNotOk`/`excludedUnattributed`/`skippedMissingUsage`), so a
   calibration that stops moving is diagnosable. Note the behavior change:
   legacy rows written before outcome attribution no longer calibrate at all
   (conservative; consistent with `usage-aggregate.ts`).

### 2.2 Still open (unchanged from Round 1, re-verified)

- **Episode objective text survives inside attached runs' event logs**
  (`EPISODE_OPENED` copy in `runtime/runs/<runId>/events.jsonl`).
  `delete --episode` still does not touch run logs; removal requires deleting
  the attached runs. Disclosed in the dictionary.
- **No preference cascade on episode delete**: observations keep payloads and
  `evidenceEpisodeId` links to a deleted episode; `pref delete` is the
  per-observation tool. Disclosed.
- **`redacted: true` still means "the redaction pass ran"**, not "content was
  removed": `feedback/store.ts` hardcodes `redactPII: true` and the `pii`
  class is a pass-ran marker; `RedactionDecision.classes` is still not
  persisted, so "scanned clean" and "content removed" remain
  indistinguishable on disk. Disclosed; schema fix still queued.
- **New residual, honestly documented in the code**: the invocation-log
  rewrite serializes concurrent *deletes* via the lock, but the live appender
  (`onInvocation` in `cli/main.ts`) appends without taking it — deleting a
  run **while it is still executing** can race. Now also disclosed in the
  dictionary.

### 2.3 Snapshot honesty — suite status at final verification

Mid-audit, `test/unit/routing/cost-calibration.test.ts` was 3/6 red (its
fixtures predated the eligibility gate). By round close the implementing slot
had updated the fixtures, added `test/unit/privacy/deletion.test.ts` (9 tests
pinning the cascade on raw bytes — the seeded body/summary strings must not
match the rewritten log, and `"summary"` must not even appear as a key), and
extended the delete integration and record-classes suites (propagation
declarations are now pinned to `IMPLEMENTED_PROPAGATION` in the test, so a
declaration without code fails).

Final verification by this slot against the closing tree: typecheck clean;
full `pnpm test` **1314 pass / 0 fail / 1 skip** (Round 1 baseline was 1282
pass / 1 skip).

## 3. ADR honesty

| ADR | Status | Round 2 verdict |
|---|---|---|
| 001/002/003 | Accepted | Unchanged, still match reality |
| 004 controlled adaptation | Accepted | Enforcement unchanged and real (proposal-first, CAS pointer, `runAutoAdaptLoop` structurally cannot promote). No edit needed |
| 005 checkpoint F holdout | Accepted | Decision intact. The 2026-08-24 **enforcement note** was updated (this slot): the "source-text, non-transitive, queued follow-up" description is superseded — the shipped test is now the transitive closure check with the two-importer-pinned allowlist. Decision text untouched |
| 006 pi extension | **Proposed** | Re-verified all three interim constraints: `package.json` has `pi.skills`/`pi.prompts` but **no** `pi.extensions`; zero `pi-coding-agent` imports anywhere; skill front-matter still "Diagnostic overlay only". `PI_EXTENSION_IMPORT_ALLOWED` still prose-only. **Not flipped** |

No Outcome-supported claim anywhere in the Round 2 tree; F-PROD open; P0
independent-reviewer sign-off still open (not closed by this report).

A matrix staleness briefly existed mid-round — the R1/bandit/topology row
still described the Round 1 direct-import test — but fable-1 refreshed it
before round close; the row now describes the transitive closure with the
two-entry allowlist and the zero-live-caller facts (verified).

## 4. Ranked Round 3 risks

1. **Boundary transitivity** (isolation): `plane-boundary.test.ts` is a
   direct-import scan; adaptation→runtime laundering through an intermediate
   helper module would not trip it. The closure machinery now exists in
   `live-isolation.test.ts` — reuse it to build the adaptation closure and
   assert it never reaches runtime record readers/writers (allowlisting the
   sanctioned `from-episode` pipe). Also latent: the relative-prefix match
   (`../run/`) would miss imports from a nested adaptation subdirectory;
   none exist today.
2. **Eval independence** (ADR-005 items 3/6): sealed-holdout and critic
   independence rest on convention, not tests. Nothing pins that the offline
   eval path (`adaptation/eval-routing.ts`, `routing-eval-report`) cannot
   read tracking `score` into reward, that self-report weight stays 0, or
   that `extraSignals` forging `criterion: taskSuccess` fails closed
   end-to-end from the CLI surface. Worth an acceptance test before any
   F-SIM claim is drafted.
3. **F-PROD stays open** — no production paired-outcome evidence exists or
   is claimed. The risk is drift: as isolation/privacy language improves,
   summaries start reading like "adaptive routing is ready". Keep every new
   doc pointing at the F-PROD gate (this round's docs do).
4. **Redacted-flag semantics** (carried from Round 1): persist
   `RedactionDecision.classes` (or split the flag into scanned/transformed)
   so on-disk records distinguish "scanned clean" from "content removed".
   Schema change — needs a migration-version bump on the feedback class.
5. **Episode text in attached runs** (carried): either have
   `delete --episode` list the attached runs it is *not* deleting (so the
   operator can follow up), or document a one-command recipe. Cascading the
   deletion automatically is probably wrong (runs may hold other work).
6. **Delete-vs-appender race**: `onInvocation` appends to
   `invocations.jsonl` without the lock the delete rewrite takes. A delete
   during a live run can drop or resurrect rows. Either take the lock in the
   appender (cost: per-invocation lock traffic) or document "delete after
   the run terminates" as the supported flow — currently only the code
   comment says this.
7. **`catalog-observed` p50s still fold non-`ok` rows**:
   `src/routing/catalog-observed.ts` has no `callOutcome` gating (verified —
   zero references), so the latency/volume percentiles retain the
   zeroed-usage exposure the cost rates just lost. Same wiring fix
   (`costEligibleInvocations`), different file; flagged by the implementing
   slot too.
8. **Cost-calibration silence on legacy state roots**: outcome-less rows no
   longer calibrate. Correct, but a long-lived state root migrated from
   pre-outcome builds will see calibration freeze at catalog rates with only
   the new counters explaining why. Surface `excludedUnattributed` in
   `doctor --json`.
9. **Isolation-test discovery gap**: the forbidden list is enumerated;
   consider a convention gate (e.g. everything under `src/experiments/`
   is forbidden-by-default in the live closure) so a new shadow module is
   caught without a list edit.

## 5. Blocked / handoff

Both handoffs identified mid-audit were resolved by their owners before round
close: fable-1 refreshed the status-matrix enforcement wording (§3) and the
implementing slot updated the cost-calibration fixtures (§2.3). Nothing is
blocked; the Round 3 items in §4 are the remaining queue.

## 6. Verification log

- Independent import-closure walker re-run against the Round 2 tree
  (`/tmp/import-graph.mjs`, same method as Round 1 §1.4): results in §1.1.
- Deletion-engine evidence script (`/tmp/verify-delete.mts`) against a
  scratch state root: episode delete removed `.jsonl`+`.events.jsonl`+`.lock`;
  cascade left the record shell with **no** `body`/`summary` bytes on disk
  and persisted the tombstone; run delete dropped exactly the target run's 2
  invocation rows, kept the other run's row, and unlinked
  `catalog-observed.json`.
- `pnpm exec tsc --noEmit` — clean.
- Targeted suites (isolation, plane-boundary, record-classes, redaction,
  delete integration, m3 redaction, bandit-store, cost-calibration,
  deletion unit) — all green at round close.
- Full `pnpm test` against the closing tree — **1314 pass / 0 fail / 1 skip**.
- All runs against the shared working tree with sibling Round 2 changes
  present (bandit-store hardening, transitive isolation test, plane-boundary
  expansion, deletion cascade + tests, cost-calibration gate + fixtures,
  run-tests wrapper, status-matrix/README refresh).

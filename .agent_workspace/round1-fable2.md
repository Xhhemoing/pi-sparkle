# Round 1 fable-2
MODEL_SLUG: claude-fable-5-thinking-xhigh

Full evidence report: `docs/reports/2026-08-24-sota-isolation-privacy.md`.
Honesty patches applied: `docs/data-dictionary.md` (delete-command limits +
redacted-flag semantics), `docs/decisions/0004` (stale "remains Proposed"
follow-up line), `docs/decisions/0005` (dated enforcement-status note,
decision text untouched). ADR-006 left Proposed. P0 sign-off left open.

## Isolation proof (live vs shadow)

Transitive import-closure audit from every live entry point (script + full
table in report §1):

- `routing/r1.ts`, `routing/shadow.ts`, `r1-shadow-report`, `shadow-compare`,
  `simulation-holdout`: **unreachable** from `cli/main.ts`,
  `run/flowchart-run.ts`, `track/loop.ts`, `run/supervisor.ts`. The ADR-005
  selection ban holds.
- **Leak 1 (module graph only)**: `routing/bandit.ts` is loaded by the live
  track path via `learning/auto-loop.ts → learning/bandit-store.ts`, but only
  the learner half (`createBanditState`/`recordReward`, post-run bookkeeping
  of `bandit.json`). `selectArm`'s sole non-test caller is `routing/shadow.ts`
  (unreachable live); `loadProjectBandit` has zero callers in `src/`. No live
  selection through the bandit.
- **Leak 2 (module graph only)**: `routing/topology.ts` imported at module
  level by `run/supervisor.ts:40` for the parked `planTaskTopology`, which
  the run loop never calls (pinned by `live-isolation.test.ts`). Note:
  ADR-005's ban does not name topology; only the status-matrix wording does.
- `routing/r0.ts` is also in the live closure (via `live-cascade →
  cascade-evidence`, value import of `applyCascade`); live calls only the
  pure `resolveEvidenceCascade`. r0.ts's own comment "Live flowchart
  execution does not import this module" is false at module-graph level.
- Live adaptation happens only through the CAS-promoted routing-policy
  pointer (`loadLearnedRouting`, hash-verified, `adapt promote --approve`
  required); `runAutoAdaptLoop` structurally cannot promote. Matches ADR-004.
- The shipped `live-isolation.test.ts` is source-text over a fixed ten-file
  list — it cannot see transitive imports. Closure check is the gap.

## Privacy claim vs code

- Plane split + boundary allowlist: verified; 5 pinned exceptions all
  justified (3 type-only Event shapes + the PASS/FAIL derived-signal reader
  pair in `learning/from-episode.ts`).
- Redaction: at commit `9a7cb17` `redactPII` was a label-only no-op (known
  finding); the Round 1 working tree (redaction owner slot) now removes
  values (secrets/paths/email/IP/phone/Luhn-gated cards) from both `body`
  and `summary`; `prompt-injection` deliberately undetected with in-module
  rationale. Residual: persisted `redacted: true` means "pass ran", not
  "content removed" — decision classes are not persisted. Documented in the
  dictionary.
- Delete cascade holes found and disclosed in the dictionary:
  (1) cascade strips `body` but not `summary`, which carries derived user
  text from `learning/signals.ts`; (2) episode objective text survives in
  attached runs' `events.jsonl` (`EPISODE_OPENED` copy); (3) `delete --run`
  cannot remove the run's rows from the global `runtime/invocations.jsonl`
  despite the class's run-scoped/delete-files declaration; (4) declared
  `run-event → episode` propagation is deliberately unimplemented but still
  declared; (5) no preference cascade on episode delete; (6) episode `.lock`
  survives.
- Preference exports honest: dataset export strips ids +
  `evidenceEpisodeId`, always lists tombstones; authorized export gates
  tombstones behind `includeTombstones`; `deleteObservation` physically
  removes payloads.

## ADR honesty

- ADR-001/002/003: status matches reality.
- ADR-004 Accepted: enforcement real (proposal-first profiles,
  `maxAutoPromotions: 0`, CAS pointer). Fixed the contradictory Follow-up
  line that still said "remains Proposed".
- ADR-005 Accepted: appended a dated, informative enforcement-status note
  (module-graph nuances above); Decision text untouched.
- ADR-006 Proposed: verified all three interim constraints (no
  `pi.extensions` — pinned by test; no `pi-coding-agent` import anywhere;
  skill front-matter declares diagnostic-overlay-only). **Not flipped.**
  `PI_EXTENSION_IMPORT_ALLOWED` exists only as prose, no code flag.
- Not Outcome-supported anywhere; F-PROD open; consistent with the matrix.

## Remaining P0/P1 holes

- P0 (process): independent-reviewer re-verification of Q1/Q2 remediation is
  still the open closing act. Not closed here.
- P1: feedback `summary` not stripped by the episode cascade + not listed as
  a sensitive field in `record-classes.ts`.
- P1: episode text survives in attached runs' event logs after
  `delete --episode` (now disclosed; needs either run-list output or a
  documented deletion recipe).
- P1: `delete --run` under-delivers `model-invocation`'s declared
  run-scoped deletion (global `invocations.jsonl` + `catalog-observed`).
- P1 (guard): isolation test is not transitive; bandit/topology already slip
  through as module-graph facts.

## Ranked next-round work

1. Strip `summary` (or the whole free-text payload set) in
   `cascadeFeedbackTombstones`; add `summary` to feedback sensitiveFields in
   `record-classes.ts` + test. (src owner needed — not this slot.)
2. Upgrade `live-isolation.test.ts` to a transitive import-closure check
   with a two-entry pinned allowlist (bandit-store learner chain, parked
   supervisor topology import).
3. `delete --run`: filter-rewrite `runtime/invocations.jsonl` (and either
   rebuild or invalidate `catalog-observed.json`), or weaken the declared
   class to match reality.
4. Reconcile `record-classes.ts` `run-event.deletionPropagatesTo: ["episode"]`
   with the deliberate non-implementation; align status-matrix R1/bandit/
   topology row wording with ADR-005 (fable-1 owns the matrix).
5. Fix `src/routing/r0.ts` header comment; decide whether `SPARKLE_AUTO_ADAPT=0`
   should also skip `updateProjectBandit` or document bandit updates as
   "collection".
6. Persist `RedactionDecision.classes` (or split the `redacted` flag into
   scanned/transformed) so on-disk records distinguish "scanned clean" from
   "content removed".
7. Preference cascade (or explicit non-goal note) for episode deletion;
   remove episode `.lock` on delete.

## Tests run (none expected unless you only read)

Read-only verification runs (no test files edited by this slot):

- privacy + isolation unit suites: 16/16 pass
  (`record-classes`, `plane-boundary`, `live-isolation`, `redaction`).
- integration: `m3/redaction` + `cli/delete`: 6/6 pass.
- import-closure audit script (documented in the report §1.4).

Note: runs happened against the shared working tree that already contains
sibling slots' uncommitted changes (redaction implementation, doctor JSON,
pi-executor retry/usage gate, tsconfig map strip).

## Blocked / handoff

- `docs/status-matrix.md` (fable-1): soften "R1 / bandit / topology … must
  not import into live execution" to match ADR-005 + module-graph reality
  (selection ban holds; learner/parked imports exist and are pinned).
- `src/routing/r0.ts` (any src-owning slot): stale header comment.
- `src/privacy/deletion.ts` + `src/privacy/record-classes.ts` (src owner):
  summary strip + sensitiveFields + propagation declaration fixes (items 1,
  3, 4 above).
- `src/learning/auto-loop.ts` (src owner): kill-switch position vs
  `updateProjectBandit`, if the owner wants "0 = collect only, no adaptation
  state writes".
- `test/unit/routing/live-isolation.test.ts` (test owner): transitive
  closure upgrade (item 2); this slot's walker script is embedded in the
  report for reuse.
- No blockers for this slot's own deliverables; both required files exist.

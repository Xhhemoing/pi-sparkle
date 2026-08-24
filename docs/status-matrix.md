# Status matrix (Developer Preview)

This is the executable map of what is implemented, wired, exercised, and
outcome-supported. It is **not** a production readiness certificate.

Definitions (ADR-004):

- **Present** — code or candidates exist.
- **Wired** — a runtime or CLI path can invoke it.
- **Exercised** — tests or local fake runs have used that path.
- **Outcome-supported** — held-out or comparable later benefit, no guardrail
  regression. Nothing in this repo is Outcome-supported.

## Runtime line (M0–M2.5)

| Capability | Present | Wired | Exercised | Outcome-supported | Notes |
|---|---|---|---|---|---|
| Fake executor `run` / `inspect` / `resume` | yes | yes | yes | no | Default local path. Quality gate: `pnpm gate`. Loop 2: `inspect --run` aggregates `requiredEvidence` from the **latest** `STALL_DETECTED`/`RUN_BLOCKED` payload (last writer wins, verbatim, `[]` when the run never stalled — `src/run/inspection.ts`); prose prints a `required evidence (n):` list, and opt-in `--summary-json` prints one `INSPECT_SUMMARY` object (`type`/`runId`/`status`/`requiredEvidence`). `--json` stays a pure event NDJSON stream — the summary is deliberately **not** a domain `Event` (no `id`, type outside the `Event` union) and the two flags are mutually exclusive. Loop 3: `INSPECT_SUMMARY` is **frozen additive-only**, same policy as doctor's `DoctorJsonReport` (`InspectSummaryJson` in `src/run/inspection.ts`): consumers may pin `type`/`runId`/`status`/`requiredEvidence`; new keys may be added; existing keys never change meaning, type, or disappear. The freeze covers the object shape only — it stays a developer-preview surface, run-only (`--episode` refuses it), and outside the event log. |
| `migrate-legacy` | yes | yes | unit tests (`test/unit/cli/migrate-legacy.test.ts`) | no | Copies pre-plane flat state into `runtime/` + `adaptation/` with fixed per-source plane mapping. Dry-run default; `--apply` copies, never moves/deletes/overwrites; corrupt JSONL (non-tail) refuses the copy. |
| `--children` parent coordinator | yes | yes | yes | no | Fake child executor when `--executor` is omitted or `fake`. The CLI compiles the spec through `compileChildrenToFlowchart` and executes it on the flowchart engine with `ChildCoordinator` child semantics (corrected 2026-08-24; "not the flowchart engine" was stale). `startParentRun` remains a library/test-only entry. Plain `--children` starts **without a requirement contract**: the run binds `skipContract: true` (`src/run/flowchart-run.ts`) and the coverage gate never fires on this path. Loop-2 decision: keep and document — the runtime does not silently derive a contract from `acceptanceCriteria` (per-task criteria still gate each child's `TASK_RESULT`; they are not a run-level contract), pinned by `test/integration/m2.5/cli-contract-honesty.test.ts` (children runs persist only the synthetic `run-complete` criterion; `--track` records its extracted contract). Use `--track` for a coverage-gated start. |
| `compileChildrenToFlowchart` | yes | yes | library tests | no | Wired at the CLI children path and the track loop (corrected 2026-08-22; was stale). Real-provider coverage of this path is still open. |
| `--flowchart` supervisor | yes | yes | yes | no | Public orchestrator. Incompatible with `--children` / `--track`. Optional `--executor fake\|pi` runs RUNNING nodes; `--results` still overrides. |
| Event log + checkpoint + resume | yes | yes | yes | no | Truncated JSONL tail recovered; corrupt middle line fails closed. |
| Episode bind / `inspect --episode` | yes | yes | yes | no | Reducer is fail-closed on duplicate open/attach, terminal replay, and dangling cross-stream refs. |
| Privacy delete cascade (`delete --run` / `--episode`) | yes | `delete` CLI | unit (`test/unit/privacy/deletion.test.ts`) + integration (`test/integration/cli/delete.test.ts`) | no | Extended 2026-08-24 R2: `delete --run` removes `runtime/runs/<runId>/`, filter-rewrites the shared `invocations.jsonl` (fail-closed on a corrupt middle line) and invalidates `catalog-observed.json` (`src/privacy/deletion.ts`). `delete --episode` removes `<epId>.jsonl` / `.events.jsonl` / `.lock` and strips **both** free-text fields (`body`, `summary`) from bound feedback, tombstoning ids. R3: `EPISODE_OPENED` copies of episode text inside attached runs' append-only `events.jsonl` are deliberately not rewritten; they are **detected and reported** (`residualEpisodeTextRunIds` via `findResidualEpisodeText` in `src/privacy/deletion.ts` — unreadable logs are reported, never assumed clean) and the CLI prints the `delete --run <id>` recipe per residual run (`src/cli/main.ts`, delete command output). Preference cascade on episode delete is a documented deliberate non-goal (comment above `deleteEpisodeRecords`' preference note in `deletion.ts`). Loop 2: the delete-vs-live-appender race is **closed** — the live append and the delete rewrite share the log's cooperative lock via `src/telemetry/invocation-log.ts` (`appendInvocationRecord` / `withInvocationLogLock`), so an append lands wholly before the rewrite's read or wholly after its write (pinned in `test/unit/telemetry/invocation-log.test.ts` and the deletion tests). Honest residuals by design: a live append that cannot take the lock times out and **drops that telemetry row** (never fails the run); cross-process append order is whatever the lock grants; readers stay lock-free. |
| Cost calibration (observed rates) | yes | catalog load path | unit (`test/unit/routing/cost-calibration.test.ts`) | no | 2026-08-24 R2: only cost-eligible rows move a rate — `isCostEligible` requires `callOutcome === "ok"` (checked in `calibrateCatalogRates`, `src/routing/cost-calibration.ts`); non-ok and legacy no-outcome rows are excluded **and counted** (`excludedNotOk` / `excludedUnattributed`) so a stalled calibration is diagnosable; missing/zero usage is skipped, never read as zero tokens. |
| Coverage gate | yes | `--track` / library starts with a contract | unit + integration | no | Enforced by `assertCoverageAllowsStart` at `startFlowchartRun` / `startParentRun` / `startSupervisedRun` when a contract is provided; `--track` builds one, plain CLI `--children` does not and records `skipContract: true` (corrected 2026-08-24; "parent start" alone was stale — `startParentRun` is tests-only). Skip-contracts and answered questions still start. Loop-2 decision: the contract-less children start is documented, not patched — deriving a contract would silently change start semantics for existing specs. |
| Real Pi executor | yes | `--executor pi` | opt-in `PI_SMOKE=1`; fake-backed `cluster-tools` + `auth-session` units (`test/unit/pi-adapter/cluster-tools.test.ts`, `auth-session.test.ts`, 2026-08-24 R3) | no | Needs Node `>=22.19.0`, credentials, models, network. End-to-end real-provider coverage remains smoke-only. |
| Provider retry (429/5xx) | yes | inside `--executor pi` only (opt-in path) | unit tests (`provider-retry`, `executor-retry`) | no | Classifies thrown SDK errors and flattened `errorMessage` strings; honors `Retry-After` / `remedy_hint` up to 30s, exponential backoff capped at 8s, max 3 attempts; 401/403 never retried. Failed calls record usage as `undefined`, never zero, with `callOutcome` attribution. |
| Persist file lock | yes | bandit/preference/feedback writes | unit tests (`test/unit/persist/file-lock.test.ts`) | no | Exclusive `wx` lock; fd leak on metadata write fixed 2026-08-24. Stale locks are timeout-only (no PID-reuse steal by design): an abandoned lock means timeout + manual cleanup. |
| `doctor` | yes | yes | unit tests | no | Developer-preview preflight. `--json` emits frozen `DoctorJsonReport` (`preview`, `liveAdaptive: false`, `checks[]`, `next[]`). Prose remains the default. Informational `legacy-layout` check never fails the preflight. |
| Retention bounds | no | no | sizing probe only (`scripts/retention-probe.mjs`, 2026-08-24 R3) | no | Retention of `runtime/invocations.jsonl` and `runtime/episodes/` is unbounded (accepted Q3 position). The probe measures on-disk growth and reports `unbounded: true` without failing — it is a diagnostic, not a gate. Bounding (age- or size-based, delete-cascade-consistent) is an open policy decision. |

## Pi compatibility line (pin + auxiliary tooling)

Everything below is developer preview and, like the rest of this matrix, not
Outcome-supported. Flag spellings match the CLI USAGE in `src/cli/main.ts`.
No Pi extension is registered (ADR-006 stays Proposed): `package.json#pi`
declares only `skills` and `prompts`, and `@earendil-works/pi-coding-agent`
is not a dependency.

| Capability | Present | Wired | Exercised | Outcome-supported | Notes |
|---|---|---|---|---|---|
| Pi pin 0.84.3 | yes | `src/pi-adapter/` only (ADR-001) | typecheck + adapter tests + `test/unit/pi-boundary.test.ts` specifier tripwire | no | Exact matching pair `@earendil-works/pi-agent-core` / `@earendil-works/pi-ai`, no ranges. `pi-coding-agent` is not a dependency. Bump playbook: [how-to-adapt-to-pi](how-to-adapt-to-pi.md). |
| `pi-compat` CLI | yes | `pi-sparkle pi-compat [--json] [--offline]`; online opt-in via `pi-sparkle pi-compat --online [--json]`; script alias `pnpm pi-compat` | unit tests (`test/unit/cli/pi-compat.test.ts`, `test/unit/pi-compat/`) + local runs | no | Offline default; online fails closed to `status=unknown`, exit 0. Exit 1 only on adapter-contract breakage. Legacy-identifier probe reads adapter sources only, never docs. Sibling probes: `pnpm pi:probe`, `pnpm pi:latest`. |
| doctor `pi-packages` / `pi-compat` checks | yes | appended `doctor` checks | unit tests (`test/unit/cli/doctor.test.ts`) + local run | no | `pi-packages` prints the pinned pair; `pi-compat` always uses the offline report (no network). Inherits doctor's unfrozen output contract. |
| `run --thinking <level>` | yes | all three `run` forms (plain, `--track`, `--flowchart`) | `test/unit/cli/thinking-flag.test.ts`; clamp characterization in `test/unit/pi-adapter/thinking-clamp.test.ts` | no | Levels `off\|minimal\|low\|medium\|high\|xhigh\|max`; flag > `PI_THINKING_LEVEL` > `off`; per-run, never persisted (headless counterpart of Pi's session-scoped TUI `/thinking`). Google models silently clamp `xhigh`/`max` — provider behavior, not rewritten by the CLI. |

## Adaptive library line (M3–M6)

| Capability | Present | Wired | Exercised | Outcome-supported | Notes |
|---|---|---|---|---|---|
| R0 / static `ModelRouter` | yes | live flowchart + `--children` assign | yes | no | Live path. |
| Public prior snapshot | yes | `--public-prior` | yes | no | Hashed frozen file only; no HTTP leaderboard fetch. |
| R1 / bandit / topology | yes | **shadow / offline only** | module tests | no | Must not import into live execution until F-PROD. Enforcement (2026-08-24 R2): `live-isolation.test.ts` walks the **transitive** import closure from four live entry points with a pinned two-entry allowlist — `routing/bandit.ts` reachable only as the post-run reward **writer** via `bandit-store` (`selectArm` and `loadProjectBandit` have zero live callers), `routing/topology.ts` only as the parked defined-but-unused `planTaskTopology` in `run/supervisor.ts`. R1/shadow/holdout modules must stay unreachable. |
| Auto-loop collect + propose | yes | after `--track` / `--children` | yes | no | Never CAS-promotes. `adapt promote --approve` (with `--candidate --expected --content-file --review-file`) required. Kill switch (R3): `SPARKLE_AUTO_ADAPT=0` collects and diagnoses only — observation continues, everything that *learns* stops: no `bandit.json` update, no candidate proposal (`src/learning/auto-loop.ts:101–114`; the result reports `banditUpdated: false`). |
| Promotion CAS + rollback | yes | CLI | unit tests | no | Proposal-first. |
| Redaction as transform | yes | `appendFeedback` (every adaptation-plane feedback write) | unit + privacy + integration (`feedback/redaction`, `privacy/redaction`, `m3/redaction`, `feedback/store`) | no | 2026-08-24: value-removing transform, not label-only — secrets (PEM, Bearer, vendor keys, JWT, keyed assignments), email/IPv4/phone/Luhn-valid cards, home/UNC paths replaced with stable placeholders; ReDoS-hardened; oversized bodies dropped to reference-only. R3: the per-class decision is now **persisted** as `redactionClasses` on the record (`src/feedback/types.ts:54`, written at `src/feedback/store.ts`); the closed vocabulary is validated on read and an unknown class fails the read closed. Three states are distinct by design: `undefined` = legacy row (unknown, not "clean"), a list without `secret` = pass ran and found none, `secret`/`path`/`oversized` present = value found and removed. Known limits: `pii` in the list still means "the PII pass ran"; prompt-injection class deliberately unused. |
| Preferences + tombstones | yes | `pref` CLI | yes | no | Dataset export lists tombstone ids and drops payloads; authorized export omits tombstones unless `includeTombstones` (integration redaction chain). |
| Requirement provenance + critic | yes | extraction + critique path | unit + integration (`checkpoint-d`) | no | Every deliverable/constraint/criterion sourced or assumed; critic reports omissions and is immutability-tested; never mutates the accepted contract. |
| Context packet fidelity + grounding query | yes | packet compile path | unit + integration (`packet-fidelity`, `checkpoint-d`) | no | Mandatory items keep full fidelity under adequate budget; `queryPacketGrounding` answers from the packet without the parent transcript. |
| Evaluation identity + independence | yes | `createEvaluationRecord` | unit + integration | no | Records carry target artifact/version and independence class; missing outcomes stay Unobserved, never fabricated. |
| Telemetry attribution | yes | `invocations.jsonl` round-trip | unit + integration (`pi-telemetry`) | no | Pricing catalog version separate from usage; retry/cache/timeout/cancel attributable; taxonomy versioning never rewrites history. Loop 2: every write to `invocations.jsonl` goes through the single locked writer surface `src/telemetry/invocation-log.ts` (validating append, fail-closed on a malformed record); `cost-calibration` re-exports the path from it so writer and reader cannot disagree on the location; reads stay lock-free. |
| Severe safety one-offs | yes | pattern detector | unit (`patterns.test.ts`) | no | Single explicit severe safety events surface as one-off readiness findings below the recurrence floor. |
| Checkpoint F-SIM | machinery | experiments | simulation tests | no | Must not close F-PROD. |
| Checkpoint F-PROD | no | no | no | no | Sealed holdout still open (ADR-005). |

## Policy gates (human)

Decision packages with per-gate evidence: [2026-08-21 gates readiness](reports/2026-08-21-gates-readiness.md).

| Item | Owner | Inputs | Exit | Verify |
|---|---|---|---|---|
| ADR-004 | product + privacy | this matrix, adaptive spec | Accepted 2026-08-21 | Status line in `docs/decisions/0004-controlled-adaptation.md` is Accepted |
| Six adaptive defaults | product | spec § Decision required | Approved 2026-08-21, unchanged | `docs/specs/adaptive-agent-work-loop.md` § Decision required |
| ADR-006 | product | extension proposal | Decided 2026-08-21: keep Proposed; no `extensions/pi-sparkle/` import until revisited | Status line in `docs/decisions/0006-pi-extension-reverse-adapter.md` |
| P0 privacy dictionary | runtime + privacy | `src/privacy/record-classes.ts` (18 classes; plane layout + delete cascade implemented 2026-08-22, see [review package](reports/2026-08-22-p0-privacy-review-package.md) §7; cascade extended 2026-08-24 — `summary` strip, invocation-log rewrite, episode-lock removal, `catalog-observed` invalidation) | Reviewer re-verification of Q1/Q2 remediation, then sign-off — **still open** | `pnpm test -- test/unit/privacy/` |
| Checkpoint D | adaptive | remaining M3 leftovers | Closed 2026-08-21: whole-checkpoint scenarios pass (`test/integration/m3/checkpoint-d.test.ts`), M3 leftovers closed | `tasks/adaptive-todo.md` |
| Checkpoint F-PROD | routing | sealed holdout, paired utility CI | 95% utility-delta LCB > 0 and cost-delta UCB ≤ 0 | ADR-005; do not start before P0 + Provider smoke |
| Checkpoint G Outcome-supported | routing | F-PROD | Held-out benefit without guardrail regression | Forbidden until F |

Live R1, bandit, and topology stay off the execution path until F-PROD closes.

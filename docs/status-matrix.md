# Status matrix (Developer Preview)

This is the executable map of what is implemented, wired, exercised, and
outcome-supported. It is **not** a production readiness certificate.

Definitions (ADR-004):

- **Present** — code or candidates exist.
- **Wired** — a runtime or CLI path can invoke it.
- **Exercised** — tests or local fake runs have used that path.
- **Outcome-supported** — held-out or comparable later benefit, no guardrail
  regression. Nothing in this repo is Outcome-supported.

Notes cells below state current posture only. The full evidence text,
round-by-round census notes, and contract wording live in the
[verbose notes archive](reports/2026-08-27-status-matrix-notes-archive.md)
(linked per row as `archive §N`).

## Runtime line (M0–M2.5)

| Capability | Present | Wired | Exercised | Outcome-supported | Notes |
|---|---|---|---|---|---|
| Fake executor `run` / `inspect` / `resume` | yes | yes | yes | no | Default local path. Merge gate `pnpm gate`; preview-tag gate `pnpm prerelease`. `inspect --run` surfaces latest stall/block required evidence; opt-in `--summary-json` prints one frozen-additive `INSPECT_SUMMARY` object, deliberately outside the `Event` union and mutually exclusive with `--json`. `resume --primary-model/--thinking` configure this resume only (nothing persisted). `run --max-cost-usd` stamps a per-run ceiling into `RUN_CREATED.limits`; unpriced models warn once and run uncapped; refused on `--flowchart`/`--track`. Full contract wording: archive §1. |
| `migrate-legacy` | yes | yes | unit tests (`test/unit/cli/migrate-legacy.test.ts`) | no | Copies pre-plane flat state into `runtime/` + `adaptation/`. Dry-run default; `--apply` copies, never moves/deletes/overwrites; corrupt JSONL (non-tail) refuses the copy. Archive §2. |
| `--children` parent coordinator | yes | yes | yes | no | Fake child executor by default; the spec is compiled through `compileChildrenToFlowchart` and executed on the flowchart engine with `ChildCoordinator` semantics. Plain `--children` deliberately starts contract-less (`skipContract: true`) — use `--track` for a coverage-gated start. `--max-cost-usd` is recorded and forwarded per child but not enforced by the fake; there is no cross-child spend ledger. Archive §3. |
| Cluster undelivered-mail reporting | yes | parent + flowchart outcomes and CLI stderr; host API | unit + `test/integration/cluster/undelivered-mail.test.ts` | no | Both cluster embedders pull a `ClusterMailReport` after settlement; exactly one frozen stderr warning when pending/dead-lettered mail remains. Same-role late delivery deliberately unavailable; `pending=` flags unclaimed roles (no TTL). Archive §4. |
| `compileChildrenToFlowchart` | yes | yes | library tests | no | Wired at the CLI children path and the track loop. Real-provider coverage of this path is still open. Archive §5. |
| `--flowchart` supervisor | yes | yes | yes | no | Public orchestrator, incompatible with `--children`/`--track`. BLOCKED settlements print the recorded reason/evidence plus exactly four routed lines (`inspect`, `inject`, `unblock`, `note`); `unblock --reason` records `RUN_UNBLOCKED` against the exact active `RUN_BLOCKED`, reopens without executing, and refuses stale/wrong-node requests. Archive §6. |
| Event log + checkpoint + resume | yes | yes | yes | no | Truncated JSONL tail recovered; corrupt middle fails closed. Flowchart resume restores node specs from logged `TASK_REQUEST`s and durable checkpoint records (`taskCriteria` monotone first-write-wins; absence is unknown, never synthesized). Run-level cost ceilings restore only from the run's own `RUN_CREATED.limits`. Terminal replay is shared by all writers with `RUN_UNBLOCKED` as the explicit BLOCKED-interval exception; crash terminals share `src/run/crash-terminal.ts` (one best-effort `RUN_FAILED`, no overwrites). Archive §7. |
| Episode bind / `inspect --episode` | yes | yes | yes | no | Reducer is fail-closed on duplicate open/attach, terminal replay, and dangling cross-stream refs. Archive §8. |
| Privacy delete cascade (`delete --run` / `--episode`) | yes | `delete` CLI | unit (`test/unit/privacy/deletion.test.ts`) + integration (`test/integration/cli/delete.test.ts`) | no | Filter-rewrites the shared invocation log and invalidates observed rates. Record-writing lifecycles hold `runtime/runs/<runId>.lock`; deleting a live run waits (bounded, `--lock-wait-ms`) or fails `LOCK_TIMEOUT` having removed nothing; SIGKILL lock recovery is doctor-guided manual removal (crash probe case 9). Episode text copies in append-only run logs are detected and reported, not rewritten. Archive §9. |
| Cost calibration (observed rates) | yes | catalog load path | unit (`test/unit/routing/cost-calibration.test.ts`) | no | Only `callOutcome === "ok"` rows move a rate; excluded rows are counted for diagnosability; missing/zero usage is skipped, never read as zero tokens. Archive §10. |
| Catalog/preference/bandit integrity | yes | catalog load + preference persistence + post-run adaptation | unit (`test/unit/routing/catalog-observed.test.ts`, `test/unit/preferences/preferences.test.ts`, `test/unit/learning/bandit-store*.test.ts`) | no | All three snapshots publish atomically; recovery follows the state class: catalog `CATALOG_OBSERVED_CORRUPT` (rebuildable), preferences `PREFERENCE_SNAPSHOT_UNREADABLE`, bandit `BANDIT_STATE_UNREADABLE` (bytes survive for repair). Does not wire the bandit into live selection. Archive §11. |
| Coverage gate | yes | `--track` / library starts with a contract | unit + integration | no | Enforced by `assertCoverageAllowsStart` when a contract is provided; `--track` builds one, plain `--children` deliberately does not. The deterministic verifier is the sole gate; the Pi executor's `sparkle_report_task_result` provides live `PASSED`/evidence-backed `FAILED` verdicts, including the per-criterion `unmet-acceptance-criterion` hard gate. Archive §12. |
| Real Pi executor | yes | `--executor pi` | offline loopback HTTP integration; opt-in `PI_SMOKE=1`; fake-backed `cluster-tools` + `auth-session` units | no | Every attempt exposes `sparkle_report_task_result` (leased identity, protocol v1, evidence-backed `FAILED`, optional per-criterion results). Loopback integration drives the exported CLI through run → approval → resume and proves model/thinking wire behavior plus a two-tier cascade over a local SSE server. Real-provider coverage remains opt-in smoke only. Archive §13. |
| Provider retry (429/5xx) | yes | inside `--executor pi` only (opt-in path) | unit tests (`provider-retry`, `executor-retry`) | no | Classifies thrown SDK errors and flattened `errorMessage` strings; honors `Retry-After` / `remedy_hint` up to 30s, exponential backoff capped at 8s, max 3 attempts; 401/403 never retried. Failed calls record usage as `undefined` with `callOutcome` attribution. Archive §14. |
| Persist file lock | yes | bandit/preference/feedback writes | unit tests (`test/unit/persist/file-lock.test.ts`) | no | Exclusive `wx` lock. Stale locks are timeout-only (no PID-reuse steal by design): an abandoned lock means timeout + manual cleanup. Archive §15. |
| `doctor` | yes | yes | unit tests (`test/unit/cli/doctor.test.ts`) | no | Read-only recursive inventories: `locks` (with per-lock remediation), `runStates` (advisory crash candidates), frozen-additive `learnedState` (bandit/preferences/catalog with plane-correct remediation). Doctor never repairs and never acquires/steals/deletes a lock. `LOCK_TIMEOUT`/`RUN_RECORDS_SURVIVED` failures route their `next:` line to `doctor --json`. Archive §16. |
| Retention bounds | yes | `retain` CLI | source + CLI dry-run probe; automated retention coverage pending | no | `retain` applies a 90-day default age policy to `runtime/invocations.jsonl` and `runtime/episodes/`; dry-run-first, deletes only with `--apply`, reusing the `delete` lock/cascade surfaces. Operator-triggered, not a background timer. Archive §17. |

Round-by-round truth-up notes (Rounds 9–13) and current runtime postures
(contract/checkpoint invariants, `sparkle_report_task_result` sweep results,
frozen `RunStatus`, `RUN_UNBLOCKED_WITH_DISCARD` authorization, crash-probe
case list) are archived verbatim at
[archive § Rounds 9–13](reports/2026-08-27-status-matrix-notes-archive.md#rounds-913-truth-up-and-current-runtime-postures).

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
| `resume --primary-model/--thinking` | yes | supervised and flowchart Pi executor reconstruction | resume-disclosure + sink-wiring units; loopback default-rebuild warning | no | The flags configure the executor being rebuilt now; no persisted executor configuration is restored. Pi resumes disclose requested-now versus default rebuild, while no-executor and non-Pi resumes disclose ignored flags. An invalid ambient `PI_THINKING_LEVEL` is refused with the same validation as `run`. |

## Adaptive library line (M3–M6)

| Capability | Present | Wired | Exercised | Outcome-supported | Notes |
|---|---|---|---|---|---|
| R0 / static `ModelRouter` | yes | live flowchart + `--children` assign | yes | no | Live path. |
| Public prior snapshot | yes | `--public-prior` | yes | no | Hashed frozen file only; no HTTP leaderboard fetch. |
| R1 / bandit / topology | yes | **shadow / offline only** | module tests | no | Must not import into live execution until F-PROD. Enforcement (2026-08-24 R2, amended Round 7): `live-isolation.test.ts` walks the **transitive** import closure from four live entry points with a pinned two-entry allowlist — `routing/bandit.ts` is reachable as the post-run reward **writer** via `bandit-store`; `selectArm` still has no live caller, while doctor's `loadProjectBanditByKey` call is the sole signed-off read-only diagnostic exception, used only for `learnedState` inventory and never for selection. R8-9's deletion of the unused root-keyed `loadProjectBandit` landed in `ba0b2ce`; the keyed diagnostic reader remains. `routing/topology.ts` remains reachable only as the parked defined-but-unused `planTaskTopology` in `run/supervisor.ts`. R1/shadow/holdout modules must stay unreachable. |
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
| P0 privacy dictionary | runtime + privacy | `src/privacy/record-classes.ts` (18 classes; plane layout + delete cascade implemented 2026-08-22, see [review package](reports/2026-08-22-p0-privacy-review-package.md) §7; cascade extended 2026-08-24 — `summary` strip, invocation-log rewrite, episode-lock removal, `catalog-observed` invalidation) | **Closed 2026-08-26** by [technical re-verification](reports/2026-08-26-p0-technical-reverification.md): Q1/Q2 tests green. An independent privacy-officer countersign remains welcome but no longer blocks the Developer Preview. | `pnpm test -- test/unit/privacy/ test/integration/cli/delete.test.ts` |
| Checkpoint D | adaptive | remaining M3 leftovers | Closed 2026-08-21: whole-checkpoint scenarios pass (`test/integration/m3/checkpoint-d.test.ts`), M3 leftovers closed | `tasks/adaptive-todo.md` |
| Checkpoint F-PROD | routing | sealed holdout, paired utility CI | 95% utility-delta LCB > 0 and cost-delta UCB ≤ 0 | ADR-005; do not start before P0 + Provider smoke |
| Checkpoint G Outcome-supported | routing | F-PROD | Held-out benefit without guardrail regression | Forbidden until F |

Live R1, bandit, and topology stay off the execution path until F-PROD closes.

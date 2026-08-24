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
| Fake executor `run` / `inspect` / `resume` | yes | yes | yes | no | Default local path. Quality gate: `pnpm gate`. |
| `--children` parent coordinator | yes | yes | yes | no | Fake child executor when `--executor` is omitted or `fake`. Not the flowchart engine. |
| `compileChildrenToFlowchart` | yes | yes | library tests | no | Wired at the CLI children path and the track loop (corrected 2026-08-22; was stale). Real-provider coverage of this path is still open. |
| `--flowchart` supervisor | yes | yes | yes | no | Public orchestrator. Incompatible with `--children` / `--track`. Optional `--executor fake\|pi` runs RUNNING nodes; `--results` still overrides. |
| Event log + checkpoint + resume | yes | yes | yes | no | Truncated JSONL tail recovered; corrupt middle line fails closed. |
| Episode bind / `inspect --episode` | yes | yes | yes | no | Reducer is fail-closed on duplicate open/attach, terminal replay, and dangling cross-stream refs. |
| Coverage gate | yes | `--track` / parent start | unit + integration | no | Skip-contracts and answered questions still start. |
| Real Pi executor | yes | `--executor pi` | opt-in `PI_SMOKE=1` | no | Needs Node `>=22.19.0`, credentials, models, network. |
| `doctor` | yes | yes | unit tests | no | Developer-preview preflight. Output contract is not frozen. |

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
| R1 / bandit / topology | yes | **shadow / offline only** | module tests | no | Must not import into live execution until F-PROD. |
| Auto-loop collect + propose | yes | after `--track` / `--children` | yes | no | Never CAS-promotes. `adapt promote --approve` required. |
| Promotion CAS + rollback | yes | CLI | unit tests | no | Proposal-first. |
| Preferences + tombstones | yes | `pref` CLI | yes | no | Dataset export lists tombstone ids and drops payloads; authorized export omits tombstones unless `includeTombstones` (integration redaction chain). |
| Requirement provenance + critic | yes | extraction + critique path | unit + integration (`checkpoint-d`) | no | Every deliverable/constraint/criterion sourced or assumed; critic reports omissions and is immutability-tested; never mutates the accepted contract. |
| Context packet fidelity + grounding query | yes | packet compile path | unit + integration (`packet-fidelity`, `checkpoint-d`) | no | Mandatory items keep full fidelity under adequate budget; `queryPacketGrounding` answers from the packet without the parent transcript. |
| Evaluation identity + independence | yes | `createEvaluationRecord` | unit + integration | no | Records carry target artifact/version and independence class; missing outcomes stay Unobserved, never fabricated. |
| Telemetry attribution | yes | `invocations.jsonl` round-trip | unit + integration (`pi-telemetry`) | no | Pricing catalog version separate from usage; retry/cache/timeout/cancel attributable; taxonomy versioning never rewrites history. |
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
| P0 privacy dictionary | runtime + privacy | `src/privacy/record-classes.ts` (18 classes; plane layout + delete cascade implemented 2026-08-22, see [review package](reports/2026-08-22-p0-privacy-review-package.md) §7) | Reviewer re-verification of Q1/Q2 remediation, then sign-off | `pnpm test -- test/unit/privacy/` |
| Checkpoint D | adaptive | remaining M3 leftovers | Closed 2026-08-21: whole-checkpoint scenarios pass (`test/integration/m3/checkpoint-d.test.ts`), M3 leftovers closed | `tasks/adaptive-todo.md` |
| Checkpoint F-PROD | routing | sealed holdout, paired utility CI | 95% utility-delta LCB > 0 and cost-delta UCB ≤ 0 | ADR-005; do not start before P0 + Provider smoke |
| Checkpoint G Outcome-supported | routing | F-PROD | Held-out benefit without guardrail regression | Forbidden until F |

Live R1, bandit, and topology stay off the execution path until F-PROD closes.

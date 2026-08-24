# Loop 4 — continuous SOTA optimization (`agent/opt-continuous`)

- **Branch:** `agent/opt-continuous`
- **Parent:** Cursor Grok 4.6 orchestrator (20+ round × 10-agent loop)
- **Base:** `main` @ `2a921ee` (PR #6 Loop 2 merged)
- **Started:** 2026-08-24
- **Quality bar:** measurable ≥5% for perf; defensive tests on every landing; no cosmetic refactors
- **Forbidden:** live R1/bandit/topology, Outcome-supported, ADR-006 Accepted, P0 sign-off, auto-promote, silent cross-family model fallback

## Protocol

Each round: fable audit → 10 concurrent landings (opus-fast + gpt-sol) → parent `pnpm gate` + benches → fable review → commit/push/PR. Subagents do **not** git commit. Saturation: if a module gains <2% for 2 consecutive rounds, move to I/O, races, protocol, or disaster recovery.

## Seed residuals (not yet on main)

Loop 3 draft (`agent/sota-opt-loop3-7e63`) claimed but has not landed: INSPECT_SUMMARY freeze; feedback append/rewrite lock; invocation lock-timeout retry; adaptation-plane import closure. Treat as open until present on this branch. Do not claim Loop 3 files if that PR lands first — rebase and retarget.

## Round 1 — in flight

Fable audit landed: `.agent_workspace/loop4-r1-fable.md` + `loop4-r1-tasks.md`. T1–T10 dispatched (6 opus-fast + 4 gpt-sol). Exclusive ownership in `OWNERSHIP.md`.

| Slot | Agent | Model |
|---|---|---|
| T1 | bc-1dd89357-b04d-5d7f-a849-37c2be55eb9f | opus-fast |
| T2 | bc-2a25b067-1389-58ae-a1e2-f9b0c8d0861f | opus-fast |
| T3 | bc-bd35c3f0-45e3-50e1-84f7-dc0f6072cedf | opus-fast |
| T4 | bc-39199fe8-0b42-51fa-a291-3dd6d602bfbc | opus-fast |
| T5 | bc-6637a686-1796-50e1-856a-3919d246be91 | opus-fast |
| T6 | bc-5a5390cc-42fe-5b80-99c2-f5d90bf5bf3d | opus-fast |
| T7 | bc-6dc4f05c-9629-5df2-96ef-7fe793150b2d | gpt-sol |
| T8 | bc-b9ea274b-2222-584d-a2c6-d2eb5a6a7432 | gpt-sol |
| T9 | bc-85399aab-2a9e-5502-b83e-cb2f61f8e765 | gpt-sol |
| T10 | bc-6d529890-48af-5198-b9c8-95366843ef2f | gpt-sol |

**Parent baseline (this VM, Node v22.14.0, engines want >=22.19.0):** `scripts/bench-runtime.mjs` → jsonlAppend 69.320ms/1000, jsonlRead 0.600ms/1000, lockSerial 195.377ms, lockContended 205.303ms. Perf landings must beat this by ≥5% or roll back. Fable re-measured jsonlAppend 68.264ms; T7 must record its own same-VM baseline before optimizing. Two host-dependent doctor test failures are T9's to hermeticize.

## Round 1 landings (parent gate GREEN after review)

**Parent verification (Node v22.14.0):** `pnpm gate` exit 0. Tests **1508 / 1507 pass / 0 fail / 1 skip**. Reviewer independently re-verified T7 (−31.5% / −28.6%) and crash-probe `ok: true`. 7 ACCEPT, 3 ACCEPT-WITH-NITS (T2/T8/T9), 0 ROLLBACK. Doctor host-Node baseline retired.

| Slot | Result |
|---|---|
| T1 | Feedback `records.jsonl.lock`; cascade fail-closed on corrupt log |
| T2 | `createInvocationSink` lock-timeout retry; flowchart `onInvocation` wired |
| T3 | Shared `writeFileAtomic` unique temps; checkpoint+pause torn-write closed |
| T4 | `validateEpisodeEvent`; settle under `episodes/<id>.lock` |
| T5 | Pre-aborted execute short-circuit; no provider call after cancel |
| T6 | Durable cancel set; `maxWallTimeMs` enforced |
| T7 | jsonlAppend −36%, fsync −34% (same-VM bench); signatures frozen |
| T8 | Seeded protocol fuzz; `assertAtMostOneTerminal` no TypeError escape |
| T9 | Doctor `nodeVersion` inject; adaptation-plane transitive value-import closure |
| T10 | SIGKILL crash probe: jsonl tail, checkpoint old-then-next, no-steal lock |

Saturated after Round 1: `persist/jsonl`, `protocol/v1` parse.

## Round 2 landings (parent gate GREEN)

**Parent verification (Node v22.14.0):** `pnpm gate` exit 0. Tests **1550 / 1548 pass / 0 fail / 2 skip**. Fable: 8 ACCEPT, 2 ACCEPT-WITH-NITS (R2-4, R2-10), 0 ROLLBACK. Lock perf independently re-verified (−14.4% / −12.0%). Crash-probe 6×3 `ok: true`.

| Slot | Result |
|---|---|
| R2-1 | Flowchart `RunAbortScope` fires abort into executors and children |
| R2-2 | Typed `LOCK_TIMEOUT`; lock serial/contended ~−12.5% |
| R2-3 | `delete --episode` acquires episode lock before unlink |
| R2-4 | `appendFeedbackWithRetry`; auto-adapt warns on lock drop, does not fail |
| R2-5 | Incremental terminal check; `maxCostUsd` disclosed unenforced |
| R2-6 | Crash probe: cascade, settle-lock, `writeFileAtomic` |
| R2-7 | Persistence-row fuzzer; invocation TypeError documented unowned |
| R2-8 | Sender-only role-cast requeues dead-lettered after bound |
| R2-9 | Dropped dead `expired()`; kept `restore()` for resume |
| R2-10 | Dictionary: unique temps, lock inventory, wall vs cost honesty |

Saturated after Round 2: lock acquisition perf, mailbox starvation semantics.

## Round 3 — in flight

10 slots from `.agent_workspace/ROUND2-BRIEF.md`. Ownership in `OWNERSHIP.md`. `withExclusiveFileLock` re-frozen. P1: invocation decoder TypeError (crashes `run`/`resume` via `isInvocation`).

---

# Loop 2 — SOTA follow-on (2026-08-24)

- **Branch:** `agent/sota-opt-next-7e63`
- **Parent:** Cursor Grok 4.6 orchestrator
- **Base:** `main` @ `b371e12` (PR #3 merged)
- **Previous loop:** archived below; reports in `docs/reports/2026-08-24-sota-r3-*.md`

## Remaining gaps this loop will close (from R3 P1/P2)

1. `inspect --json` does not surface aggregated `requiredEvidence` from `STALL_DETECTED` / `RUN_BLOCKED` (only raw events).
2. Invocation append (`src/cli/main.ts` `appendFile` to `invocations.jsonl`) is unlocked vs delete rewrite lock — delete-vs-live-appender race.
3. Plane-boundary allowlist comment claims type-only `eval-routing → model-router` loads nothing supervisor-side; value chain via `routing/assign.ts` does.
4. Plain `--children` starts `skipContract: true` — document honestly (do not silently invent a contract).
5. Tests/probes for the above; no Outcome-supported; no live R1.

## Loop 2 Round 1 ownership

| Slot | Owns |
|---|---|
| fable-1 | `.agent_workspace/loop2-r1-fable1.md`, `docs/reports/2026-08-24-sota-loop2-architecture.md`, `README.md` skipContract/inspect honesty, `docs/status-matrix.md` |
| fable-2 | `.agent_workspace/loop2-r1-fable2.md`, `docs/reports/2026-08-24-sota-loop2-isolation.md`, `docs/data-dictionary.md` |
| opus-1 | `src/run/inspection.ts`, `test/unit/run/inspection.test.ts`, `src/cli/main.ts` **only** `inspectCommand` (additive `requiredEvidence` on inspect; do not change event NDJSON into a breaking single object — last-line `INSPECT_SUMMARY` or `--json` summary object documented in tests) |
| opus-2 | NEW `src/telemetry/invocation-log.ts` (locked append+path helper), `src/privacy/deletion.ts` (use the helper’s lock), `src/cli/main.ts` **only** the `onInvocation` append (replace unlocked `appendFile`), tests under `test/unit/telemetry/` and deletion tests |
| gpt-sol-1 | `test/unit/privacy/plane-boundary.test.ts` (fix overbroad comment; add transitive value-import assertion for eval-routing→assign→model-router; no FS leak still allowed) |
| gpt-sol-2 | NEW tests: skipContract honesty (`test/unit/run/` or CLI children), inspect summary if landed; `.agent_workspace/loop2-r1-gptsol2.md`; `scripts/` probe for locked invocation append if helper exists |

**Forbidden:** live R1/bandit/topology, Outcome-supported, ADR-006 Accepted, P0 sign-off, auto-promote, `package.json` deps bump.

Subagents do not git commit. Parent commits after each round.

## Loop 2 Round 1 结论简报

**Parent verification (2026-08-24, Node v22.22.2):** `pnpm typecheck` / `lint` / `test` / `build` green. Tests **1434 pass / 0 fail / 1 skip** (loop 1 close on main: 1408). Security probe **14/14**.

| Slot | Landed |
|---|---|
| fable-1 | Loop2 architecture report; README skipContract + inspect `--summary-json`; matrix rows |
| fable-2 | Isolation report; dictionary lock/boundary honesty |
| opus-1 | `RunInspection.requiredEvidence`; prose inspect; `--summary-json` (`INSPECT_SUMMARY`); `--json` event stream unchanged |
| opus-2 | `src/telemetry/invocation-log.ts` locked append; delete rewrite shares lock; CLI onInvocation uses it |
| gpt-sol-1 | Plane-boundary comment + transitive eval-routing→assign→model-router + no-fs pin |
| gpt-sol-2 | `--children` skipContract vs `--track` contract honesty test |

This user request asked for **one** optimization round (6 concurrent agents). Loop 2 Round 1 closes the four carried P1/P2 items that are code-closable. Policy gates (P0, F-PROD, ADR-006, Outcome-supported) stay open.

_Pending._


---

# Loop 1 archive — pi-sparkle SOTA persistent optimization — orchestrator log

- **Branch:** `agent/sota-persistent-opt-7e63`
- **SOP alias:** `agent/sota-persistent-opt`
- **Started:** 2026-08-24
- **Parent:** Cursor Grok 4.6 orchestrator (3-round × 6-agent loop)
- **Goal:** Polish every plane of pi-sparkle to SOTA quality without claiming Outcome-supported, F-PROD, or live R1/bandit/topology. Never auto-promote. Keep ADR-004/005/006 honesty.


## Loop protocol

Each round dispatches **6 concurrent subagents** with exclusive file ownership:

| Slot | Model slug | Role |
|---|---|---|
| fable-1 | `claude-fable-5-thinking-xhigh` | Global architecture / SOTA audit |
| fable-2 | `claude-fable-5-thinking-xhigh` | Isolation, privacy-claim, ADR honesty review |
| opus-1 | `claude-opus-5-thinking-high-fast` | Core implementation A |
| opus-2 | `claude-opus-5-thinking-high-fast` | Core implementation B |
| gpt-sol-1 | `gpt-5.6-sol-xhigh-fast` | Benchmarks / persist stress |
| gpt-sol-2 | `gpt-5.6-sol-xhigh-fast` | Boundary probes / package hygiene |

Subagents **do not git commit**. Parent commits, pushes, and updates the PR after each round.

## Known baseline (main @ `4a59949`)

Evidence from `docs/reports/2026-08-22-weak-areas-data-collection.md` and `docs/status-matrix.md`:

1. `redactPII` labels only — email/IP/phone/card/path/secret *values* survive (`src/feedback/redaction.ts`).
2. No 429 Retry-After / backoff at the Pi executor (`src/pi-adapter/`).
3. Error invocations can record `tokensIn: 0` despite “unavailable is undefined, never zero”.
4. Doctor output is prose-only — no frozen `--json` contract.
5. Legacy flat state-root paths are invisible (fail-closed) with no migrate command or doctor warning.
6. Published build inherits `sourceMap`/`declarationMap` from root tsconfig (pack bloat).
7. Retention unbounded; doctor Node engine is `>=22.19.0` while some environments run 22.14.0.
8. Real-provider coverage of `--children` / `--track` still thin. Checkpoint F-PROD stays open.

## Round 1 — initial build & baseline (in flight)

Exclusive ownership (do not touch another slot’s files):

| Slot | Owns |
|---|---|
| fable-1 | `.agent_workspace/round1-fable1.md`, `docs/reports/2026-08-24-sota-architecture-audit.md`; may honesty-patch `docs/status-matrix.md`, `CONTRIBUTING.md` |
| fable-2 | `.agent_workspace/round1-fable2.md`, `docs/reports/2026-08-24-sota-isolation-privacy.md`; may honesty-patch `docs/data-dictionary.md`, `docs/decisions/*.md` |
| opus-1 | `src/feedback/redaction.ts`, `test/unit/feedback/**`, `test/unit/privacy/redaction.test.ts`, `test/integration/m3/redaction.test.ts`, `src/cli/doctor.ts`, `src/cli/doctor-overlay.ts`, `test/unit/cli/doctor*.ts` |
| opus-2 | `src/pi-adapter/**`, `test/unit/pi-adapter/**`, `test/integration/pi-adapter/**`, `src/telemetry/**`, `test/unit/telemetry/**`, new `src/cli/migrate-legacy.ts` + its tests; **minimal** `src/cli/main.ts` switch/USAGE for `migrate-legacy` only |
| gpt-sol-1 | `scripts/bench-runtime.mjs`, `test/unit/persist/**`, `src/persist/**` (bugfix only), `.agent_workspace/round1-gptsol1.md` |
| gpt-sol-2 | `tsconfig.build.json` (strip maps), `scripts/security-probe.mjs`, `test/unit/domain/**` extra edges, `test/unit/graph/**` extra edges, `.agent_workspace/round1-gptsol2.md` |

**Forbidden to all Round 1 agents:** `README.md`, `package.json`, `pnpm-lock.yaml`, `.github/**`, live R1/bandit/topology on the execution path, Outcome-supported claims.

## Round 1 结论简报

**Parent verification (2026-08-24, Node v22.22.2):** `pnpm typecheck` / `lint` / `test` / `build` green. Tests **1282 pass / 0 fail / 1 skip**. `dist/` map files **0**. `security-probe` **14 passed, 0 open**. Bench `scripts/bench-runtime.mjs` ok (jsonlAppend ~85ms/1000, lock contended ~245ms).

### 已实现功能

| Slot | Model | Landed |
|---|---|---|
| fable-1 | `claude-fable-5-thinking-xhigh` | Architecture audit; `--children` is flowchart (matrix honesty); coverage-gate wiring precision; isolation-enforcement precision; CONTRIBUTING `preferences/` + `pnpm gate` |
| fable-2 | `claude-fable-5-thinking-xhigh` | Isolation/privacy audit; ADR-004 follow-up contradiction fixed; ADR-005 enforcement note; dictionary delete-cascade holes disclosed |
| opus-1 | `claude-opus-5-thinking-high-fast` | Real PII/secret/path redaction + ReDoS hardening; `doctor --json` frozen contract; informational `legacy-layout` check |
| opus-2 | `claude-opus-5-thinking-high-fast` | 429/5xx retry with Retry-After/`remedy_hint`; usage `undefined` on failed calls; `costEligibleInvocations`; `migrate-legacy` dry-run/`--apply` |
| gpt-sol-1 | `gpt-5.6-sol-xhigh-fast` | JSONL+lock benches; lock fd leak on metadata write; exclusive-lock tests; stale locks remain timeout-only (PID-reuse conservative) |
| gpt-sol-2 | `gpt-5.6-sol-xhigh-fast` | Build maps stripped; security-probe expanded (Bearer/PEM/UNC); domain/graph edge tests |

Parent post-collect honesty: USAGE lists `doctor --json`; status-matrix doctor row records the frozen JSON contract; fake-executor row mentions `migrate-legacy`.

### 遗留缺陷

1. `live-isolation.test.ts` is source-text over ten files — cannot see transitive `bandit.ts` (post-run write) or `topology.ts` (parked import).
2. Episode-delete cascade strips `body` not `summary`; `delete --run` does not rewrite global `invocations.jsonl`; episode `.lock` survives.
3. `calibrateCatalogFromState` still averages failed calls into per-token cost (helper exists, not wired).
4. README / `m0-m2-architecture.md` still say `--children` is not the flowchart engine; seven CLI commands missing from README table.
5. `pnpm test -- <dir>` throws `ERR_UNSUPPORTED_DIR_IMPORT` (tsx + package script).
6. Orphan barrel `src/supervisor/flowchart.ts` (zero importers).
7. `redacted: true` means “pass ran”, not “content removed”; decision classes not persisted.
8. Prompt-injection class still unused (deliberate; false-positive risk).
9. Node engines `>=22.19.0` vs some hosts on 22.14.0 (doctor fails closed — correct).

### 性能瓶颈

- JSONL append ~0.08ms/line locally; lock serial ~0.25ms/acquire. Not a CI gate.
- Redaction ReDoS closed (~5ms at 32K vs seconds before). Size cap still after scan-of-redacted text (good).
- Retry sleeps up to 8s backoff, refuses Retry-After > 30s (by design).
- No stale-lock steal (PID reuse). Abandoned lock = timeout + manual cleanup.

### 下轮攻坚重点 (Round 2)

1. Transitive live-isolation test + plane-boundary prefix gap (`supervisor/`, `cli/`).
2. Privacy cascade: strip `summary`, filter-rewrite invocations on `delete --run`, drop episode lock; align `record-classes`.
3. Wire `costEligibleInvocations` into cost-calibration.
4. README + architecture spec honesty; `adapt promote` USAGE form; doctor/migrate in command table.
5. Test-runner directory glob; `bandit-store` units; evidence-invariant + checkpoint crash tests.
6. Delete or justify orphan `flowchart.ts` barrel; fix `r0.ts` “not imported live” header.

## Round 2 结论简报

**Parent verification (2026-08-24, Node v22.22.2):** `pnpm typecheck` / `lint` / `test` / `build` green. Tests **1314 pass / 0 fail / 1 skip** (was 1282). Directory form `pnpm test -- test/unit/persist` works (13/13). Security probe **14/14**.

### 演进对比 (Round 1 → Round 2)

| Area | Round 1 | Round 2 |
|---|---|---|
| Isolation test | 10-file source grep | Transitive closure from 4 live entries; pinned allowlist (bandit writer, parked topology) |
| Plane-boundary | Missing supervisor/cli prefixes | Prefixes added; type-only `eval-routing` allowlisted |
| Delete cascade | body-only; invocations leak; episode lock survives | Strips body+summary; filter-rewrites invocations.jsonl; invalidates catalog-observed; removes .lock |
| Cost calibration | Helper unwired | `isCostEligible` gated; unattributed/not-ok excluded |
| Docs | Matrix honesty | README `--children` truth; 22-row command table; doctor --json / migrate-legacy |
| Tests | persist lock + redaction | bandit-store units; evidence-invariant; checkpoint crash windows |
| Runner | `tsx --test` dir-import bug | `scripts/run-tests.mjs` expands directories |
| USAGE | `adapt promote` bare | Parent: full required flags |

`src/supervisor/flowchart.ts` is **not** an orphan — `flowchart-supervisor.ts` imports `./flowchart.js`. Do not delete.

### 潜在边界风险

1. Episode objective text can still survive in attached runs' `events.jsonl` (`EPISODE_OPENED` copy) after `delete --episode`.
2. No preference cascade on episode delete.
3. `redacted: true` still means “pass ran”; decision classes not persisted on `FeedbackRecord`.
4. `SPARKLE_AUTO_ADAPT=0` still writes `bandit.json` before the kill-switch return (collects *and* updates the learner).
5. Closure walker is regex-based (fails closed on comment false-positives; misses computed dynamic imports — none in src/).
6. Delete-vs-live-appender race on shared `invocations.jsonl` (documented).
7. Unbounded retention of invocations/episodes.

### SOTA 验收差距 (Round 3)

1. Persist optional `redactionClasses` (or split scanned/transformed) so on-disk records are honest.
2. Kill-switch: skip `updateProjectBandit` when `SPARKLE_AUTO_ADAPT=0` (collect-only).
3. Episode-delete: scrub or disclose remaining run-log copies; preference cascade or explicit non-goal.
4. README `adapt promote` row + delete-cascade “summary too”; CONTRIBUTING test-runner.
5. `auth-session` / `cluster-tools` direct units; retention probe.
6. Final cross-audit: no Outcome-supported, no live R1, ADR-006 Proposed, P0 sign-off open.

## Round 3 结论简报

**Parent verification (2026-08-24, Node v22.22.2):** `pnpm typecheck` / `lint` / `test` / `build` green. Tests **1363 pass / 0 fail / 1 skip** (R2: 1314). Security probe **14/14**. Retention probe `{ ok: true, unbounded: true, files: 33, bytes: 25856 }`. Directory tests 13/13.

### 最终冲刺落地

| Slot | Model | Landed |
|---|---|---|
| fable-1 | `claude-fable-5-thinking-xhigh` | SOTA acceptance report; README `adapt promote` + delete honesty; CONTRIBUTING test runner; matrix rows for cascade/calibration/retention |
| fable-2 | `claude-fable-5-thinking-xhigh` | Isolation certification; dictionary residual-text + kill-switch + redactionClasses tri-state; ADR-006 stays Proposed |
| opus-1 | `claude-opus-5-thinking-high-fast` | Persist `redactionClasses` (fail-closed unknown; old rows valid); auth-session units + lazy readline hardening |
| opus-2 | `claude-opus-5-thinking-high-fast` | Kill-switch collect-only (no bandit write); episode-delete residual run listing (no event-log rewrite); preference cascade explicit non-goal |
| gpt-sol-1 | `gpt-5.6-sol-xhigh-fast` | cluster-tools units; `scripts/retention-probe.mjs` |
| gpt-sol-2 | `gpt-5.6-sol-xhigh-fast` | Help/USAGE promote flags assertion; evidence-invariant comment |

Parent ratifies the one-line `src/cli/main.ts` residual-text print (required by `DeletionResult`). Round 2 residual items 1–4 and 3.1–3.5 above are closed or explicitly disclosed.

### SOTA 收敛（developer preview 标准）

Accepted for preview: fail-closed persistence, transitive live-isolation, documentation-exact privacy deletes, honest telemetry/calibration, proposal-first adaptation, dispatcher-matching docs. **Not** Outcome-supported. **Not** F-PROD. Live R1/bandit/topology stay off the execution path.

### 仍为策略/人工门（不在本 loop 关闭）

- P0 privacy independent-reviewer sign-off
- Checkpoint F-PROD / sealed holdout
- ADR-006 Proposed (no Pi extension import)
- Unbounded retention (Q3 accepted; probe only)
- Plane-boundary comment vs value-import of model-router through eval-routing (no FS leak)
- Real-provider `--children`/`--track` coverage still smoke-only

## Post-loop merge with `origin/main` (2026-08-24)

`main` moved from `4a59949` to `2155743` (Pi 0.84.3 pin, `pi-compat` CLI, `run --thinking`, doctor `pi-packages`/`pi-compat` checks). This branch absorbed that work with conflict resolution:

- Keep directory-expanding `scripts/run-tests.mjs` **and** `pi-compat` / `pi:latest` / `pi:probe` scripts
- Doctor JSON contract + `legacy-layout` **and** `pi-packages` / `pi-compat` checks
- `--thinking` on `run` **and** `migrate-legacy` / residual-delete disclosure
- Adapter exports both `SparkleThinkingLevel` and retry types

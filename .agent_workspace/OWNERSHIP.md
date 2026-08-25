# File ownership — Preview merge + 内测 (`cursor/merge-preview-release-8011`)

Parent campaign: merge remaining unique branches and unblock developer-preview `pnpm prerelease`. Subagents never git commit. **Stay on `cursor/merge-preview-release-8011`. Do not `git checkout` another branch.**

Injection: `.agent_workspace/ROUND1-PREVIEW-BRIEF.md`.

| Slot | Model | Owns |
|---|---|---|
| R1-fable-A | fable | `docs/reports/2026-08-25-branch-merge-disposition.md`; `.agent_workspace/r1-fable-a.md` |
| R1-fable-B | fable | `docs/reports/2026-08-25-preview-release-gap.md`; `.agent_workspace/r1-fable-b.md` |
| R1-opus-A | opus-fast | `src/feedback/redaction.ts`; `test/unit/feedback/redaction.test.ts`; `test/unit/privacy/redaction.test.ts`; `.agent_workspace/r1-opus-a.md` |
| R1-opus-B | opus-fast | `docs/specs/release-gate.md`; `docs/reports/2026-08-20-developer-preview-readiness.md`; optional `test/unit/feedback/release-gate-policy.test.ts`; `.agent_workspace/r1-opus-b.md` |
| R1-gpt-A | gpt-sol | `scripts/security-probe.mjs` (only if probe is the bug); `.agent_workspace/r1-gpt-a.md` |
| R1-gpt-B | gpt-sol | `scripts/preview-release-probe.mjs` (new); `.agent_workspace/r1-gpt-b.md` |

Do not touch `src/cli/main.ts` / `src/run/flowchart-run.ts` / `src/pi-adapter/runtime.ts` in Round 1 (already ingested from PR #11). Do not wholesale-merge PR #9.

# File ownership — Loop 4 Round 23 (`cursor/opt-r22-42b1`)

Round 22 CLOSED (3 ACCEPT). Round 23 is a recorded **zero-slot** round — `.agent_workspace/ROUND23-BRIEF.md` §4 has no candidates. Do not pad. Do not dispatch landings until a brief §4 reason exists (new seam / reproduced gap / gate-or-probe red / stale surface).

Parent owns `.agent_workspace/PROGRESS.md`. Subagents never git commit. **Stay on branch `cursor/opt-r22-42b1`. Do not `git checkout` another branch.**

# File ownership — Loop 4 Round 22 (closed)

Three real candidates from `.agent_workspace/ROUND22-BRIEF.md`. **Do not pad.** Files are disjoint. **Land in order: R22-1 → R22-2 → R22-3.** Landing commits are slot files + report only — no PROGRESS ticks.

Parent owns `.agent_workspace/PROGRESS.md`. Subagents never git commit. **Stay on branch `cursor/opt-r22-42b1`. Do not `git checkout` another branch.**

**Mutations run out-of-tree:** full copy under `/tmp` with `node_modules` symlinked, then deleted.

Injection: `.agent_workspace/ROUND22-BRIEF.md`, `.agent_workspace/loop4-r22-audit.md`.

| Slot | Model | Owns |
|---|---|---|
| R22-1 | opus | `docs/kernel-reuse.md`; `.agents/skills/pi-sparkle/references/kernel-reuse.md`. Truth-up only. Freeze lift is this slot. |
| R22-2 | opus | `src/run/flowchart-run.ts`; new `test/integration/m2.5/flowchart-run-cap.test.ts`; `docs/specs/m0-m2-architecture.md`; `docs/data-dictionary.md` (conditional). `FlowchartRunInput.maxCostUsd` → ChildCoordinator. No `FlowchartRunLimits.maxCostUsd`. |
| R22-3 | opus | `src/cli/main.ts`; `src/pi-adapter/runtime.ts`; `test/integration/m1/cli-children.test.ts`; new `test/unit/cli/cost-flag.test.ts`; new `test/integration/cli/run-cost-cap.test.ts`; new `test/integration/pi-adapter/costgate-cli-warning.test.ts`; `docs/status-matrix.md`. Lands after R22-2. |

**Parent sign-off**
- **R22-1 YES** — lift `docs/kernel-reuse.md` freeze for truth-up only.
- **R22-2 YES** — flowchart plane carries run-level cap to `ChildCoordinator`.
- **R22-3 YES** — CLI `--max-cost-usd` + `onCostGate` stderr. Loud refuse on `--flowchart`/`--track`. No steer CLI verb.

Frozen: ROUND22-BRIEF §3/§5. No live R1 / Outcome-supported / ADR-006 Accepted / auto-promote / `package.json`. `remainingCostUsd` stays a separate plane.

Every slot: census first; verify paths exist; scoped eslint + whole-tree `tsc --noEmit`; report `.agent_workspace/loop4-r22-tN.md`. No full gate.

# File ownership — Loop 4 Round 21 (closed, zero-slot)

Round 20 CLOSED (2 ACCEPT). Round 21 is a recorded **zero-slot** round — `.agent_workspace/ROUND21-BRIEF.md` §4 has no candidates. Do not pad. Do not dispatch landings until a brief §4 reason exists (new seam / reproduced gap / gate-or-probe red / stale surface).

Parent owns `.agent_workspace/PROGRESS.md`. Subagents never git commit. **Stay on branch `cursor/opt-r18-postmerge-42b1`. Do not `git checkout` another branch.**

# File ownership — Loop 4 Round 20 (closed)

Two real candidates from `.agent_workspace/ROUND20-BRIEF.md`. **Do not pad.** Files are disjoint. Landing commits are slot files + report only — no PROGRESS ticks.

Parent owns `.agent_workspace/PROGRESS.md`. Subagents never git commit. **Stay on branch `cursor/opt-r18-postmerge-42b1`. Do not `git checkout` another branch.**

**Mutations run out-of-tree:** full copy under `/tmp` with `node_modules` symlinked, then deleted.

Injection: `.agent_workspace/ROUND20-BRIEF.md`, `.agent_workspace/loop4-r20-audit.md`.

| Slot | Model | Owns |
|---|---|---|
| R20-1 | opus | `src/run/flowchart-run.ts` (`fallbackChildLimits` + accept-time ceiling recorder + restore onto substituted specs); `src/run/replay.ts` (new optional ceiling field validation **only** — do **not** rewrite `:95-101`); `test/integration/m2.5/resume.test.ts`; `docs/specs/m0-m2-architecture.md:368-377`. **Direction (b):** durable per-task `maxCostUsd` (ceiling only). Sibling arm must not copy `maxCostUsd`. Existing sibling-budget pin stays green. Tests 3×. |
| R20-2 | opus | `src/execution/contract.ts` (`steerText` signature only); `src/pi-adapter/pi-executor.ts` (`steerText` region); `src/run/coordinator.ts` (the two `SteerChannel` call sites only); new `test/integration/pi-adapter/steer-target.test.ts`; `test/unit/pi-adapter/steer-inflight.test.ts`. **Optional target:** `startRun` passes root instance; `startParentRun` passes none. 12 existing steer pins stay green. Tests 3×. Census `src/testing/fake-executor.ts` only if the signature forces it. |

**Parent sign-off**
- **R20-1 YES — (b) restore** declared ceilings across pause/resume. Disappearance is not accepted.
- **R20-2 YES — optional `agentInstanceId` target.** No new event type. Do not broadcast.

Frozen: ROUND20-BRIEF §3/§5. R18-1 replay placement/latch untouched. No live R1 / Outcome-supported / ADR-006 Accepted / auto-promote / `package.json`. Adaptation-plane import edges: none expected; if a slot changes one, census **both** privacy guards.

Every slot: census first; verify paths exist; scoped eslint + whole-tree `tsc --noEmit`; report `.agent_workspace/loop4-r20-tN.md`. No full gate.

# File ownership — Loop 4 Round 19 (closed, zero-slot)

Round 18 CLOSED (2 ACCEPT). Round 19 is a recorded **zero-slot** round — `.agent_workspace/ROUND19-BRIEF.md` §4 has no candidates. Do not pad. Do not dispatch landings until a brief §4 reason exists (new seam / reproduced gap / gate-or-probe red / stale surface).

Parent owns `.agent_workspace/PROGRESS.md`. Subagents never git commit. **Stay on branch `cursor/opt-r18-postmerge-42b1`. Do not `git checkout` another branch.**

# File ownership — Loop 4 Round 18 (closed)

Parent owns `.agent_workspace/PROGRESS.md`. Subagents never git commit. **Stay on branch `cursor/opt-r18-postmerge-42b1`. Do not `git checkout` another branch.**

Two real candidates from `.agent_workspace/ROUND18-BRIEF.md`. **Do not pad.** Files are disjoint. Landing commits are slot files + report only — no PROGRESS ticks.

**Mutations run out-of-tree:** full copy under `/tmp` with `node_modules` symlinked, then deleted.

Injection: `.agent_workspace/ROUND18-BRIEF.md`, `.agent_workspace/loop4-r18-audit.md`.

| Slot | Model | Owns |
|---|---|---|
| R18-1 | opus | `src/pi-adapter/pi-executor.ts`; new `test/integration/pi-adapter/steer-retry.test.ts`; `test/unit/pi-adapter/steer-inflight.test.ts` only if adding executor-level steer state needs a unit pin. **Direction (a):** keep accepted steer texts for the current `execute()` and re-deliver into each fresh retry kernel (poll after the new attempt's first turn). Do **not** add a new event type or edit `coordinator.ts`/`events.ts`. Existing 10 steer pins stay green. Tests 3×. |
| R18-2 | opus | `src/cli/main.ts` **`parseChildSpec` region only** (do not edit `runCommand`, routes, `INSPECT_SUMMARY`, `onRunStarted`, pref lock); `test/integration/m1/cli-children.test.ts`; `docs/specs/m0-m2-architecture.md` (stale lines ~359–360 only). Copy a positive finite `maxCostUsd`; refuse any other non-undefined value with `DomainValidationError` naming the task. Fake-children executor ignoring the cap stays the pinned contract. |

**Parent sign-off**
- **R18-1 YES — (a) re-deliver** accepted steers into each retry kernel. `STEER_INJECTED` must stay true after a 429/5xx retry.
- **R18-2:** no extra sign-off.

Frozen: ROUND18-BRIEF §3/§5. Do not revert kernel-reuse. Live-through-tool-start as shipped. Thinking bytes-only. Adaptation closure exactly 4 modules — this round's slots must not change adaptation-plane `src` import edges. Five routes character-exact. No live R1 / Outcome-supported / ADR-006 Accepted / auto-promote / `package.json`.

Every slot: census first; verify paths exist; scoped eslint + whole-tree `tsc --noEmit`; report `.agent_workspace/loop4-r18-tN.md`. No full gate.

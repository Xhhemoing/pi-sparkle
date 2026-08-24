# File ownership — Loop 4 Round 6 (`agent/opt-continuous`)

Parent owns `.agent_workspace/PROGRESS.md`. Subagents never git commit. **Stay on branch `agent/opt-continuous`. Do not `git checkout` another branch.**

Lists are binding. Sole owners this round: `flowchart-run.ts` = R6-1; `main.ts` = R6-5; `supervisor.ts` + `track/loop.ts` = R6-3; `doctor.ts` = R6-4.

Injection brief: `.agent_workspace/ROUND5-BRIEF.md`. Review: `.agent_workspace/loop4-r5-review.md`.

| Slot | Model | Owns |
|---|---|---|
| R6-1 | opus | `src/run/flowchart-run.ts` (sole), `src/run/replay.ts`, `test/unit/run/replay.test.ts`, new/additive gate-outcome tests under `test/unit/run/` or `test/unit/tracking/`. Do **not** change `gate-apply.ts` semantics. |
| R6-2 | opus | Additive `test/integration/m2.5/resume.test.ts`, additive `test/unit/run/flowchart-run-abort.test.ts`, the report. **No `src/**`.** Do not move `childTasksFromDefinition`. |
| R6-3 | opus | `src/track/loop.ts`, `src/run/supervisor.ts` (sole), `test/unit/track/`, `test/integration/m2/` (supervisor-crash + refused-start pin). Census `test/integration/m3/` if track tests live there. |
| R6-4 | gpt-sol | `src/cli/doctor.ts` (sole), `test/unit/cli/doctor.test.ts`. Do **not** edit `file-lock.ts` or `main.ts`. |
| R6-5 | opus | `src/cli/main.ts` (sole), `src/cli/errors.ts`, additive `test/integration/cli/command-error-doctor.test.ts`, `test/integration/cli/delete.test.ts`. Keep sink-wiring + resume-disclosure pins green. |
| R6-6 | gpt-sol | `test/integration/pi-adapter/`, `test/helpers/`. **No `src/**`.** Own stderr/request-count pin updates with disclosure. |
| R6-7 | gpt-sol | `docs/**` only. Timestamp-disclose in-flight R6-1/2/3; do not predict. |
| R6-8 | gpt-sol | `scripts/crash-probe.mjs` (sole), `test/helpers/` additions if needed. |
| R6-9 | gpt-sol | Census first; claim unowned `src/` files in the report before editing. Report-only for `supervisor.ts` (→ R6-3) and `flowchart-run.ts` (→ R6-1). Their unit tests. |
| R6-10 | gpt-sol | Additive `test/integration/cluster/undelivered-mail.test.ts`, additive `test/unit/cluster/mailbox.test.ts`. No shape/line-format change. |

**Parent sign-off**
- R6-1: option **(a)** — the loop respects the gate. `persistFailed` must refuse when the log already replays BLOCKED. A verification-failed clustered run ends BLOCKED with the analysis queued, resumable after an unblock. Keep exactly-one-terminal coherent. Do not take (b).

Frozen: jsonl; `writeFileAtomic`(+Sync); no new private tmp+rename; `withRunLifecycleLock` rules; `crash-terminal.ts` guards; append/checkpoint unlocked; `applyRetry`; ClusterMailReport + line; resume disclosures; `BANDIT_STATE_UNREADABLE`; commandFailureNext routes; no live R1 / Outcome-supported / ADR-006 Accepted / auto-promote / `package.json`.

Every slot: census first; scoped eslint + whole-tree `tsc --noEmit`; 3× timing-sensitive tests; report `.agent_workspace/loop4-r6-tN.md`. No full gate. No scratch files at report time.

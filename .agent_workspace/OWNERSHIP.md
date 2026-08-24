# File ownership — Loop 4 Round 7 (`agent/opt-continuous`)

Parent owns `.agent_workspace/PROGRESS.md`. Subagents never git commit. **Stay on branch `agent/opt-continuous`. Do not `git checkout` another branch.**

Lists are binding. Sole owners this round: `flowchart-run.ts` = R7-1; `prescore.ts`+`from-child.ts` = R7-2; `coordinator.ts` = R7-4; `main.ts` = R7-5; `supervisor.ts` = R7-7; `doctor.ts`+`bandit-store.ts`+`preferences/store.ts` = R7-8; `graph/validate.ts` = R7-9.

Injection brief: `.agent_workspace/ROUND6-BRIEF.md`. Review: `.agent_workspace/loop4-r6-review.md`.

| Slot | Model | Owns |
|---|---|---|
| R7-1 | opus | `src/run/flowchart-run.ts` (sole), `test/integration/m2.5/resume.test.ts`, `test/unit/run/flowchart-run-abort.test.ts`. Reconstruct from log. Update R6-2 rebuilt-spec pin with disclosure. |
| R7-2 | opus | `src/tracking/prescore.ts`, `src/tracking/from-child.ts` (sole), `test/unit/tracking/`. Parent sign-off: option **(b)** this round — criteria are prompt-guidance; verifier is the sole gate. Do **not** take (a). |
| R7-3 | gpt-sol | Additive pins in `test/unit/run/replay.test.ts` only. **No `src/**`.** Design unblock for Round 8; pin absorbing BLOCKED. |
| R7-4 | opus | `src/run/coordinator.ts` (sole), additive `test/unit/run/`. Route parent crash through `recordCrashTerminal` / `replayedTerminalStatus`. |
| R7-5 | opus | `src/cli/main.ts` (sole), additive `test/integration/cli/`. BLOCKED `next:` block. Keep sink-wiring + resume-disclosure pins green. |
| R7-6 | gpt-sol | `docs/**` only. Timestamp-disclose in-flight R7-1/2/3; **do not touch any ADR status line.** |
| R7-7 | gpt-sol | `src/run/supervisor.ts` (sole), additive `test/integration/m2/` or `test/unit/run/`. Census-and-delete `trackingAssessment` with an absence pin. |
| R7-8 | opus | `src/cli/doctor.ts`, `src/learning/bandit-store.ts`, `src/preferences/store.ts`, `test/unit/cli/doctor.test.ts`, the isolation pin in `test/unit/routing/live-isolation.test.ts`. Parent sign-off: amend the pin; doctor stays diagnostic not a selector. JSON contract byte-identical. |
| R7-9 | gpt-sol | `src/graph/validate.ts` (sole), `test/unit/graph/`, the one pin swap in `test/integration/m2/supervisor-crash.test.ts` if tightening. |
| R7-10 | gpt-sol | Additive `test/integration/cli/command-error-doctor.test.ts`. **No `src/**`.** Real-command producers for bandit and catalog routes. |

**Parent sign-off**
- R7-2: option **(b)** — record in-source that acceptance criteria are prompt-guidance and the deterministic verifier is the sole gate. Do not make check-coverage real until R7-1's reconstruction has landed (Round 8). Update R6-2's FAIL-unreachable tripwire only if the documented contract changes; do not delete it.
- R7-8: yes — export a keyed bandit read and a pure preference reader; doctor consumes both; isolation pin's `assert.match` moves with the new symbol in the same diff, `because` remains "read-only inventory, never a selector".
- R7-3: no new persisted schema this round. Investigation + current-behavior pins + Round 8 design only.

Frozen: one-definition-of-terminal; locked clarification lifecycle; `learnedState` field names; five `DOCTOR_ROUTED_NEXT` routes; `--lock-wait-ms` semantics; `process-death.ts`; R6-2 tripwires; R6-9 absence pins; jsonl; `writeFileAtomic`(+Sync); no new private tmp+rename; `withRunLifecycleLock` rules; `crash-terminal.ts` guards; append/checkpoint unlocked; `applyRetry`; ClusterMailReport + line; resume disclosures; `BANDIT_STATE_UNREADABLE`; no live R1 / Outcome-supported / ADR-006 Accepted / auto-promote / `package.json`.

Every slot: census first; scoped eslint + whole-tree `tsc --noEmit`; 3× timing-sensitive tests; report `.agent_workspace/loop4-r7-tN.md`. Census your consumers. Run `live-isolation.test.ts` if you add an import inside the live closure. No full gate. No scratch files at report time.

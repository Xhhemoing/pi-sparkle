# File ownership — Loop 4 Round 20 (`cursor/opt-r18-postmerge-42b1`)

Round 18 CLOSED (2 ACCEPT). Round 19 CLOSED (zero-slot). Round 20 is a saturation retarget: I/O, races, protocol, DR at HEAD. **Do not pad.** No landing slots until the audit writes proven candidates into `.agent_workspace/ROUND20-BRIEF.md`.

Parent owns `.agent_workspace/PROGRESS.md`. Subagents never git commit. **Stay on branch `cursor/opt-r18-postmerge-42b1`. Do not `git checkout` another branch.**

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

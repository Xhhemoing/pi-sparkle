# File ownership — Loop 4 Round 18 (`cursor/opt-r18-postmerge-42b1`)

Parent owns `.agent_workspace/PROGRESS.md`. Subagents never git commit. **Stay on branch `cursor/opt-r18-postmerge-42b1`. Do not `git checkout` another branch.**

Round 18 audits the **post-merge tree** (`main` @ `985250b` = Loop 4 + Loop 3 + kernel-reuse). That merge is a new seam. **Do not pad. Do not dispatch freeze extras.**

**Mutations run out-of-tree:** full copy under `/tmp` with `node_modules` symlinked, then deleted.

| Slot | Model | Owns |
|---|---|---|
| fable-audit | fable | `.agent_workspace/loop4-r18-audit.md`; rewrite `.agent_workspace/ROUND18-BRIEF.md` with proven candidates or confirmed zero |

Dispatch: fable-audit `bc-f8e930d3-5a33-5efa-a612-d648ed088f69`. PR https://github.com/Xhhemoing/pi-sparkle/pull/10

Frozen: ROUND17/18 briefs §3/§5 — CLI inferred-preference plane not live; migrate-legacy both publish arms pinned; five routes; `INSPECT_SUMMARY` four keys; exact eight `RunStatus`; EventStore/CheckpointStore unlocked; no live R1 / Outcome-supported / ADR-006 Accepted / auto-promote / `package.json` dep bumps. Adaptation-plane import-edge changes must include `test/unit/privacy/plane-boundary.test.ts` (and Loop 3 `adaptation-plane-closure.test.ts` if it still fails closed on stale allowances). Kernel-reuse landings (`steer`, thinking redaction, `maxCostUsd` forward) are **in** the tree — do not revert them; hunt holes around them.

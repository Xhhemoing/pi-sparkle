# File ownership — Loop 4 Round 18 (`agent/opt-continuous`)

Parent owns `.agent_workspace/PROGRESS.md`. Subagents never git commit. **Stay on branch `agent/opt-continuous`. Do not `git checkout` another branch.**

Round 18 is a **parent plane retarget** after the I/O / races / protocol / DR sweep returned zero remaining holes. The auditor owns `.agent_workspace/loop4-r18-audit.md` and rewrites `.agent_workspace/ROUND18-BRIEF.md` **only if** it proves real candidates on the new plane. **Do not pad. Do not dispatch freeze extras.**

**Mutations run out-of-tree:** full copy under `/tmp` with `node_modules` symlinked, then deleted.

New plane (exclusive of frozen surfaces): operator-disclosure, fail-closed honesty, embedder-contract, silent persistence no-ops, security-probe coverage.

| Slot | Model | Owns |
|---|---|---|
| fable-audit | fable | `.agent_workspace/loop4-r18-audit.md`; `.agent_workspace/ROUND18-BRIEF.md` (candidates or confirmed zero on this plane) |

Frozen: ROUND18-BRIEF §3/§5 as of `8eef663`, plus: CLI inferred-preference plane stays not-live; migrate-legacy both publish arms pinned; no 12th probe case; no live R1 / Outcome-supported / ADR-006 Accepted / auto-promote / `package.json`. Adaptation-plane import-edge changes must census `test/unit/privacy/plane-boundary.test.ts` into the later landing grant.

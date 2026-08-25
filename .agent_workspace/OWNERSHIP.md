# File ownership — Loop 4 ending after Round 17 (`agent/opt-continuous`)

Parent owns `.agent_workspace/PROGRESS.md`. Subagents never git commit. **Stay on branch `agent/opt-continuous`. Do not `git checkout` another branch.**

Round 18 is cancelled on user request. Loop 4 ends with the Round 17 green gate; do not continue landings, dispatch freeze extras, or consume the in-flight fable audit.

There are no active mutation slots.

Frozen: exact eight `RunStatus` members; five `DOCTOR_ROUTED_NEXT` entries plus `GENERIC_FAILURE_NEXT`; the four-key `INSPECT_SUMMARY`; no live R1; ADR-006 Proposed; EventStore and CheckpointStore remain unlocked; preference locking stays at CLI writers; no 12th crash-probe case; no Outcome-supported or auto-promote claim.

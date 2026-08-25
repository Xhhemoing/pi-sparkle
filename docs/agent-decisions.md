# Agent decisions

Parent: Loop 5 on `cursor/pi-sparkle-sota-opt-0da8` (2026-08-25).

## D1 — This is a product/usability campaign, not Loop 4 Round 21

Loop 4 Round 21 opened with **zero honesty-hole candidates**. Repeating that audit is `NO_HIGH_VALUE_CHANGE_FOUND` by construction. Loop 5 optimizes **developer-preview usability and competitiveness**: missing operator verbs, honest docs, safer local workflows, coverage of modules Loop 4 did not productize.

Do not:

- Wire live R1 / bandit `selectArm` / `planTaskTopology` into the execution path (Checkpoint F-PROD still open).
- Register a Pi extension (ADR-006 stays Proposed).
- Claim Outcome-supported.
- Auto-promote adaptation candidates.
- Duplicate PR #12 (`--max-cost-usd`, `inspect --follow`, market-eval probe, governance files).
- Re-litigate frozen Loop 4 contracts (see D3).

## D2 — Round 1 feature bets (to be challenged, then landed)

Three operator verbs are missing on `main` and are independently useful:

1. **`list`** — enumerate runs (all statuses) and episodes from the state root. Today `inspect` / `resume` / `delete` / `pause` require the operator to already know the id. Doctor only lists PLANNING/RUNNING crash candidates; that filter stays.
2. **`validate`** — parse+validate `--children` / `--flowchart` JSON without creating a run or writing state. Reuse existing parsers/validators; do not invent a second schema language.
3. **`init`** — write example children and flowchart JSON into a directory (`--force` to overwrite). No state-root mutation, no run.

GPT-5.6-sol must independently challenge these bets. If a bet is wrong, record `NO_HIGH_VALUE_CHANGE_FOUND` for that slot and pick a better one — do not pad.

## D3 — Frozen contracts new code must not break

Carried from Loop 4 (non-exhaustive, still binding):

- Live R1/bandit/topology off the execution path; `selectArm` has no live caller.
- ADR-006 Proposed; no `package.json#pi.extensions`.
- `INSPECT_SUMMARY` four keys (`type`/`runId`/`status`/`requiredEvidence`) keep name, type, meaning.
- Doctor `--json` is frozen-additive; five doctor routes stay character-exact.
- Eight-member `RunStatus`.
- `independentEvidence` exactly one `void` discard.
- `taskCriteria` / `taskCostCeilings` as shipped (optional, never synthesized, first-write-wins).
- Targeted `steerText` as shipped; no second kernel registry; no broadcast.
- `EventStore.append` / `CheckpointStore.write` unlocked.
- Crash probe 11-case names and order.
- `package.json` stays `private: true`; no drive-by dependency edits.
- Adaptation-plane privacy guards on any adaptation import change.

New JSON contracts (`RUN_LIST`, validate stdout) start **frozen-additive** on day one: pin `type` and the documented keys; new keys later must update those pins.

## D4 — File ownership (Round 1 implementers)

To avoid overwrite:

| Slot | Owns | Must not touch |
|---|---|---|
| Opus-list | `src/run/inventory.ts`, `src/cli/list.ts`, `test/unit/cli/list.test.ts`, `test/unit/run/inventory.test.ts`; may add **one** `case "list"` + import + **one** USAGE line in `src/cli/main.ts` | `validate.ts`, `init-examples.ts`, doctor, inspection, replay |
| Opus-validate | `src/cli/validate.ts`, `test/unit/cli/validate.test.ts`; may add **one** `case "validate"` + import + **one** USAGE line in `src/cli/main.ts` | `list.ts`, `inventory.ts`, `init-examples.ts` |
| Opus-init | `src/cli/init-examples.ts`, example JSON under `examples/`, `test/unit/cli/init-examples.test.ts`; may add **one** `case "init"` + import + **one** USAGE line in `src/cli/main.ts` | list/validate implementation |

If two USAGE edits conflict, keep all three lines; do not drop siblings.

Fable-cli (Round 1): `validate` must not import `src/cli/main.ts` (dispatch cycle). Extract `parseChildSpec` into `src/cli/children-spec.ts` or `flowchart-io.ts`; `run` and `validate` both import that module. Do not leave two children decoders.

## D5 — Honesty of claims

`private: true`, developer preview, not npm-publishable, not Outcome-supported. New commands are preview operator tools. Do not describe them as production, adaptive-live, or held-out proven.

## D6 — `init` verb (open)

**KEEP the verb** (Round 1 synthesis). GPT-challenge preferred static `examples/` only. Fable-map and Fable-cli kept the verb because `package.json` `files[]` ships `dist` (plus skill/prompt trees) and forbids a drive-by `examples/` pack, so embedded constants only reach an installed binary through `init`. Repo `examples/` stays for checkout readers. Do not treat `init` as a project cookiecutter.

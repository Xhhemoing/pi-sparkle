# Native delegate routing — verification record (2026-09-20)

## Scope

`TASK-20260920-native-delegate-routing` first implementation slice on branch
`feat/native-delegate-routing` (base `2560200`). Plan:
[2026-09-20-native-delegate-routing](../superpowers/plans/2026-09-20-native-delegate-routing.md).

- `src/native/routing-catalog.ts` (new): `buildNativeRoutingCatalog` bridges the
  host Pi model registry onto the live `ModelRouterConfig` shape — preferred
  host model becomes the primary row (HIGH complexity, judge/router roles,
  high-risk approved), other eligible models become generalist rows
  (MEDIUM, actor/critic), `cheap`/`premium` alias rows mirror
  `buildLiveCatalogConfig`. Host pricing is not invented: unpriced rows get a
  flat 0.01 estimated floor exactly like the CLI's unpriced treatment.
  Refusals: empty eligible set, malformed refs, duplicate refs, no primary.
- `src/native/session.ts`: optional `NativeRoutingInput` (`catalog` +
  `learned`). When supplied, `delegate` assigns each task through the same
  `assignTasks` path the CLI uses (analyzeTask → learned policy via
  `applyLearnedRouting` semantics → R0-equivalent `ModelRouter`), passes the
  assignments into `startParentRun` so real per-task `MODEL_ROUTED` events
  land in the run log, stamps per-child `assignedModel`, and discloses
  `Routing: per-task over host catalog (N distinct model(s))` in the result
  text. Without the routing input, behavior is byte-identical to before (the
  single resolved model, no `MODEL_ROUTED` rows) — pinned by the untouched
  pre-existing tests.
- `extensions/pi-sparkle/index.ts`: when more than one host model is eligible,
  builds the catalog from `ctx.modelRegistry`'s eligible set and loads the
  learned policy from the same adaptation registry the CLI path uses
  (`loadLearnedRouting`, fail-soft). One eligible model ⇒ no routing input ⇒
  previous behavior.
- `test/unit/native/routing-catalog.test.ts` (new): bridge contract — row
  shapes, alias rows, mandatory versions, duplicate/malformed refs, missing
  primary, empty set.
- `test/unit/native/session.test.ts` (new case): per-task routing through the
  real `delegate` path — learned avoid/prefer honored, `MODEL_ROUTED` rows
  recorded per task, disclosure line present.

## Trust/policy boundary (summary)

- The static R0-equivalent policy stays authoritative on the live path. This
  slice widens routing *inputs* only; adaptive R1/bandit selection remains
  shadow/offline per Checkpoint F-PROD.
- `test/unit/routing/live-isolation.test.ts` passes **unchanged** (232 pass):
  no forbidden module entered the live closure — `routing/assign.ts` and
  `learning/learned-routing.ts` were already in it via `src/cli/main.ts`, and
  `src/native/*` is not a live entry point.
- The main conversation model is never touched; routing applies to delegated
  children only, per the owner's quality-first decision.

## Commands

| Command | Outcome |
|---|---|
| `pnpm test test/unit/native` | 27 pass / 0 fail (4 new routing tests) |
| `pnpm test test/unit/pi-adapter` | 145 pass / 0 fail / 1 skip |
| `pnpm test test/unit/routing` | 232 pass / 0 fail (live-isolation unchanged) |
| `pnpm test test/integration/native` | 15 pass / 0 fail |
| `pnpm test -- --test-concurrency=1` (full suite) | **2820 pass / 0 fail / 18 skip** |
| `pnpm typecheck` / `pnpm lint` / `pnpm build` | exit 0 ×3 |
| `pnpm security:probe` | PASS, 0 open / 0 waived |
| `pnpm pi:probe` | PASS 4/4 |

## Behavioral Evidence

- The learned-policy application inside `delegate` is literally
  `assignTasks` with the learned policy — the same function the CLI
  `smartChildPlan` path uses, so avoid/prefer/fallback semantics cannot drift
  between the CLI and native paths.
- Per-task `MODEL_ROUTED` events are recorded by the coordinator from the
  passed assignments (asserted in the new test), giving delegated runs the
  same durable routing evidence CLI runs have.
- Unpriced host models never receive invented per-token costs; the flat
  0.01 floor mirrors the CLI's unpriced treatment and keeps the router's
  cost tie-break deterministic.

## Handoff

- Remaining: independent review (luna-fast; still blocked on the relay
  outage recorded in `2026-09-20-luna-dispatch-outage.md`) — batch with the
  registration-slice re-dispatch.
- Open program follow-ups: live observation projection/recall, global-config
  allowlists, write-tool registration, F-PROD.

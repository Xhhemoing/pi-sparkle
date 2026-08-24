# Round 2 opus-1
MODEL_SLUG: claude-opus-5-thinking-high-fast

## Implemented

### Task 1 — `test/unit/routing/live-isolation.test.ts` rewritten as a transitive closure check

The old test read the source text of ten hand-listed files and grepped for
forbidden substrings, so any learned router could enter live execution through
an intermediate module without tripping it. The new test builds the real module
graph and judges reachability.

- **Closure walker.** `buildClosure` starts from four live entry points
  (`src/cli/main.ts`, `src/run/flowchart-run.ts`, `src/run/supervisor.ts`,
  `src/track/loop.ts`), extracts specifiers with one regex covering `from "…"`,
  `import("…")` and bare side-effect `import "…"`, resolves relative NodeNext
  specifiers (`./x.js` → `./x.ts`, plus `index.ts` for directory imports), and
  skips bare/package specifiers. It records, per module, the complete set of
  in-closure importers and the first module that reached it, so a failure prints
  the actual chain rather than just a file name. The closure is 158 modules.
- **Guards.**
  1. every entry point and watched-module path exists (a rename cannot make the
     guard vacuous);
  2. the closure still reaches all ten files the old per-file test guarded (an
     entry-point list that drifts would otherwise make the check trivially pass);
  3. `r1.ts`, `shadow.ts`, `r1-shadow-report.ts`, `shadow-compare.ts` and
     `simulation-holdout.ts` are unreachable;
  4. the watchlist ∩ closure equals the allowlist exactly, **and** each
     allowlisted module's in-closure importer set matches the pinned one;
  5. bandit is a writer only;
  6. `planTaskTopology` stays defined-but-unused (assertion kept verbatim, plus a
     new check that no other closure module mentions it);
  7. the pre-existing model-router R0/no-R1 assertion, unchanged.

**Allowlist (explicit and pinned, documented in the file header and inline):**

| Module | Sole in-closure importer | Justification |
|---|---|---|
| `src/routing/bandit.ts` | `src/learning/bandit-store.ts` | post-run adaptation reward writer |
| `src/routing/topology.ts` | `src/run/supervisor.ts` | parked `planTaskTopology` wrapper |

The bandit allowance is pinned three ways, not just by module name:
`bandit-store.ts`'s named import list from `../routing/bandit.js` must be a
subset of `{createBanditState, recordReward, BanditState}` (so adding
`selectArm` there fails); no closure module other than `bandit.ts` itself may
mention `selectArm`; and no closure module other than `bandit-store.ts` may
mention `loadProjectBandit`, which pins "writer only, nothing reads it back".
`planTaskTopology` was left in place as instructed.

**Negative case verified**, not just assumed. Appending
`import type { R1Decision } from "./r1.js";` to `src/routing/live-cascade.ts`
(then reverting) turned 2 of the tests red with the chain printed:
`src/track/loop.ts -> src/routing/live-cascade.ts -> src/routing/r1.ts`. The old
per-file test would not have caught this, because `live-cascade.ts` was never in
its ten-file list.

### Task 2 — `test/unit/privacy/plane-boundary.test.ts`

- `RUNTIME_MODULES` now also covers `../supervisor/` and `../cli/`, with a
  comment explaining why (the supervisor holds the live orchestration engine and
  model router; the CLI wires the live run to disk). `../cli/` currently has zero
  hits from the adaptation plane — it is a forward pin, not a fix. The comment
  also records *why* `../routing/` stays narrow: routing is a shared policy
  library whose pure scoring helpers the adaptation plane legitimately uses, and
  only `cost-calibration` carries runtime cost records. No runtime→adaptation
  read was broadened.
- One new exception: `adaptation/eval-routing.ts -> ../supervisor/model-router.js`,
  justified as the type-only `ModelRouterConfig` shape used to keep offline
  routing replays comparable to the live router's configuration.
- The exception list gained an optional `typeOnly` flag and a new test that
  (a) fails an exception that no longer corresponds to a real import — stale
  allowlist entries rot silently otherwise — and (b) fails if a `typeOnly` entry
  becomes a value import. Five of the six entries are marked `typeOnly`; the two
  `from-episode.ts` value imports are the sanctioned derived-signal pipe and are
  correctly not marked.

### Task 3 — `src/routing/r0.ts` header (comment only, no behavior change)

The header claimed "Live flowchart execution does not import this module",
which is false: `run/supervisor.ts → run/child-coordinator.ts →
routing/live-cascade.ts → routing/cascade-evidence.ts` imports `applyCascade`
from here. The replacement states the module-graph fact and then the narrower
true claim — no live path *calls* into R0. `routeR0`'s only caller is the
shadow-only `r1-shadow-report.ts`, and `applyCascade`'s only caller
(`applyEvidenceCascade` in `cascade-evidence.ts`) is exercised by tests only, so
the live edge is an import that loads pure functions nobody invokes. It also
points at `live-isolation.test.ts` as the thing that keeps the claim honest.
R1 stays disabled; nothing executable changed.

### Task 4 — `src/supervisor/flowchart.ts`: **NOT deleted**

The Round 1 brief called it an orphan re-export barrel with zero importers. That
is wrong. `src/supervisor/flowchart-supervisor.ts:17` imports ten symbols from
`./flowchart.js`, which resolves to `src/supervisor/flowchart.ts` (not
`src/domain/flowchart.ts` — the relative specifier stays inside `src/supervisor/`).
Deleting it breaks the live flowchart engine. Per the brief's own instruction
("if anything imports it, do not delete — handoff"), the file is untouched.

## Tests

Node v22.22.2. `pnpm test` is now `node scripts/run-tests.mjs` (gpt-sol-1's
change), which accepts both file and directory arguments.

- `pnpm test -- test/unit/routing/live-isolation.test.ts test/unit/privacy/plane-boundary.test.ts`
  → **PASS, 11/11, 0 fail** (7 live-isolation + 4 plane-boundary; up from 3 + 2).
- `pnpm typecheck` → **PASS**.
- `pnpm lint` → **PASS**, repo-wide clean.
- `pnpm test -- test/unit/routing/ test/unit/privacy/ test/unit/supervisor/` → **PASS**.
- Negative injection run (r1 import added to `live-cascade.ts`, then reverted) →
  **2 fail as designed**, with the import chain in the message.

## Residual risks

- The closure walker is regex-based, not a TypeScript resolver. It over-matches
  (a specifier-shaped string inside a comment counts) and under-matches
  (computed dynamic imports, `require`, bare specifiers that alias back into
  `src/`). Over-matching fails closed, which is the right direction here;
  computed dynamic imports are the real gap, and there are none in `src/` today.
- The allowlist pins importer *sets*, so any legitimate refactor that moves the
  bandit write or the topology import must edit this test. That is deliberate —
  it is the mechanism — but it will read as an unrelated test failure to whoever
  does the refactor. The assertion messages say what to do.
- `selectArm` / `loadProjectBandit` / `planTaskTopology` are checked by token
  match over closure sources, so a re-export under a different name would evade
  them. The importer-set equality check is the backstop for that.
- The type-only checks are regex over source text; `import type { X } from "Y"`
  is required, so the equivalent inline form (`import { type X } from "Y"`) would
  be reported as a value import. `verbatimModuleSyntax` plus the existing house
  style make that a non-issue today, but it is a false-positive shape.

## Blocked / handoff

- **Whoever owns `src/supervisor/flowchart.ts` next**: it is a live barrel, not
  an orphan (see Task 4). If the goal is to remove the indirection, the change is
  to repoint `flowchart-supervisor.ts:2-17` at `../domain/flowchart.js` and
  `./model-router.js` directly and then delete the barrel. That is a real source
  edit outside a comment-only mandate, so I did not do it.
- **fable-1 (`docs/status-matrix.md`)**: line 34 still says
  "`live-isolation.test.ts` checks **direct** imports of ten live files". That is
  now stale — it checks the transitive closure from four entry points, and the
  bandit/topology exceptions are pinned by importer set rather than merely noted
  in prose. `loadProjectBandit` having zero consumers is now test-enforced for
  the live closure, not just documented.
- **fable-2 / docs owners**: `docs/reports/2026-08-24-sota-isolation-privacy.md:59`
  quotes the old r0.ts header text as evidence of a false claim. The claim is
  fixed; that sentence needs rewording to "was false, corrected in Round 2" or
  it becomes false itself.
- **Pre-existing full-suite failures, not mine.** `pnpm test` over everything
  reports 8 failing files (`m3/episode-cli`, `m4/preferences-cli`,
  `track/track-loop`, `cli/adapt`, `cli/api-config`, `cli/doctor-overlay`,
  `cli/doctor`, `privacy/redaction`). Every one of them passes when run alone
  except `test/integration/track/track-loop.test.ts:124`, which fails standalone
  with `The input did not match the regular expression /calibrated/. Input:
  'router-v1-primary'` — that is `src/routing/cost-calibration.ts`, an opus-2
  path. The rest look like parallel-run isolation under the new runner while
  sibling slots are mid-edit in the shared workspace. None of my three files can
  reach any of them.
- No git commit, push, or branch operation performed.

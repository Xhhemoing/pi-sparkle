# How to adapt pi-sparkle to a new Pi release

A repeatable operator playbook for every Pi version bump. Run it whenever
`pi-sparkle pi-compat --online`, `pnpm pi:latest`
(`scripts/pi-latest-check.mjs`), or a Pi release announcement reports the
pins behind latest.

Policy anchors (do not re-litigate them per bump):

- **ADR-001 (Accepted):** Pi is consumed only through `src/pi-adapter/`.
  No other source module may import `@earendil-works/*` types.
- **ADR-004 (Accepted):** adaptation is proposal-first. A version bump is a
  reviewed dependency change, not a live-run mutation.
- **ADR-006 (Proposed):** this repo registers **no** Pi extension and does not
  declare `package.json#pi.extensions`. Inbound extension events (for example
  `session_compact_failed`) stay out of scope until that ADR is Accepted.

## The pinned surface

The pins live in `package.json` `dependencies`:

- `@earendil-works/pi-agent-core` — exact version, no range.
- `@earendil-works/pi-ai` — exact version, matching agent-core.

`@earendil-works/pi-coding-agent` is **not** a dependency. Its releases still
matter because `pi install` (the coding agent) consumes this package's skill
and prompt manifest (`package.json#pi`), so skill-discovery rule changes land
through it.

Everything the adapter imports, by file — this is the diff surface for step 2:

| File | pi-agent-core symbols | pi-ai symbols |
|---|---|---|
| `src/pi-adapter/pi-executor.ts` | `Agent`, `AgentEvent`, `AgentTool`, `ThinkingLevel` | `createModels`, `fauxAssistantMessage`, `fauxProvider`, `Api`, `AssistantMessageEventStream`, `Context`, `FauxProviderHandle`, `Model`, `MutableModels`, `SimpleStreamOptions` |
| `src/pi-adapter/runtime.ts` | `ThinkingLevel` | `createProvider`, `envApiKeyAuth`, `Model`, `MutableModels`; `openAICompletionsApi` (from `api/openai-completions.lazy`); `builtinModels` (dynamic, from `providers/all`) |
| `src/pi-adapter/listed-model.ts` | — | `Api`, `Model`; `getBuiltinModel`, `getBuiltinModels`, `getBuiltinProviders` (from `providers/all`) |
| `src/pi-adapter/auth-session.ts` | — | `AuthInteraction`, `AuthType` |
| `src/pi-adapter/file-credential-store.ts` | — | `AuthOperationOptions`, `Credential`, `CredentialInfo`, `CredentialStore` |
| `src/pi-adapter/cluster-tools.ts` | `AgentTool` | `Type` |

Behavioral (not just type-level) dependencies to re-verify each bump:

- `Agent` constructor shape (`initialState`, `streamFn`), `prompt`,
  `waitForIdle`, `abort`, `subscribe`, `state.errorMessage`.
- `AgentEvent` variants consumed by `translatePiEvent`: `message_update`
  (with `assistantMessageEvent.type === "text_delta"`),
  `tool_execution_start`, `tool_execution_end`, `turn_end` (usage on the
  assistant message).
- `ThinkingLevel` union — the **agent-core** one, which is what the adapter
  imports. The CLI mirrors it as a local string list (`THINKING_LEVELS` in
  `src/cli/main.ts`, backing `run --thinking` and `PI_THINKING_LEVEL`) and
  `src/pi-compat/check.ts` mirrors it as `SPARKLE_THINKING_LEVELS`. If Pi
  adds or removes a level, both mirrors must be updated in the same PR as
  the pin. Two watch items as of 0.84.3:
  - pi-ai dropped `"off"` from its own `ThinkingLevel` and moved it into
    `ModelThinkingLevel = "off" | ThinkingLevel`
    (`pi-ai/dist/types.d.ts`). This repo is unaffected **by design**: the
    adapter (`src/pi-adapter/`) imports the union from **agent-core**, whose
    `ThinkingLevel` still includes `"off"`
    (`pi-agent-core/dist/types.d.ts`), and every other module sees only the
    adapter's re-export — pi-ai's narrowed union never reaches the CLI. If
    a future agent-core aligns with pi-ai, the CLI default level `"off"`
    breaks — check this union first at every bump.
  - Google APIs silently clamp `xhigh`/`max` down: pi-ai's
    `GoogleApiThinkingLevel` tops out at `HIGH`, and
    `ResolvedGoogleThinkingLevel = Exclude<ThinkingLevel, "xhigh" | "max">`
    (`pi-ai/dist/api/google-shared.d.ts`). The CLI forwards the requested
    level unchanged. This is a **known provider behavior, not a pi-sparkle
    bug** — do not file it as repo drift, and do not "fix" it by rewriting
    the level in the CLI or adapter. The behavior is pinned as a
    characterization test, `test/unit/pi-adapter/thinking-clamp.test.ts`:
    if it fails after a bump, Pi's clamp moved and the docs/USAGE need an
    edit, not the adapter.
- `MutableModels.streamSimple(model, context, options)` — the adapter spreads
  caller options through, so additive `SimpleStreamOptions` fields (for
  example `toolChoice`, added in 0.84.3) flow transparently.
- `CredentialStore` method signatures (`read`, `list`, `modify`, `delete`)
  implemented by `FileCredentialStore`.

## The playbook

### 1. Read the changelogs for the delta from the pin

Read the release notes for `@earendil-works/pi-coding-agent` **and** the
inherited `@earendil-works/pi-agent-core` / `@earendil-works/pi-ai` for every
version between the current pin and latest. Classify each entry:

- **Breaking for us** — renames/removals of any symbol in the table above.
- **Additive, adapter-relevant** — new optional options/events we may absorb
  later behind the adapter (file a task; do not rush it into the bump PR).
- **Coding-agent surface** — skill discovery, TUI, tools. Affects
  `.agents/skills/` packaging and docs, never `src/`.
- **Out of scope** — see "What we will not absorb" below.

When the notes are thin, diff the shipped type surfaces directly. pnpm keeps
both versions in the store during a bump, which makes this cheap:

```bash
# after editing the pin and running pnpm install once:
diff node_modules/.pnpm/@earendil-works+pi-ai@<OLD>_*/node_modules/@earendil-works/pi-ai/dist/types.d.ts \
     node_modules/.pnpm/@earendil-works+pi-ai@<NEW>_*/node_modules/@earendil-works/pi-ai/dist/types.d.ts
diff <old agent-core>/dist/types.d.ts <new agent-core>/dist/types.d.ts
diff <old agent-core>/dist/agent.d.ts <new agent-core>/dist/agent.d.ts
```

Worked example (0.84.1 → 0.84.3): pi-ai renamed its Google thinking-level
export to `GoogleApiThinkingLevel` and added `ResolvedGoogleThinkingLevel`;
this repo never imported the old name, so nothing broke. `SimpleStreamOptions`
gained optional `toolChoice`. agent-core's `types.d.ts` and `agent.d.ts` were
byte-identical across the bump.

### 2. Diff the public types used by `src/pi-adapter/`

For each symbol in the table above, confirm it still exists with a compatible
shape in the new version. `pnpm typecheck` is the mechanical check, but read
the diff first: a *widened* union or a new optional field typechecks silently
and can still change runtime behavior (for example a new `AgentEvent` variant
that `translatePiEvent` should translate instead of dropping).

```bash
pnpm pi:probe    # scripts/pi-compat-probe.mjs — pins present, no legacy Google import, ThinkingLevel from agent-core only
pnpm typecheck
```

### 3. Run the adapter tests

```bash
pnpm exec tsx --test test/unit/pi-boundary.test.ts \
  test/unit/pi-adapter/*.test.ts \
  test/integration/pi-adapter/*.test.ts
```

- `test/unit/pi-boundary.test.ts` — ADR-001 tripwire.
- `test/unit/pi-adapter/` — credential store, listed models, model identity,
  usage translation.
- `test/integration/pi-adapter/` — faux-provider smoke, invocation recording,
  multi-model. `provider-smoke.test.ts` self-skips unless `PI_SMOKE=1`
  (needs real credentials + network); run it opt-in for major bumps.

Then the full gate: `pnpm gate` (typecheck, lint, test, build).

### 4. Update the pin in `package.json` — only after typecheck

Edit both pins to the same version, `pnpm install`, and re-run steps 2–3
against the installed tree. Both packages move together; if the target version
is unpublished for one of them, pin both to the highest published matching
pair and record that in the PR description. Never use a `^`/`~` range —
ADR-001 requires an exact reviewed pin. Commit `package.json` and
`pnpm-lock.yaml` in the same commit.

### 5. Refresh the compat surfaces

```bash
pnpm cli pi-compat            # offline is the default; exit 1 only on adapter-contract breakage
pnpm cli pi-compat --online   # opt-in npm dist-tags; fails closed to status=unknown when unreachable
pnpm cli pi-compat --json     # machine-readable PiCompatReport (combines with --online)
pnpm cli doctor               # pi-packages + pi-compat check lines must be ok
pnpm pi:latest                # scripts/pi-latest-check.mjs
```

`--offline` is accepted as an explicit form of the default; passing
`--offline` and `--online` together is a parse-args error. `pnpm pi-compat`
is a package-script shorthand for `pnpm cli pi-compat`. The doctor
`pi-compat` check always uses the offline report, so it never needs network.

Expected after a clean bump: `pinned` equals the new version,
`google-thinking=absent`, all seven thinking levels listed
(`off,minimal,low,medium,high,xhigh,max`), doctor `pi-packages` shows the new
pair. `status=unknown` is correct offline; `behind` after an online check
means a newer Pi shipped while you worked — restart at step 1. One
non-finding to expect: `run --thinking xhigh|max` against a Google model
behaves like `high` — that is the provider clamp from step 2, not a
regression introduced by the bump.

### 6. Update skill overlay notes if discovery/frontmatter rules changed

The skill tree ships via `package.json#pi.skills` (`.agents/skills`). Current
rules (Pi ≥ 0.84.3):

- Nested Markdown skills inside `.agents/skills/` grouping directories are
  discovered, so a grouping layer above `pi-sparkle/` is legal.
- Root `README.md` / `AGENTS.md` inside skill directories are **not** treated
  as broken skills anymore; retract any stale broken-skill findings instead
  of repeating them.
- Non-skill Markdown under a skill directory (our `references/*.md`) is
  supporting material, not a discoverable skill — `pi-sparkle/` is a skill
  directory because it holds `SKILL.md`.

These rules are pinned as a regression fixture:
`test/fixtures/pi-0843-skills/grouping/` holds a grouping directory with a
plain `README.md`/`AGENTS.md` plus a nested `nested-skill/SKILL.md`, and
`test/unit/pi-compat/skill-discovery-0843.test.ts` asserts the frontmatter
shapes. When a release changes discovery rules, update the fixture together
with the rule list above.

If a release changes these rules: re-run `pi install <repo>` and `pi list`,
confirm `/skill:pi-sparkle` and `/sparkle` still resolve, and update
`.agents/skills/pi-sparkle/references/pi-version-adapt.md` plus the dated
health-check section in `SKILL.md`. Skill files are prose, not code — a
discovery change never justifies touching `src/`.

### 7. Never import Pi types outside `src/pi-adapter/`

`test/unit/pi-boundary.test.ts` enforces this, and
`docs/specs/m0-m2-architecture.md` states it: only `src/pi-adapter/` may
import Pi packages. The tripwire matches import/require *specifiers*
(`from "…"`, `import("…")`, `require("…")`), not raw string mentions, so
naming a Pi package as data does not trip it. New Pi capabilities are absorbed by *extending the
adapter's pi-sparkle-owned interfaces* (`AgentExecutor`, `ExecutionEvent`,
`SparkleListedModel`), never by importing Pi types into domain, CLI, or
adaptation code. Modules like `src/pi-compat/` may mention the package
**names** as data (pin reading, registry lookups) but must not import from
them.

## What we will not absorb

Deliberate non-goals. Revisit only with a new ADR, not during a routine bump:

- **TUI features** (`/thinking` selector, Ctrl+S persistence, theming). This
  runtime is headless; the equivalent knob is `run --thinking <level>`
  (wins over `PI_THINKING_LEVEL`; default `off`; per-run, never persisted),
  whereas Pi's `/thinking` is session-scoped and persisted by the TUI. Do
  not report the TUI knob as drift of ours or vice versa.
- **PowerShell tool.** Windows/coding-agent surface. The fake executor and
  the adapter tool set stay platform-neutral; do not add a fake PowerShell.
- **Inbound extension events** (`session_compact_failed` and friends).
  Requires registering a Pi extension, which ADR-006 (still Proposed)
  forbids. `package.json` must not declare `pi.extensions` and
  `@earendil-works/pi-coding-agent` must not become an import.
- **Coding-agent session/TUI state as product state.** Session transport is
  not episode closure (ADR-006); Pi session lifecycle changes never map to
  episode lifecycle changes here.

## Maintainer notes

- `src/pi-compat/check.ts` reads **this file** (and
  `.agents/skills/pi-sparkle/SKILL.md`) only as prose evidence for its
  nested-skill-discovery probe — keep the "nested … skills" wording in
  step 6, or the report gains an "assumed nested skill discovery" finding.
  The legacy-identifier probe (`GoogleThinkingLevel`, the pre-0.84.3 export
  name) runs over adapter sources only (`src/pi-adapter/pi-executor.ts`,
  `runtime.ts`) on both the exit-code path and the printed/JSON report, so
  naming the legacy identifier in documentation — as this bullet just did —
  no longer flips the report. The Round 1 constraint of never spelling it
  contiguously in this document is retired; this bullet doubles as the
  regression probe for that.
- The thinking-level list has one upstream source — agent-core's
  `ThinkingLevel` — and three sparkle-owned mirrors that must stay in sync
  with it: `SparkleThinkingLevel` in `src/pi-adapter/pi-executor.ts` (the
  adapter's public union), `THINKING_LEVELS` in `src/cli/main.ts` (validates
  both `run --thinking` and `PI_THINKING_LEVEL`), and
  `SPARKLE_THINKING_LEVELS` in `src/pi-compat/check.ts`. Drift coverage: if
  a bump **narrows** agent-core's union, `pnpm typecheck` fails at the
  adapter boundary where `SparkleThinkingLevel` is handed to the `Agent`,
  and `test/unit/pi-adapter/thinking-clamp.test.ts` compile-time-pins the
  Google unions against `SparkleThinkingLevel`. If a bump **adds** a level,
  nothing fails automatically — the three mirrors just go stale — so
  comparing the union is still a manual part of step 2 at every bump.
- Version bumps are one commit (pin + lockfile), verification evidence goes
  in the PR description, and any newly absorbed capability is a separate
  commit with its own tests.

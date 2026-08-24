# Orchestrator progress — Pi adaptation + auxiliary features

**Goal:** Find related auxiliary features this project can add, and adapt pi-sparkle to current Pi as Pi updates.

**Branch:** `cursor/pi-adapt-aux-features-e1e3`  
(Cloud Agent branch template is `cursor/<name>-e1e3`. User SOP `agent/<task-name>` is mapped to this branch.)

**Baseline (main @ 4a59949):**
- Pinned: `@earendil-works/pi-agent-core` **0.84.1**, `@earendil-works/pi-ai` **0.84.1**
- Latest published Pi (2026-08-24): **0.84.3** (`@earendil-works/pi-coding-agent`, inherited `pi-agent-core` / `pi-ai`)
- Adapter lives in `src/pi-adapter/` (ADR-001). ADR-006: no inbound Pi extension.

## Shared contract (all rounds)

### New auxiliary: `pi-sparkle pi-compat`

Offline-first compatibility report for the pinned Pi packages vs the adapter contract.

```
pi-sparkle pi-compat [--json] [--offline]
```

- Default: `--offline` (no network). Online latest-version fetch is opt-in (`--offline` omitted) and must fail closed (report `status: "unknown"`, exit 0 with a finding, never throw).
- Exit 0 unless the adapter contract is broken (legacy `GoogleThinkingLevel` import, missing thinking levels, pin unreadable). Then exit 1 with `cliFail`.

Library module (owned Round 1 by gpt-sol-B): `src/pi-compat/check.ts`

```ts
export interface PiPinnedVersions {
  readonly agentCore: string;
  readonly ai: string;
}

export interface PiCompatAdapterProbe {
  readonly thinkingLevels: readonly string[];
  readonly googleThinkingType: "GoogleApiThinkingLevel" | "legacy-GoogleThinkingLevel" | "absent";
  readonly nestedSkillDiscovery: boolean;
  readonly agentsMdNotBrokenSkill: boolean;
}

export interface PiCompatReport {
  readonly generatedAt: string;
  readonly offline: boolean;
  readonly pinned: PiPinnedVersions;
  readonly latest?: PiPinnedVersions;
  readonly adapter: PiCompatAdapterProbe;
  readonly status: "current" | "behind" | "ahead" | "unknown";
  readonly findings: readonly string[];
}

export function readPinnedPiVersions(packageJson: unknown): PiPinnedVersions;
export function comparePiVersions(pinned: string, latest: string): "current" | "behind" | "ahead";
export function probeAdapterContract(): PiCompatAdapterProbe;
export function buildPiCompatReport(input: {
  readonly packageJson: unknown;
  readonly offline: boolean;
  readonly latest?: PiPinnedVersions;
  readonly now?: string;
}): PiCompatReport;
```

### Doctor additions (owned Round 1 by opus-fast-B)

Append two checks (do not rename existing checks; doctor tests match names/prefix):

- `pi-packages`: `agent-core=<pinned> ai=<pinned>`
- `pi-compat`: `status=<current|behind|ahead|unknown> (<short finding or ok>)`

### Probe scripts (owned Round 1 by gpt-sol-A)

- `scripts/pi-compat-probe.mjs` — import adapter + `src/pi-compat/check.ts` (via tsx or static JSON parse of package.json); print report; exit 0/1 same policy as CLI.
- `scripts/pi-latest-check.mjs` — fetch npm dist-tags for `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`; print pinned vs latest. Fail closed offline.

Do **not** edit `package.json` scripts from gpt-sol-A (lockfile owner is opus-fast-A).

### Pi 0.84.1 → 0.84.3 adapter notes

Breaking / inherited (must not leak into domain):

- `GoogleThinkingLevel` → `GoogleApiThinkingLevel` (+ `ResolvedGoogleThinkingLevel`)
- `toolChoice` on simple stream requests (provider-neutral)
- Nested Markdown skills under `.agents/skills/` grouping dirs are discovered
- Root `README.md` / `AGENTS.md` in skill dirs are **not** broken skills
- `session_compact_failed` extension events (we still do not register extensions)
- PowerShell tool is Windows/coding-agent — do not add to our fake executor
- `/thinking` is TUI; our equivalent is `PI_THINKING_LEVEL` (and later `--thinking` if Round 2)

Target pin: **0.84.3** for both `pi-agent-core` and `pi-ai` if typecheck+tests pass. If 0.84.3 is unpublished for one package, pin both to the highest matching pair and document it.

### File ownership — Round 1 (exclusive)

| Agent | Model slug | Owns (write) | Must not touch |
|---|---|---|---|
| R1-fable-A | `claude-fable-5-thinking-xhigh` | `docs/how-to-adapt-to-pi.md`, `docs/reports/2026-08-24-pi-0843-gap-audit.md`, `.agent_workspace/round1-fable-a.md` | `src/`, `test/`, `package.json` |
| R1-fable-B | `claude-fable-5-thinking-xhigh` | `.agents/skills/pi-sparkle/**`, `prompts/sparkle.md`, `.agent_workspace/round1-fable-b.md` | `src/`, `package.json` |
| R1-opus-A | `claude-opus-5-thinking-high-fast` | `package.json`, `pnpm-lock.yaml`, `src/pi-adapter/**`, `src/config/providers-config.ts` if needed, adapter tests under `test/integration/pi-adapter/**` / `test/unit/pi-adapter/**` if types break, `.agent_workspace/round1-opus-a.md` | `src/cli/`, `src/pi-compat/`, skills |
| R1-opus-B | `claude-opus-5-thinking-high-fast` | `src/cli/pi-compat.ts` (new), `src/cli/main.ts` (USAGE + switch only), `src/cli/doctor.ts` (append checks), `README.md` (command row), `.agent_workspace/round1-opus-b.md` | `package.json`, `src/pi-adapter/`, `src/pi-compat/` (import only) |
| R1-gpt-A | `gpt-5.6-sol-xhigh-fast` | `scripts/pi-compat-probe.mjs`, `scripts/pi-latest-check.mjs`, `.agent_workspace/round1-gpt-a.md` | `package.json`, `src/cli/` |
| R1-gpt-B | `gpt-5.6-sol-xhigh-fast` | `src/pi-compat/**` (new), `test/unit/pi-compat/**`, `test/unit/cli/pi-compat.test.ts`, `.agent_workspace/round1-gpt-b.md` | `src/cli/main.ts`, `package.json` |

Do **not** git commit. Parent orchestrator commits after the round.

Every subagent report **must start with the actual model slug** on line 1.

## Round log

### Round 1 — complete (2026-08-24)

All 6 subagents returned. Requested slugs vs reports: fable pair `claude-fable-5-thinking-xhigh`; opus pair `claude-opus-5-thinking-high-fast`; gpt pair `gpt-5.6-sol-xhigh-fast`. No silent downgrade recorded in reports.

#### Shipped

- **Pi pin 0.84.1 → 0.84.3** (`pi-agent-core` + `pi-ai`, matching pair). Adapter typecheck clean: consumed agent-core `.d.ts` is byte-identical; `GoogleThinkingLevel` rename was never imported; optional `toolChoice` already flows through the options spread. Adapter now exports `SparkleThinkingLevel` instead of leaking Pi's `ThinkingLevel` into CLI.
- **Auxiliary `pi-sparkle pi-compat [--json] [--offline|--online]`** + doctor checks `pi-packages` / `pi-compat`. Library in `src/pi-compat/`. Offline-default; online fail-closed.
- **Probes:** `scripts/pi-compat-probe.mjs`, `scripts/pi-latest-check.mjs` (offline / JSON / `--strict`).
- **Docs:** `docs/how-to-adapt-to-pi.md`, `docs/reports/2026-08-24-pi-0843-gap-audit.md`.
- **Overlay:** SKILL.md 0.84.3 section + `references/pi-version-adapt.md`; prompt `pi-bump` hint.
- **Parent fix:** `test/unit/pi-boundary.test.ts` now matches import specifiers, not string mentions (unblocked `src/pi-compat` literals).

#### Remaining defects

- No CLI integration tests for `pi-compat` yet (library tests exist; `pnpm test -- test/unit/pi-compat` dir form hits Node `ERR_UNSUPPORTED_DIR_IMPORT`).
- No `package.json` scripts wrapping the probe files.
- No `--thinking` on `run` (env `PI_THINKING_LEVEL` only). Google models silently clamp `xhigh`/`max`.
- Nested-skill 0.84.3 discovery is documented, not fixture-tested (must not look like a second skill under `.agents/skills/`).
- `pi-ai` `ThinkingLevel` dropped `"off"` while agent-core kept it — watch on next bump.
- Probe must stay adapter-source-only; do not re-widen to docs (legacy identifier in prose must not fail doctor).
- This VM's Node may be 22.14 vs `engines >=22.19.0` — environmental doctor FAIL, not product.

#### Round 2 focus (SOTA gap)

1. CLI tests + npm script aliases + help/README/how-to flag alignment (`--online` vs contract).
2. `--thinking` on `run`, documented vs TUI `/thinking`.
3. Nested-skill + AGENTS.md discovery fixture under `test/`.
4. Keep ADR-001/006: no extensions, no coding-agent dep, no PowerShell tool.
5. Re-run `pnpm gate` after the boundary-test parent fix.

### Round 2 — in progress (targeted refactor + deep optimization)

Brief: `.agent_workspace/ROUND1-BRIEF.md` (inject into every R2 agent).

| ID | Agent | Task id |
|---|---|---|
| R2-fable-A | docs / SOTA remainder | `bc-35f62f6f-4574-5169-a5f2-20faa869fc3b` |
| R2-fable-B | overlay polish | `bc-6dffdb01-cefb-5ec0-9875-f5a7b3e55ad4` |
| R2-opus-A | `run --thinking` | `bc-00f6c6c9-ecf9-52db-87b1-7bf715759711` |
| R2-opus-B | CLI tests + npm scripts | `bc-f79dace0-0fdd-525d-9a84-0692a1664278` |
| R2-gpt-A | nested-skill fixtures | `bc-08ed8fc4-3182-5bfd-a743-b676eab458a4` |
| R2-gpt-B | library hardening | `bc-2d231917-25e7-5b3e-a2da-ee15c1b8121f` |

| Agent | Model slug | Owns (write) | Must not touch |
|---|---|---|---|
| R2-fable-A | `claude-fable-5-thinking-xhigh` | `docs/how-to-adapt-to-pi.md`, `docs/reports/**` (align flags, thinking, SOTA remainder), `.agent_workspace/round2-fable-a.md` | `src/`, `package.json` |
| R2-fable-B | `claude-fable-5-thinking-xhigh` | `.agents/skills/pi-sparkle/**`, `prompts/sparkle.md`, `.agent_workspace/round2-fable-b.md` | `src/`, `package.json` |
| R2-opus-A | `claude-opus-5-thinking-high-fast` | `src/cli/main.ts` (`run --thinking` + USAGE), adapter runtime only if mapping required, `test/unit/cli/` tests for `--thinking`, `.agent_workspace/round2-opus-a.md` | `src/pi-compat/`, skills, `package.json` scripts |
| R2-opus-B | `claude-opus-5-thinking-high-fast` | `test/unit/cli/pi-compat.test.ts`, doctor test appends, `package.json` scripts `pi-compat`/`pi:latest` only, `src/cli/pi-compat.ts` if export needed, `.agent_workspace/round2-opus-b.md` | `src/cli/main.ts`, `src/pi-adapter/` |
| R2-gpt-A | `gpt-5.6-sol-xhigh-fast` | `test/fixtures/pi-0843-skills/**` (nested + AGENTS.md fixtures), fixture tests, script edge cases under `scripts/`, `.agent_workspace/round2-gpt-a.md` | `src/cli/main.ts`, `package.json` |
| R2-gpt-B | `gpt-5.6-sol-xhigh-fast` | `src/pi-compat/check.ts` (derive names from dep keys if still hardcoded; keep probe adapter-only), `test/unit/pi-compat/**`, `.agent_workspace/round2-gpt-b.md` | `src/cli/main.ts`, `src/pi-adapter/` |

### Round 2 — complete (2026-08-24)

All 6 returned (`claude-fable-5-thinking-xhigh` ×2, `claude-opus-5-thinking-high-fast` ×2, `gpt-5.6-sol-xhigh-fast` ×2).

Shipped: `run --thinking`, pi-compat CLI tests + npm aliases, adapter-only library probe, nested-skill fixtures, docs alignment. Overlay still labels `--thinking` as planned (Round 3 fix). SOTA remainder: README thinking line, Google clamp mirror test, `pnpm gate`, status-matrix row.

Brief for Round 3: `.agent_workspace/ROUND2-BRIEF.md`.

### Round 3 — in progress (SOTA polish + final acceptance)

| Agent | Model slug | Owns (write) | Must not touch |
|---|---|---|---|
| R3-fable-A | `claude-fable-5-thinking-xhigh` | `docs/**` (status-matrix, how-to leftover, SOTA gap close), `.agent_workspace/round3-fable-a.md` | `src/`, skills |
| R3-fable-B | `claude-fable-5-thinking-xhigh` | `.agents/skills/pi-sparkle/**`, `prompts/sparkle.md`, `README.md` (thinking + probe rows only), `.agent_workspace/round3-fable-b.md` | `src/` |
| R3-opus-A | `claude-opus-5-thinking-high-fast` | thinking-mirror / clamp tests under `test/unit/`, USAGE one-liners in `src/cli/main.ts` only if tests require, `.agent_workspace/round3-opus-a.md` | `src/pi-compat/`, skills |
| R3-opus-B | `claude-opus-5-thinking-high-fast` | `pnpm gate` failures in CLI tests / lint; optional `prerelease` including `pi:probe`; `.agent_workspace/round3-opus-b.md` | `src/pi-adapter/` |
| R3-gpt-A | `gpt-5.6-sol-xhigh-fast` | `test/fixtures/pi-0843-skills/**`, discovery tests, probe script edges, `.agent_workspace/round3-gpt-a.md` | `src/cli/main.ts` |
| R3-gpt-B | `gpt-5.6-sol-xhigh-fast` | `src/pi-compat/**` + its tests; prove docs spelling `GoogleThinkingLevel` does not fail doctor, `.agent_workspace/round3-gpt-b.md` | `src/cli/main.ts` |

### Round 3 — complete (2026-08-24)

All 6 returned. `pnpm gate` green (1213 pass, 1 skipped smoke). Overlay `--thinking` stale “planned” claim fixed. Status matrix updated. Google clamp characterized. No conflicts vs `origin/main`.

See `.agent_workspace/ROUND3-BRIEF.md`.

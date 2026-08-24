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

### Round 1 — in progress (initial build + baseline)

Dispatched 6 concurrent tasks. See round reports when they land.

### Round 2 — pending

### Round 3 — pending

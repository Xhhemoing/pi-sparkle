MODEL_SLUG: claude-opus-5-thinking-high-fast

# Round 1 — R1-opus-B (CLI wiring for `pi-compat` + doctor checks)

Status: done. Not committed (parent orchestrator commits the round).

## Files written (all inside my exclusive paths)

| File | Change |
|---|---|
| `src/cli/pi-compat.ts` | New. `piCompatCommand`, plus `readSparklePackageJson` / `buildOfflinePiCompatReport` / `piCompatBreakage` exported for doctor and tests |
| `src/cli/main.ts` | Surgical: one import, two USAGE lines, one `case "pi-compat"`. +5 lines, 0 removed. No run/track/flowchart behavior touched |
| `src/cli/doctor.ts` | Appended `piPackagesCheck()` and `piCompatCheck()` and two array entries. Existing check `name`s untouched |
| `README.md` | One new Commands row for `pi-compat`; the existing doctor row now names the two new checks |
| `.agent_workspace/round1-opus-b.md` | This report |

`src/pi-compat/check.ts` already existed when I needed it (R1-gpt-B landed first), so I imported it and created nothing there.

## CLI behavior

```
pi-sparkle pi-compat [--json] [--offline]
pi-sparkle pi-compat --online [--json]
```

- **Offline is the default.** `--offline` is the explicit spelling of the default; `--online` is the opt-in that reads npm dist-tags. Node's `parseArgs` has no `--no-<flag>` negation, so an affirmative `--online` was the only way to keep default-offline and still reach the network path at all. Passing both flags is a `parse-args` `cliFail`.
- `--json` prints the `PiCompatReport` and nothing else on stdout; warnings go to stderr.
- Human mode prints generated-at, mode, pinned versions, latest (or `skipped (offline)` / `unavailable (registry unreachable)`), the adapter probe on two lines, status, findings, and a `next:` line.
- Online path **fails closed**: a registry error yields no `latest`, one stderr `warning:` line, `status: unknown`, and exit 0. It never throws.
- Registry base URL honors `PI_COMPAT_REGISTRY_URL` (same env var and `/<pkg>/latest` endpoint that R1-gpt-A used in `scripts/pi-latest-check.mjs`), which also makes the online path testable without real network.
- Exit 1 only via `cliFail({ command: "pi-compat", stage: "compat", next: "adapt src/pi-adapter, run pnpm typecheck, and record the Pi pin move in the changelog" })`.

`piCompatBreakage(report)` is a **pure function of the report** — easy to unit-test by constructing a report. It returns a reason when: any finding is prefixed `BROKEN: ` (unreadable pin, unreadable adapter sources, legacy Google type), or `adapter.googleThinkingType === "legacy-GoogleThinkingLevel"`, or `adapter.thinkingLevels` is empty. Everything else, including `behind`, is exit 0.

> Design note: my first version computed breakage from its own `probeAdapterContract({ readAdapterSource })` scoped to `src/pi-adapter/*.ts`, because the library's default probe then also read `.agents/skills/pi-sparkle/SKILL.md` and `docs/how-to-adapt-to-pi.md` — prose that *names* `GoogleThinkingLevel` in migration notes would have been read as a legacy import and turned `doctor` red (breaking `test/unit/cli/doctor.test.ts`, which asserts exit 0 and empty stderr). R1-gpt-B fixed that in `a63f1a2 fix: isolate adapter type probing from documentation`, so I simplified to the report-driven version. **If anyone re-widens the default adapter-source set to include docs or skills, this exit-code policy goes with it.**

## Doctor

Two appended checks, existing `DoctorCheck` shape, no renames:

```
  ok  pi-packages: agent-core=0.84.3 ai=0.84.3
  ok  pi-compat: status=unknown (offline compatibility check has no latest Pi versions to compare)
```

- `pi-packages` reads the pins through `readPinnedPiVersions(readSparklePackageJson())`; ok whenever readable, FAIL with the reader's message otherwise. No network.
- `pi-compat` builds the offline report (never throws — an unreadable `package.json` becomes a `BROKEN` finding) and is ok unless `piCompatBreakage` fires. The detail note is the breakage, else the first finding, else `ok`, truncated at 96 chars.

## Verification

Run with Node 22.22.2 (`/exec-daemon/node` on PATH is 22.14.0, below `engines.node >= 22.19.0`, which makes the pre-existing `node:` doctor check FAIL and is unrelated to this work).

- `pnpm typecheck` clean, `pnpm lint` clean, `pnpm build` clean.
- `pnpm test`: 1179 pass / 1 fail — see leftover below. `test/unit/cli/doctor.test.ts` and `test/unit/pi-compat/check.test.ts` pass.
- Exercised by hand: offline, `--json`, `--online` against the real registry (`status: current`, pinned 0.84.3 == latest 0.84.3), `--online` against a dead registry (exit 0, warning, `status: unknown`), `--offline --online` (exit 1, parse-args), `help` / `--help`, unknown flag, and all four breakage branches. Also smoke-tested the compiled CLI: `node dist/cli/main.js pi-compat` exits 0 and `node dist/cli/main.js doctor` shows both new checks green.

## Leftover for the orchestrator / R1-gpt-B

**`test/unit/pi-boundary.test.ts` fails on `src/pi-compat/check.ts` (not mine, not my write path).** That test flags *any* occurrence of the string `@earendil-works/` in `src/**` outside `src/pi-adapter/`, including plain string literals. `check.ts` hardcodes the two dependency names in `readPinnedPiVersions`. My CLI hit the same wall and I fixed it on my side by deriving the registry names from the pinned dependency keys instead (`names.find((name) => name.endsWith("/pi-agent-core"))`), which also keeps the Pi scope declared only in `package.json`. Either apply the same trick in `check.ts` or narrow the boundary test to import statements. This is the one red test in the suite.

Nothing else is blocked: the library landed before I needed it, so there is no lagging-dependency stub to clean up.

## Suggested Round 2 — `--thinking`

`PI_THINKING_LEVEL` is read directly inside `createExecutor` in `src/cli/main.ts` (validated against the local `THINKING_LEVELS` tuple, default `off`). Pi's `/thinking` is TUI-only, so a flag is our equivalent. Proposed:

```
pi-sparkle run ... [--thinking off|minimal|low|medium|high|xhigh|max]
```

- Precedence `--thinking` > `PI_THINKING_LEVEL` > `off`, mirroring how `--primary-model` already wins over env and `providers.json`.
- Thread it as an explicit parameter into `createExecutor` rather than leaving the env read buried there; the env read should move up to `runCommand` so one place resolves the level. `--track` and `--children` share that executor, so they inherit it for free.
- Reject an unknown value with `cliFail` at `stage: "parse-args"` instead of the current `DomainValidationError` thrown from executor construction, so the failure names the flag.
- Owner should be whoever owns `src/cli/main.ts` in Round 2; the change is not surgical (parseArgs options, `createExecutor` signature, both call sites) and will collide with anything else editing `runCommand`.
- Worth pairing: `doctor` could add the effective thinking level to an existing line, and `pi-compat`'s `adapter.thinkingLevels` already reports the accepted set, so a mismatch between the flag's allowed values and Pi's `ThinkingLevel` union becomes visible in one place.

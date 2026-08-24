# Round 3 — R3-opus-B (quality gate closer)

`MODEL_SLUG: claude-opus-5-thinking-high-fast`

Branch `cursor/pi-adapt-aux-features-e1e3`, VM Node `v22.22.2`, pnpm `10.17.1`.

## Verdict

**`pnpm gate` is green.** No product fixes were required — nothing in the Round 2
or Round 3 work broke typecheck, lint, test, or build. The only file I changed is
`package.json` (the optional `pi:probe` addition to `prerelease`).

## Task 1 — `pnpm gate` results

`gate` = `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Exit code **0**.

| Stage | Command | Result |
| --- | --- | --- |
| typecheck | `tsc --noEmit` | exit 0, zero diagnostics |
| lint | `eslint .` | exit 0, zero errors, zero warnings |
| test | `tsx --test` | 1214 tests / 82 suites — 1213 pass, 0 fail, 1 skipped, 0 cancelled, 0 todo (~18 s) |
| build | `tsc -p tsconfig.build.json` | exit 0, emits `dist/` incl. `dist/cli/main.js`, `dist/pi-adapter/`, `dist/pi-compat/` |

The single skip is intentional and is not an environmental gap:

```
ok 159 - PiAgentExecutor completes a run against a real provider # SKIP set PI_SMOKE=1
         with PI_PROVIDER/PI_MODEL (+PI_API_KEY, or a providers.json in the state root)
```

That is `test/integration/pi-adapter/provider-smoke.test.ts`, self-skipping without
`PI_SMOKE=1`. It keeps the gate free of live provider calls, matching the Round 3
"no live R1/bandit" constraint.

### Node engines — not an issue on this VM

`engines.node` is `>=22.19.0` and the VM runs `v22.22.2`, so the doctor Node check
passes here. Engines were **not** lowered and no engines-related failure was observed.
If an older VM trips this, it is environmental.

### Test counts drifted during the session (explained, not a defect)

I saw 1201 → 1204 → 1214 tests across runs. This workspace is shared with the other
Round 3 agents, who were adding test files while I ran the gate. Back-to-back runs at
a fixed tree are deterministic (I ran `pnpm test` twice: identical 801 top-level
entries both times), and the suite list is byte-identical with and without `dist/`
present, so discovery is not leaking build output. The last full gate above reflects
the tree including `test/unit/pi-adapter/thinking-clamp.test.ts` and
`test/unit/pi-compat/probe-scripts.test.ts` from sibling agents; both pass.

## Task 2 — directory-form test invocation

Confirmed the failure and left the runner alone:

```
$ pnpm test -- test/unit/pi-compat
Error [ERR_UNSUPPORTED_DIR_IMPORT]: Directory import '/workspace/test/unit/pi-compat' is not supported
# tests 1 # pass 0 # fail 1   (exit 1)
```

`tsx --test` forwards a positional path straight to the loader, so a directory
argument is import-resolved rather than glob-expanded. The working form is file-based:

```
$ pnpm test -- test/unit/pi-compat/*.test.ts
# tests 19 # suites 1 # pass 19 # fail 0 # skipped 0   (exit 0)
```

I did **not** change the `test` script, add a glob flag, or otherwise touch the runner.
Bare `pnpm test` (no positional argument) already discovers everything correctly, which
is what `gate` and CI's `quality` job use. CI's `cli-smoke` job already passes explicit
files (`pnpm test -- test/integration/m1/cli-children.test.ts test/unit/cli/doctor.test.ts`),
so nothing in CI depends on directory arguments.

## Task 3 — `prerelease` now runs `pi:probe`

`scripts/pi-compat-probe.mjs` is deterministic and fully offline: it reads
`package.json` plus the files under `src/pi-adapter/` and does no network or spawn
work. It qualifies for the release chain, so:

```
"prerelease": "pnpm gate && pnpm security:probe && pnpm pi:probe"
```

Verified end to end — the chain reaches and passes the new step:

```
$ SECURITY_WAIVER="pii-redaction,secret-bodies" pnpm prerelease
... gate: 1214 tests, 1213 pass, 0 fail, 1 skipped; build ok
... security:probe: "status": "ok"
... pi:probe: PASS pin @earendil-works/pi-agent-core: 0.84.3
              PASS pin @earendil-works/pi-ai: 0.84.3
              PASS legacy identifier GoogleThinkingLevel is absent from src/pi-adapter
              PASS ThinkingLevel imports use @earendil-works/pi-agent-core only (1 found)
exit 0
```

The waiver was needed only because of a pre-existing block, described next.

## Pre-existing, out of scope: `security:probe` is BLOCKED on `main`

Unwaived, `pnpm security:probe` exits 1 with nine open findings (seven
`pii-redaction`, two `secret-bodies` — sensitive payloads survive `redactFeedback`).
This is **not** a regression from this branch: neither `scripts/security-probe.mjs`
nor `src/feedback/redaction.ts` appears in `git diff --name-only origin/main...HEAD`,
and `docs/specs/release-gate.md` already records "Status: currently BLOCKED" with these
findings dated 2026-08-22. I left it alone — fixing redaction is a separate product
change, and `security:probe` is not part of `gate`.

One consequence worth flagging to the parent: because the chain is `&&`, `pi:probe`
placed after `security:probe` will not execute during a real `pnpm prerelease` until
that finding is closed or waived. Ordering follows the Round 3 instruction; move
`pi:probe` ahead of `security:probe` if you want it to run unconditionally.

Two notes on the probe script for whoever closes the security finding: it must run
against a built tree (it imports `dist/feedback/redaction.js`, so it reports a
`module-load` failure if `dist/` is absent), and `prerelease` satisfies that because
`gate` ends with `build`.

## CI parity spot-checks (all green)

- `pnpm cli version` → `0.1.0`
- `pnpm cli help` → USAGE lists `[--thinking <level>]` on all three `run` forms and
  `pi-compat [--json] [--offline]` / `pi-compat --online [--json]`. Flag naming matches
  the Round 3 brief item 5; no `--online`/`--offline` mismatch remains.
- `pnpm test -- test/integration/m1/cli-children.test.ts test/unit/cli/doctor.test.ts`
  → 12 tests, 12 pass, 0 fail.

## Files I changed

- `package.json` — one line, `prerelease` gains `&& pnpm pi:probe`.
- `.agent_workspace/round3-opus-b.md` — this report.

No edits to `src/pi-adapter/**`, `src/cli/main.ts`, skills, or docs. No commits made,
per instructions.

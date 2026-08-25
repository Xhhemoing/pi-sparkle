# Round 3 — close 内测 (screaming-snake redaction + CI Node pin + leftover wiring)

**Branch:** `cursor/merge-preview-release-8011`
**First line of every report:** actual model slug.
**No git commit / push / checkout.** Stay on this branch.

## Round 2 facts (do not redo)

- Probe GREEN; `packaged-secrets` never-waivable in code; CI runs `pnpm security:probe` after build (still `22.x`).
- `preview:probe` is first in `prerelease`. `market-eval:probe` not wired (script landed after gpt-B started).
- `inspect --follow` ported from cae9 without merging that branch.
- Governance files + adapt-eval honesty + ADR-006 tests landed.
- `src/cli/inspect-format.ts` exists but is **not called** from `main.ts`.
- Two release-gate sentences are stale ("Rule 3 is policy, not code"; "Not yet a bar").

## File ownership

| Slot | Model | Writes | Must not touch |
|---|---|---|---|
| R3-fable-A | `claude-fable-5-thinking-xhigh` | `docs/reports/2026-08-25-r3-sota-acceptance.md`, `.agent_workspace/r3-fable-a.md` | `src/`, `scripts/`, `.github/` |
| R3-fable-B | `claude-fable-5-thinking-xhigh` | `docs/reports/2026-08-25-neice-declaration.md` (claims audit for 内测), `.agent_workspace/r3-fable-b.md` | `src/`, `scripts/` |
| R3-opus-A | `claude-opus-5-thinking-high-fast` | `src/feedback/redaction.ts`, `scripts/security-probe.mjs` (add screaming-snake sample only), `test/unit/feedback/redaction.test.ts`, `test/unit/privacy/redaction.test.ts`, `.agent_workspace/r3-opus-a.md` | `src/cli/`, `.github/workflows/` |
| R3-opus-B | `claude-opus-5-thinking-high-fast` | `src/cli/main.ts` (wire `inspect-format.ts` only; keep `--follow` and `--max-cost-usd`), `test/unit/cli/inspect-format.test.ts` (new), `test/integration/cli/cli.test.ts` (verification= lines from fc6058c if still missing), `README.md` (add `unblock` + `help` rows so parity test can drop its allowlist), `.agent_workspace/r3-opus-b.md` | `src/feedback/`, `scripts/security-probe.mjs` |
| R3-gpt-A | `gpt-5.6-sol-xhigh-fast` | `.github/workflows/ci.yml` (quality + cli-smoke `node-version: ["22.19.0"]` not `22.x`), `.agent_workspace/r3-gpt-a.md` | `src/` |
| R3-gpt-B | `gpt-5.6-sol-xhigh-fast` | `package.json` scripts (`market-eval:probe` if script exists), `docs/specs/release-gate.md` (truth-up Rule 3 now code; CI *is* a bar; do not flip GREEN until opus-A re-dates if they add a sample), `test/unit/cli/readme-command-parity.test.ts` only if opus-B added README rows and you must drop the allowlist — prefer leaving that to opus-B; default: do not touch that test, `.agent_workspace/r3-gpt-b.md` | `src/feedback/redaction.ts`, `src/cli/main.ts` |

## Tasks

### R3-fable-A — SOTA acceptance

Accept/reject Round 2 landings with evidence. Confirm inspect-format still unwired at Round 2 close. After siblings land, re-read if their files exist; do not wait forever — review the committed Round 2 tree plus in-tree Round 3 if present. Recommend **zero** Round 4 unless a new reproduced gap exists. No padding.

### R3-fable-B — 内测 declaration / claims audit

Write what an operator may claim after Round 3: SHA, `pnpm prerelease` meaning, Node floor, private package, ADR-006 Proposed, P0 not closed, not Outcome-supported, not npm-publishable. Forbid overclaim. If opus-A's redaction sample is in-tree, require GREEN re-date.

### R3-opus-A — screaming-snake secret names

Live miss: `DATABASE_PASSWORD=` / `API_TOKEN=` survive because `\b` before `password` fails on `_`. Fix `KEYED_SECRET_NAMES` / boundary so screaming-snake forms redact. Add a `secret-bodies` sample to `scripts/security-probe.mjs` so the Round 1 drift guard forces GATE_CORES pins. Keep idempotence. Re-run unit tests + probe. If GREEN text in release-gate is now missing the new sample date, leave spec to gpt-B but **tell them the new date/command** in your report.

### R3-opus-B — wire verification display + README parity

Apply the inspect-format wiring patch from `.agent_workspace/r2-opus-b.md` (import + `run --children` / `inspect --run` / `--track` only). Do not take fc6058c resume-deprecation or BLOCKED-gate doc hunks. Add inspect-format unit tests. Add README rows for `unblock` and `help` so `readme-command-parity` can drop `["unblock","help"]` exemptions. Keep `--follow` and `--max-cost-usd`.

### R3-gpt-A — pin CI Node 22.19.0

Replace `22.x` with `22.19.0` on both quality and cli-smoke jobs so the new security-probe step certifies on an engines-compliant host. Comment why. Do not change `package.json` engines.

### R3-gpt-B — market-eval script + release-gate truth-up

Add `"market-eval:probe": "node scripts/market-eval-probe.mjs"` if the file exists. Truth-up `docs/specs/release-gate.md`: Rule 3 is enforced in `security-probe.mjs`; CI quality job runs the probe with no waiver. If opus-A added a probe sample, re-date GREEN with command + new sample count; otherwise keep 2026-08-25 GREEN and only fix the two stale sentences. Do not weaken never-waivable.

## Frozen

ADR-006 Proposed. No live R1. No Outcome-supported. No PR #9 merge. `private: true` stays. No Round 4 padding.

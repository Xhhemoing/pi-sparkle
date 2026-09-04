# Real-provider acceptance runbook (Developer Preview)

The one promise a Developer Preview makes that the offline suite cannot keep:
**the `--executor pi` path actually works against a real provider.** Everything
offline is already gated (`pnpm gate`, `pnpm prerelease`); this runbook is the
scripted, credentialed pass that closes the gap. It exists because the
[status matrix](status-matrix.md) marks every real-provider capability
"opt-in smoke only".

What this acceptance **does not** claim: no capability becomes
Outcome-supported here. That bar is a held-out benefit with no guardrail
regression and stays closed until Checkpoint F-PROD (ADR-005). A green
acceptance upgrades "Wired + Exercised offline" to "Exercised against one real
provider, once, on record" — nothing more.

## Prerequisites

- Node.js >= 22.19.0, pnpm 10.17.1 (the pinned toolchain; CI uses the same)
- `pnpm install --frozen-lockfile && pnpm build`
- Provider credentials: `PI_API_KEY` in the environment, or a stored key via
  `pnpm cli auth login --key-stdin` (never pass keys as argv)
- `PI_PROVIDER` and `PI_MODEL` naming an enabled model (or set a default with
  `pnpm cli models set-default`)
- Network access to the provider, and a small spend budget (the scripted runs
  below are trivial prompts; expect cents, not dollars)
- A scratch state root so acceptance never touches real data:
  `export PI_STATE_ROOT="$(mktemp -d)"` (PowerShell:
  `$env:PI_STATE_ROOT = (New-Item -ItemType Directory -Path (Join-Path $env:TEMP ([guid]::NewGuid()))).FullName`)

## Step 0 — offline gate must be green first

```bash
pnpm gate
```

If this is not green, stop: acceptance on a red tree proves nothing.

## Step 1 — provider smoke (minimal wired proof)

```bash
PI_SMOKE=1 PI_PROVIDER=<provider> PI_MODEL=<model> \
  pnpm test -- test/integration/pi-adapter/provider-smoke.test.ts
```

This builds the executor through the production configured factory (builtin
and custom providers, stored credentials or env keys) and completes one
`startRun` with the objective "Reply with exactly: OK". Pass =
`PiAgentExecutor completes a run against a real provider` is not skipped and
not failed.

## Step 2 — CLI-level run and inspection

```bash
pnpm cli run --objective "Reply with exactly: OK" --executor pi --state-root "$PI_STATE_ROOT"
pnpm cli inspect --run <runId> --state-root "$PI_STATE_ROOT" --summary-json
```

Expect `Run <id>: COMPLETED` and one `INSPECT_SUMMARY` object. Record the
runId, the model reported by the invocation log, and the charged cost.

## Step 3 — operator arc: approval gate, answer, completion

The loopback suite proves this offline; here it is proven against the real
executor. `examples/flowchart.json` ships an approval gate (the `verdict`
node has `approvalRequired: true`):

```bash
pnpm cli run --flowchart examples/flowchart.json --executor pi --state-root "$PI_STATE_ROOT"
# run settles WAITING_FOR_USER at the verdict gate
pnpm cli inspect --run <runId> --state-root "$PI_STATE_ROOT"
# note the pending approval message id and the plan's option ids
pnpm cli answer --run <runId> --message <msgId> --selected <optionId> --state-root "$PI_STATE_ROOT"
```

Expect the run to wait at the gate, `inspect` to name the pending approval,
and `answer` to apply the reply and drive the run to COMPLETED (answer is a
continuation path: it persists the reply and resumes in one audited step).

Optionally also exercise the BLOCKED arc once: any run that settles BLOCKED
prints four routed `next:` lines; `unblock --run <id> --reason <text>` then
`resume --run <id>` completes it. Both arcs against a real executor is the
full acceptance; the approval arc alone is the minimum.

## Step 4 — record the evidence

Copy the template below into
`docs/reports/<YYYY-MM-DD>-real-provider-acceptance.md` and fill it in. An
acceptance without a dated report did not happen — the matrix links evidence,
not memory.

```markdown
# Real-provider acceptance — <date>

- Commit: <git rev-parse HEAD>
- Node: <node --version> · OS: <platform>
- Provider/model: <PI_PROVIDER>/<PI_MODEL> (record the model, not the key)
- Step 0 `pnpm gate`: pass/fail
- Step 1 provider smoke: pass/fail (duration)
- Step 2 CLI run: runId, status, charged cost USD
- Step 3 operator arc: runId, gate waited on, answer/unblock command used, final status
- Anomalies: <any warnings, retries, cost-gate notices; "none" is a valid entry>
- Conclusion: pass / pass-with-notes / fail (link follow-up issue)
```

## Failure routing

- Auth/model resolution failures: `pnpm cli doctor --state-root "$PI_STATE_ROOT" --json`
  and `pnpm cli models list --state-root "$PI_STATE_ROOT"`.
- 429/5xx storms: provider retry is capped at 3 attempts with backoff by
  design; persistent failure is a provider-side problem, record it as such.
- A run that dies mid-acceptance: `doctor` `runStates[]` names the inspect /
  resume / delete route; never delete state before capturing the report.

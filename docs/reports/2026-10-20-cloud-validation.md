# Cloud validation attempt and dependency blocker

## Identity

- Task: `TASK-20261020-cloud-continuation`, Work 1.
- Date: 2026-10-20 America/Los_Angeles (session date).
- Repository/branch: `Xhhemoing/pi-sparkle`, `codex/cloud-continuation-20261020`.
- Inspected source: `d6a3032ade218c365116786414170fa1e5eefd8b`; includes `3d3dcdc5`. The new checkout was clean. No pre-existing user modifications were reset, staged or discarded.
- Environment: Linux x64; default Node `v24.19.0`; separately installed Node `v22.19.0`; PowerShell `7.5.4`; pinned pnpm `10.17.1`. The initial default pnpm was `11.25.0` and was not used for project installation/verification.
- Owner: cloud root coordinator. Independent read-only agents investigated conversation interfaces, recovery facts and the toolchain. These investigations are not implementation reviews or test passes.
- Scope: [cloud execution plan](../superpowers/plans/2026-10-20-cloud-continuation.md). Historical local Windows gate logs are **unavailable** in this checkout; no result is inferred from the earlier 89/89 regression.

## Commands

After PowerShell bootstrap, project validation commands used PowerShell with `$ErrorActionPreference = 'Stop'`, explicit UTF-8 file I/O and checked native exit codes. The execution API only supports a Bash launcher, so it launched PowerShell with a safely quoted script. Initial discovery, checkout, status/ancestry checks, required-document reads and toolchain bootstrap used Bash before PowerShell was available; no product implementation was changed by those commands.

| Command/action | Result | Notes/evidence |
|---|---|---|
| `git ls-remote ... refs/heads/codex/cloud-continuation-20261020`, clone and `git rev-parse HEAD` | Verified source identity | Remote/read checkout returned `d6a3032ade218c365116786414170fa1e5eefd8b`; branch matches user request |
| `git merge-base --is-ancestor d6a3032a HEAD`; `git merge-base --is-ancestor 3d3dcdc5 HEAD` | PASS, exit 0 each | Required handoff and underlying source checkpoints present |
| `node --version`; pinned `pnpm --version` | PASS, exit 0 each | Node24.19.0 and pnpm10.17.1 |
| Official Node22.19.0 download; version check | PASS, exit 0 each | Installed outside repository; first tar extraction exit 2 because ownership changes were disallowed; `--no-same-owner` extraction exit 0 |
| `pnpm install --frozen-lockfile` | BLOCKED by automatic approval review; no process exit code available | Stopped while downloading dependencies. Review reports an untrusted telemetry endpoint and unknown payload. Raw partial output: `.agent_workspace/cloud-continuation/install-node24.log` |
| `pnpm install --frozen-lockfile --offline --ignore-scripts --config.update-notifier=false` | FAIL, exit 1 | `ERR_PNPM_NO_OFFLINE_TARBALL`: missing `@earendil-works/pi-ai@0.86.1`; 176 packages reused, no downloads. Log: `install-node24-offline.log` in the same ignored directory |
| `pnpm gate` | FAIL, exit 1 | Workflow passes; typecheck stops at `sh: 1: tsc: not found`. Lint, tests and build do not execute. Log and exit record: `gate-node24.log`, `gate-node24.exit` |
| `pnpm install --frozen-lockfile --ignore-scripts --config.update-notifier=false --registry=https://registry.npmjs.org` with `CI=true` | BLOCKED by automatic approval review; no process exit code available | Attempted only after the read-only risk assessment below. Review again reports extra telemetry egress outside registry scope. No further install retries were made. Partial log: `install-node24-restricted.log` |
| `node scripts/workflow-check.mjs` | PASS, exit 0 | 10 required files / 16 required headings; process documentation only |
| `git diff --check` | PASS, exit 0 during preparation | Final evidence-only review/check results are recorded below |
| Linux Node22 full gate/probes/package | NOT RUN | Runtime available, but a complete dependency tree is unavailable. No Node24 installation/build was reused as Node22 evidence |
| Security / Pi / kernel-reuse probes; actual pack and SDK consumers | NOT RUN | Required gate/build prerequisite did not pass; no tarball or consumer success claimed |
| Windows verification | UNAVAILABLE | No Windows runtime. Linux results cannot close Windows process-stop/containment conditions |
| Paid provider, crash/benchmark/holdout opt-ins, production and external business writes | NOT RUN | Not authorized by this task |

## Behavioral Evidence

No runtime implementation, dependency definition, lockfile or assertion was changed. Work 1 has a current failed gate attempt, **not** a complete test run. The failure is dependency availability rather than evidence of a TypeScript/product defect. No test count or skipped-test count exists for this attempt because the suite was never entered.

The ordinary installer was not retried unchanged after rejection. A read-only agent checked the exact installed pnpm10.17.1 updater/ignore-scripts guards, the lockfile's registry-only resolutions, cached package manifests and the complete cached `pi-telemetry` runtime. That package has no install lifecycle hooks, runtime exporter or network sender. A manifest-only GET of the exact public `pi-ai@0.86.1` registry record also showed no install hooks. These facts justified the narrower script-disabled/update-disabled attempt; they did **not** identify the original rejected endpoint. The second rejection means no claim is made that the egress issue was resolved. The automatic reviewer supplied neither endpoint nor payload, so those are unknown, not silently assumed benign.

Read-only continuation findings, to avoid repeating investigation:

- Work 2 should add a trusted extension factory, a reference/token inspection tool and one existing closed-union request handler. Session already owns focus tokens, provenance deduplication, single-flight direct tasks and unsettled fencing. The extension must add real shutdown ownership and must not issue apply handles from direct results. Exact proposed interface and negative tests are in the [new slice plan](../superpowers/plans/2026-10-20-conversation-tools.md); it remains unimplemented.
- C3 can reuse `saveLoopArtifact`/`readLoopArtifact`, fresh controller queue/action reads and existing run deletion. Current direct tasks allocate a candidate/executor before the root run exists, so a saved final focus does not establish durable dispatch deduplication. A narrow recovery-only mode must refuse historical direct replay; broader recovery requires a precise write-ahead admission design using the existing ActionLedger. Source dirtiness as well as HEAD must invalidate old evidence. No C3 implementation or final design acceptance is claimed.
- Existing qualification already covers held tools and deferred `agent_end`; missing coverage is their integrated controlled-driver path. Both `managed-driver.test.ts` and `managed-qualification.test.ts` perform fresh internal TypeScript builds and must be serialized with every other full build/gate/package. No test was added without a runnable intended RED.

## Risks and Gates

### Concurrent remote evidence received before delivery

The final remote-head read found two concurrent documentation commits, `6e6f8a1` and `9b07195`, after the original `d6a3032a` intake. Their [final local acceptance record](2026-10-19-staged-continuation.md#final-local-acceptance-2026-10-20) reports Windows Node24.18.0 `pnpm gate` exit 0 (3978 pass / 0 fail / 48 skips), security26/Pi4/kernel3 and packed consumers passing. Those commits and findings are preserved during integration. They are separate local-executor evidence, not this cloud's command outputs; their ignored raw logs remain unavailable here. The new report resolves the previously missing *reported local outcome*, but cannot substitute for the requested fresh Linux Node24/Node22 verification or Windows containment. It does not implement Work 2/C3. This cloud's failed gate and dependency blocker remain unchanged.

Local handoff checkpoint `6d60b95` saved all seven documentation changes before integration. The only overlapping hunk was two new paragraphs at the same insertion point in `tasks/migration-todo.md`; resolution retains the remote Windows acceptance paragraph verbatim alongside the cloud Linux failure paragraph, with explicit platform distinction. There are no runtime/test/dependency changes between the concurrent remote commits. Independent read-only review covers the resulting documentation delta; no human conflict-hunk review, PR/main merge or product acceptance is claimed by this local integration. Required human conflict review remains a pre-merge condition for a later authorized PR/main integration.

| Blocker / owner | Impact | Condition to remove |
|---|---|---|
| Dependency egress approval — user/environment policy owner | Complete dependency installation and all runtime RED/GREEN/gates are blocked | Supply a complete trusted offline pnpm store for the exact lockfile, or explicitly authorize the reported extra egress after reviewing its endpoint/payload with the environment owner. Do not retry via another download/installer channel to evade rejection |
| Windows platform — Windows verification executor | Windows descendant stopping and isolation remain unverified | Run the planned actual process/lifecycle tests on Windows and retain exact commands/results |
| Historical ignored Windows logs — original local executor | Original third-run raw logs unavailable locally; reported Windows outcome now supplied above | Optional retrieval of the original log; it is not a prerequisite for a fresh cloud run |

Unknown telemetry payload could contain environment/project metadata. No secret was deliberately supplied by this work; that does not establish what the rejected request attempted to send. Source presence, current test acceptance and production/effect validation remain separate. No paid provider, main merge, release, adaptive activation or experiment gate is closed.

## Handoff

The first permitted next step is to resolve dependency access, not to change product assertions or fabricate a green gate. The safest exact command after a complete trusted cache is supplied is:

```powershell
$ErrorActionPreference = 'Stop'
Set-Location /workspace/scratch/a3b72c91ee58/pi-sparkle
$env:PATH = '/workspace/scratch/a3b72c91ee58/toolchain/pnpm10/node_modules/.bin:' + $env:PATH
$env:CI = 'true'
pnpm install --frozen-lockfile --offline --ignore-scripts --config.update-notifier=false
if ($LASTEXITCODE -ne 0) { throw 'offline dependency installation failed' }
pnpm gate
if ($LASTEXITCODE -ne 0) { throw 'current-candidate gate failed' }
```

Then sequentially run the three probes, actual pack and SDK consumer commands from the cloud plan; repeat in a separate Node22 checkout/install/build directory. If a required esbuild install step is missing, inspect its exact existing allowlisted script and local optional binary before executing anything; do not silently enable all lifecycle scripts. Only after Work 1 is established, start the Work 2 handler-level RED, implement minimally and independently review the actual diff.

Raw local logs remain ignored, as required; this tracked summary preserves commands, outcomes, limitations and the exact unblock condition. Final documentation review/commit is a handoff checkpoint, not an accepted implementation slice.

## Final evidence-only review

`pnpm workflow:check`, local Markdown-link validation over all seven changed files, `git diff --check` and `git diff --cached --check` passed with exit 0. Independent agent `platform_inventory` read the five tracked-file diffs and both new files, checked the actual gate/exit and installation logs, independently rechecked ancestry (exit 0), and validated relative links. It found one factual wording issue: pre-bootstrap discovery/checkout/read commands used Bash, so the original blanket PowerShell statement was corrected above; an explicit repository `Set-Location` was also added to the handoff command. The reviewer re-read the correction and closed the finding with no new findings. This review concerns documentation accuracy only. Automatic approval rejection reasons are retained from the root tool responses, not independently reproduced by the reviewer. No independent implementation or product acceptance is claimed.

MODEL_SLUG: claude-opus-5-thinking-high-fast

> **Filename collision, both reports kept.** Two parallel Round 3 tracks assign the
> slug `R3-opus-B`. This path already held the aux-features track's gate-closer
> report (committed in `2ef37dc`, branch `cursor/pi-adapt-aux-features-e1e3`); it is
> preserved verbatim in the second half of this file. The kernel-reuse track's report
> is first. Parent: split these if you want one report per file.

---

# Round 3 — R3-opus-B (kernel reuse): unskip `steer-inflight`, document cost-stop vs steer ordering

Targets 2 (test half) and 3 in `R2-KERNEL-BRIEF.md`, branch
`cursor/pi-kernel-reuse-e1e3`. Two source files touched. No cost-gate math changed.
No commit.

## `test/unit/pi-adapter/steer-inflight.test.ts`

The `test.skip("RunningRun.steer forwards in-flight text and rejects empty text")`
placeholder is gone, replaced by two real tests plus the fixture they need. There are
now no `test.skip` calls anywhere under `test/`.

I did not simply un-`skip` the stub, because the assertions it sketched
(`doesNotThrow` on a steer, `/non-empty/` on blank text) are already covered — and
covered better — by `test/integration/m0/steer.test.ts` against `GatedExecutor`.
Re-asserting them here with the same double would have bought a green line and no
information. What was actually missing is the seam this file is named for: nothing
proved that text accepted at the run level reaches a **kernel**. `GatedExecutor`
pushes steer strings onto an array; the hop from `SparkleKernel.steerText` into the
agent's steering queue is only exercised by the first test in this file, which never
goes near `RunningRun`.

So the fixture is `KernelBackedExecutor`: an `AgentExecutor` whose in-flight run is a
real `SparkleKernel` wrapping the file's existing `BlockingAgent`. A steer now has to
survive every hop to be observable — `RunningRun.steer` → `SteerChannel` →
`AgentExecutor.steerText` → `SparkleKernel.steerText` → `agent.steer(...)`.

- **`RunningRun.steer forwards in-flight text to the live kernel and rejects empty
  text`** — blank text throws `/non-empty/` at the run and the kernel's queue stays
  empty (refused, not accepted-then-dropped); `"change direction"` with
  `{ actor: "supervisor" }` lands in the agent's queue as a `role: "user"` message
  and as one `STEER_INJECTED` event carrying that actor and that text.
  `BlockingAgent.steer` throws unless a prompt is genuinely streaming, so *reaching*
  the queue is itself the in-flight assertion — no timing assertion needed.
- **`a steer refused by the kernel is not recorded as if the agent had received
  it`** — releases the prompt while leaving `execute()` in flight, which is the one
  state where the coordinator's window is open and the layer beneath it has nothing
  to steer. The kernel throws, and because `SteerChannel` delivers before it logs, no
  `STEER_INJECTED` is written. That is the delivery-before-logging invariant
  (`coordinator.ts` ~line 143) under test from the failing side; the integration
  suite only ever exercises its happy path.

The fixture mirrors `PiAgentExecutor.steerText`'s single-agent refusals. It does not
mirror the multi-agent one (`N agent runs are in flight and steering has no target`),
which is unreachable from a single `startRun` and belongs with the child-coordinator
tests.

`startRun` needs `mkdtemp` roots, which is heavier than the rest of
`test/unit/pi-adapter` allows itself but is normal elsewhere in `test/unit` (see
`run/event-store.test.ts`, `cli/doctor.test.ts`). The alternative — moving the file
to `test/integration/` — would have separated it from the kernel-level test it shares
`BlockingAgent` with, which is the pairing that makes the file readable.

## `src/pi-adapter/pi-executor.ts` (comment only)

At the `stopAfterTurn` install site in `runAttempt`, next to the existing "only
installed when the gate can actually price this model" note:

> the loop consults this hook *before* it drains the steering queue, so text steered
> during the turn that crosses the ceiling is dropped with the rest of the attempt
> rather than delivered. Reordering it would need a Pi fork. What makes the loss
> auditable is the pair of records already written: a `STEER_INJECTED` event, and a
> `TASK_RESULT` saying the run stopped at the cost ceiling.

The last sentence is the part worth keeping. The collision the brief flagged cannot
be fixed from this side, but it is not silent either: the two records exist and
disagree in a way an auditor can read — the log says the operator steered, the result
says the run stopped at its ceiling, and the transcript shows the steer was never
answered. Nothing claims the steer was delivered.

`kernel.ts` already states the mechanism on `SparkleKernelStopAfterTurn` ("queued
steering is not polled"). The new comment states the *consequence* at the only site
that installs such a hook, which is where someone debugging a swallowed steer will be
looking. I left `docs/kernel-reuse.md` alone — my brief said to prefer the adapter,
and the docs are contended this round.

## Not done (out of scope, flagged for whoever holds them)

- **Target 1**, wiring `run.limits.maxCostUsd` into `AgentExecutionRequest`, is
  untouched by me. Unless a sibling landed it, live runs are still uncapped; do not
  let the docs say otherwise.
- **The reorder itself.** Draining steering before consulting the stop hook is a Pi
  loop change. A Sparkle-side approximation — have `steerText` reject once
  `gate.stopRequested` has latched — would convert a silent drop into a refusal the
  operator sees. It is a real improvement and I did not take it: it changes when
  steering fails, which is coordinator-visible behavior, and my brief scoped me to
  documenting the ordering.

## Verification

- `pnpm exec tsc --noEmit --pretty false` — clean.
- `pnpm exec eslint` on both touched files — clean.
- `node scripts/run-tests.mjs test/unit/pi-adapter/steer-inflight.test.ts` — 3 pass,
  0 fail, **0 skipped** (was 1 skipped).
- Full `node scripts/run-tests.mjs test` — 1445 tests, 1444 pass, 0 fail, 1 skipped.
  The remaining skip is `provider-smoke.test.ts` self-skipping without `PI_SMOKE=1`,
  as described in the aux-features report below. Note the tree is shared with the
  other Round 3 agents, so this count includes their in-progress edits.

One earlier iteration failed `tsc`: `assert.deepEqual(queue, [])` has an
`asserts actual is T` signature, so the empty literal narrowed the queue to `never[]`
and poisoned the later element assertions. Replaced with a length check.

---
---

# Round 3 — R3-opus-B (quality gate closer)

*(Preserved from commit `2ef37dc`, aux-features track. Everything below predates the
kernel-reuse work above; its test counts are from that tree.)*

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

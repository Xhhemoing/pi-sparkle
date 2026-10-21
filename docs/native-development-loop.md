# Bounded native development

`NativeWriteSession` can repair a failed candidate in the **same retained Git
worktree**. This is a host SDK API; neither `sparkle_delegate` nor the default
CLI silently becomes a writer. No candidate is applied automatically.

## Runnable mechanism check

```sh
pnpm build
node examples/native-repair-demo.mjs
```

The offline demo uses real Git worktrees and real command checks, with a
scripted executor. It deliberately fails addition on its first attempt and
fixes it on its second. The final JSON includes attempt/run/artifact references,
the retained candidate location and `sourceUnchanged: true`. It uses no provider
credentials, and it does not measure model effectiveness.

## Host API

```ts
const session = new NativeWriteSession({
  stateRoot,
  sandboxRoot,
  executorFactory: async ({ tools, signal, attempt }) => {
    // Create your AgentExecutor through the existing Pi adapter here.
    // Give it these candidate-scoped tools and a prompt containing the goal
    // and attempt?.previous (bounded, untrusted command output).
    // The factory and executor must cooperate with signal cancellation.
    return buildExecutor({ tools, signal, attempt });
  }
});

const result = await session.execute({
  sourceRepo,
  objective: "Implement one predeclared behavior",
  verification: { command: trustedChecker, args: trustedArguments },
  maxAttempts: 3,
  maxWallTimeMs: 600_000,
  signal
});
await session.shutdown();
```

`buildExecutor`, `trustedChecker` and the other host variables above are
integration placeholders, not new exported functions. Existing
`createConfiguredPiExecutor` supplies the Pi adapter; candidate tools must be
preserved when constructing it. `attempt.previous` has the previous run and
artifact IDs, exit code and bounded stdout/stderr with total byte lengths.
Passing feedback to an LLM does not give it permission to alter host policy.

| Setting or result | Contract |
|---|---|
| No new options | Existing one-attempt behavior |
| `maxAttempts` | Integer 1–5; default 1; explicit setting opts into loop metadata |
| `maxWallTimeMs` | Integer 1–1,800,000; opt-in default `min(maxAttempts × 360000, 1800000)` |
| `attempt` | Frozen attempt number, max attempts and optional frozen prior feedback |
| `result.loop.attempts` | Ordered run/artifact references for attempts actually performed |
| `result.loop.artifact` | Persisted terminal loop summary under the final run |
| `result.loop.stopReason` | accepted, attempt-limit, no-progress, cancelled, time-budget, executor-failed, verification-unavailable, snapshot-unavailable or source-changed |

Repair requires a command that actually completed with a nonzero exit code and
compatible pre/post check metadata. Legacy check records without process status,
spawn errors, timeouts, output overflow and cancelled checks do not authorize
another coding attempt. Consecutive failed candidates with equal changed-file
bytes stop as no progress. Comparing progress is bounded to 256 changed paths
and 4 MiB, rejects linked/nonregular paths and stops if it cannot capture a
usable snapshot. Snapshots remain in memory and are not a new persisted store.

The wall deadline requests cooperative cancellation; it cannot preempt arbitrary
JavaScript supplied by a host factory. The command runner separately bounds
graceful/forceful process shutdown. On Windows it terminates the direct child;
complete descendant containment needs a host OS facility. A successful command
is evidence for its declared checks, not proof of every requirement.

These loop limits cover attempts and time, not a dollar ledger spanning repair
attempts. A Pi executor's model-chain ceiling applies to that execution and is
checked after turns, so one turn can exceed it. Unpriced or missing usage cannot
be treated as a complete billed amount. Hosts needing a session-wide spending
guarantee must account for all attempts externally before enabling more work.

## Continuing across tasks and sessions

Persist task goals, dependencies, acceptance criteria, source revision,
candidate/run/artifact references and the next concrete command. Select a new
task only after its dependencies are accepted. Use the existing plan/checklist
and [development workflow](development-workflow.md), with one reviewable change
per slice. Independent review and CI can add evidence; an agent's SUCCESS text
cannot advance a project backlog by itself.

This API does not resume the repair loop after a process crash. Inspect retained
artifacts and reconcile the candidate first. Replaying an unknown external
operation can duplicate side effects. Automatic application, policy promotion,
live routing experiments and release publication retain their existing separate
authorization/evidence boundaries. See the
[architecture review and next queue](reports/2026-10-15-architecture-agent-loop.md).

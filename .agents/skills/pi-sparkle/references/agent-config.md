# Agent Configuration Diagnosis

Use this reference for an observed dispatch failure or a concrete discrepancy
between the requested role and the configuration actually loaded.

## Follow the failure

- Start with the relevant error, invocation, and task outcome. Existing
  `.pi/subagents/runs/` records may help where present and within scope; do not
  assume that path or telemetry exists in every installation.
- Resolve the requested name against the current loaded profiles, dispatch
  implementation, and applicable project instructions. Record missing names
  and unavailable capabilities explicitly; do not invent a substitute agent,
  successful review, or delegation result.
- Compare role definitions and tool allowlists only where necessary for the
  reported problem. Differences across projects can be intentional boundaries,
  rather than drift. Do not scan unrelated projects by default.
- Keep model, thinking effort, tool permissions, and dispatch-name failures
  distinct. Verify current supported settings before changing them.

## Correct within authorization

A stale spawn reference may warrant a scoped caller correction or restoration
of an intended profile, after checking current role semantics and authorization.
Do not add a broadly privileged profile merely to silence `Unknown agent`,
weaken name validation, or turn every diagnosis into a new preflight gate.
Use an available declared review role when appropriate; never assume a
historical agent name is valid in the current registry.

Successful execution does not justify widening a tool allowlist or copying
permissions from another project. Installing or loading this package grants
no credential, permission, allowlist, promotion, or learning authority. Keep
existing safety boundaries and owner decisions intact.

## Verify proportionally

Inspect an authorized configuration diff and use the smallest existing check
that exercises the affected resolution path. Run a fresh dispatch only when
within the task's execution and cost authorization; a real-provider run remains
opt-in. Report an unavailable check or missing profile as unknown, skipped, or
blocked, with its effect on the requested result. Stop after the scoped failure
is resolved and verified, or after identifying the evidence needed to proceed.

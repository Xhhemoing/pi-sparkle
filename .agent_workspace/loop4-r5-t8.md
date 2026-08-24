gpt-5.6-sol

# Loop 4 · Round 5 · R5-8 — Resume executor wire witness

Result: **PASS**

Baseline: requested HEAD `6975aabe65169671dfa6562979b60a0f0a47c62f` on
`agent/opt-continuous`. No checkout or commit was performed. Concurrent shared-tree
work advanced HEAD after this slot started; this slot changed only the owned
loopback test and this report.

## Change

- Extended `test/integration/pi-adapter/loopback-cli-resume.test.ts` only. No
  `src/**` change or protocol adapter change was needed.
- The provider fixture now configures `loopback/loopback-2` as the distinct
  ambient primary/fast default while resume explicitly passes
  `--primary-model loopback/loopback-1 --thinking high`.
- The flowchart resume asserts the loopback server's recorded HTTP request has
  `model: "loopback-1"`, `reasoning_effort: "high"`, and `stream: true`.
  The initial flag-free request pins that `reasoning_effort` is absent.
- Added a reachable supervised-resume witness. A test executor leaves a real
  supervised task leased, then CLI `resume --supervised --executor pi` rebuilds
  the Pi executor. The server receives exactly one request for
  `loopback-1`, not the configured default `loopback-2`, with
  `reasoning_effort: "high"`.
- The supervised result is intentionally `BLOCKED`/exit 1 after the request:
  Pi synthesizes `UNOBSERVED` verification for the loopback's plain-text
  response, so the deterministic judge cannot approve it. This does not limit
  the wire witness.

Thinking level is observable for this reasoning-capable OpenAI-compatible
fixture, so the test pins its concrete wire representation,
`reasoning_effort: "high"`, rather than relying only on structural forwarding.

## Stderr expectation disclosure

Per the `74daff3` lesson, the existing exact stderr expectation was deliberately
updated. That commit pinned the flag-free default-rebuild `warning:`. The
fixture now passes executor flags, so its sole accepted stderr line is the exact
R4-6 `note:` saying the executor was rebuilt with primary model
`loopback/loopback-1` and thinking `high`, and that this is the configuration
requested now rather than persisted run configuration. The supervised witness
pins the same exact line.

## Verification

- Scoped ESLint on the changed integration test: **exit 0**.
- Whole-tree `pnpm typecheck` (`tsc --noEmit`): **exit 0**. pnpm emitted the
  existing environment warning that Node 22.14.0 is below the declared
  `>=22.19.0`; type checking still completed cleanly.
- Timing-sensitive loopback test file: **3/3 runs passed**; each run passed both
  the flowchart and supervised resume tests with no skips.
- Complete `test/integration/pi-adapter/*.test.ts` suite: **7 passed, 0 failed,
  1 skipped**. The sole skip is the expected real-provider test gated by
  `PI_SMOKE=1`.
- `git diff --check`: **exit 0**.


MODEL_SLUG: gpt-5.6-sol-xhigh-fast

# Round 1 — R1-gpt-A

## How to run

```sh
node scripts/pi-compat-probe.mjs
node scripts/pi-latest-check.mjs
node scripts/pi-latest-check.mjs --json
PI_COMPAT_OFFLINE=1 node scripts/pi-latest-check.mjs
node scripts/pi-latest-check.mjs --strict
```

`--offline` is equivalent to `PI_COMPAT_OFFLINE=1`. The latest-version probe
also accepts `PI_COMPAT_REGISTRY_URL` for a mock registry.

## Observed output

### `node scripts/pi-latest-check.mjs`

```text
PINNED @earendil-works/pi-agent-core: 0.84.3
LATEST @earendil-works/pi-agent-core: 0.84.3
STATUS @earendil-works/pi-agent-core: up-to-date
PINNED @earendil-works/pi-ai: 0.84.3
LATEST @earendil-works/pi-ai: 0.84.3
STATUS @earendil-works/pi-ai: up-to-date
PINNED @earendil-works/pi-coding-agent: (not pinned)
LATEST @earendil-works/pi-coding-agent: 0.84.3
STATUS @earendil-works/pi-coding-agent: unpinned
```

Exit code: 0.

### `node scripts/pi-compat-probe.mjs`

```text
PASS pin @earendil-works/pi-agent-core: 0.84.3
PASS pin @earendil-works/pi-ai: 0.84.3
PASS legacy identifier GoogleThinkingLevel is absent from src/pi-adapter
PASS ThinkingLevel imports use @earendil-works/pi-agent-core only (2 found)
```

Exit code: 0.

## Leftover

The npm registry remains an external, potentially flaky dependency. A timeout
or network failure reports `unknown` and exits 0 for normal probe use; strict
mode exits 1. Offline mode skips registry access and exits 0.

## Round 2

Optionally add npm scripts for these probes after the package/lockfile owner
agrees on names and integrates the change.

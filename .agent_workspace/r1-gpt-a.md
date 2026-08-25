model: gpt-5.6-sol-xhigh-fast

# R1-gpt-A — live security + Pi probes

## Result

- Status: `ok`
- Open findings: none
- Security probe edited: no
- `pnpm install --frozen-lockfile`: skipped because `node_modules/.bin/tsc` was present and the environment install status was `0`
- Runtime: Node `v22.14.0`; pnpm `10.17.1`
- Environment caveat: every pnpm command warned that Node `v22.14.0` does not satisfy the declared engine `>=22.19.0`

## Commands and exit codes

### `pnpm build`

Exit code: `0`

```text
 WARN  Unsupported engine: wanted: {"node":">=22.19.0"} (current: {"node":"v22.14.0","pnpm":"10.17.1"})

> pi-sparkle@0.1.0 build /workspace
> tsc -p tsconfig.build.json
```

### `node scripts/security-probe.mjs`

Exit code: `0`

Exact JSON:

```json
{
  "status": "ok",
  "passed": 14,
  "openFindings": [],
  "waivedFindings": []
}
```

### `pnpm pi:probe`

Exit code: `0`

```text
 WARN  Unsupported engine: wanted: {"node":">=22.19.0"} (current: {"node":"v22.14.0","pnpm":"10.17.1"})

> pi-sparkle@0.1.0 pi:probe /workspace
> node scripts/pi-compat-probe.mjs

PASS pin @earendil-works/pi-agent-core: 0.84.3
PASS pin @earendil-works/pi-ai: 0.84.3
PASS legacy identifier GoogleThinkingLevel is absent from src/pi-adapter
PASS ThinkingLevel imports use @earendil-works/pi-agent-core only (1 found)
```

### `pnpm pi-compat`

Exit code: `0`

```text
 WARN  Unsupported engine: wanted: {"node":">=22.19.0"} (current: {"node":"v22.14.0","pnpm":"10.17.1"})

> pi-sparkle@0.1.0 pi-compat /workspace
> tsx src/cli/main.ts pi-compat

pi-sparkle pi-compat (developer preview — Pi pin vs adapter contract)
  generated: 2026-08-25T15:54:06.846Z
  mode: offline (pass --online to read npm dist-tags)
  pinned: agent-core=0.84.3 ai=0.84.3
  latest: skipped (offline)
  adapter: google-thinking=absent thinking-levels=off,minimal,low,medium,high,xhigh,max
  adapter: nested-skill-discovery=yes agents-md-not-broken-skill=yes
  status: unknown
  findings:
    - offline compatibility check has no latest Pi versions to compare
  next: pnpm cli pi-compat --online compares the pins against the npm registry
```

The `unknown` status is the expected offline freshness status, not an adapter-contract failure; the command exited `0`.

### `pnpm pi-compat --json`

Exit code: `0`

Exact JSON:

```json
{"generatedAt":"2026-08-25T15:54:12.845Z","offline":true,"pinned":{"agentCore":"0.84.3","ai":"0.84.3"},"adapter":{"thinkingLevels":["off","minimal","low","medium","high","xhigh","max"],"googleThinkingType":"absent","nestedSkillDiscovery":true,"agentsMdNotBrokenSkill":true},"status":"unknown","findings":["offline compatibility check has no latest Pi versions to compare"]}
```

## Requested security boundaries

All boundary samples were exercised against built `dist/feedback/redaction.js` and passed value-removal checks:

- PEM private-key payload: removed
- Bearer token payload: removed
- `api_key=` value: removed
- Windows UNC path: removed
- CN phone `13812345678`: removed
- Luhn-valid card `4111111111111111`: removed

No false positive or other probe defect was observed, so `scripts/security-probe.mjs` was not changed.

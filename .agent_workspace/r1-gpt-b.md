model: gpt-5.6-sol-xhigh-fast

# R1-gpt-B — preview-release probe

## Script

`scripts/preview-release-probe.mjs`

The probe is repository-relative, performs only file reads, prints one JSON
document, and exits `1` whenever any automated preview invariant is blocked.
It checks:

- `package.json` has `private: true`
- `engines.node` is a non-empty semver range
- `bin.pi-sparkle` is exactly `dist/cli/main.js`
- `docs/specs/release-gate.md` contains a Markdown `Status` heading
- `pnpm-workspace.yaml` exists as a file

Unreadable or malformed inputs are blocking rather than skipped.

## Verification

Command:

```bash
node --check scripts/preview-release-probe.mjs && node scripts/preview-release-probe.mjs
```

Exit code: `0`

Output:

```json
{
  "status": "ok",
  "findings": [
    {
      "check": "package-private",
      "status": "ok",
      "detail": "package.json private is true"
    },
    {
      "check": "node-engine",
      "status": "ok",
      "detail": "package.json engines.node is \">=22.19.0\""
    },
    {
      "check": "bin-path",
      "status": "ok",
      "detail": "package.json bin.pi-sparkle points to dist/cli/main.js"
    },
    {
      "check": "release-gate-status",
      "status": "ok",
      "detail": "docs/specs/release-gate.md contains a Status heading"
    },
    {
      "check": "pnpm-workspace",
      "status": "ok",
      "detail": "pnpm-workspace.yaml exists"
    }
  ]
}
```

## Recommended wiring

Parent should expose the probe as a standalone package script for focused
diagnostics, then invoke that script first in `prerelease` so cheap metadata
failures stop the expensive gate immediately:

```json
{
  "scripts": {
    "preview:probe": "node scripts/preview-release-probe.mjs",
    "prerelease": "pnpm preview:probe && pnpm gate && pnpm security:probe && pnpm pi:probe"
  }
}
```

Round 1 intentionally leaves `package.json` unchanged. If parent chooses only
one integration point, include the probe in `prerelease`; standalone-only
wiring would allow the release path to bypass these blockers.

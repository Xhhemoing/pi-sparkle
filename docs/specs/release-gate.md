# Release gate

`pnpm prerelease` is the release bar. It is four commands in sequence:

```bash
pnpm preview:probe     # cheap developer-preview invariants
pnpm gate            # typecheck && lint && test && build
pnpm security:probe  # node scripts/security-probe.mjs, against the built dist/
pnpm pi:probe        # node scripts/pi-compat-probe.mjs, adapter/pin contract
```

CI (`.github/workflows/ci.yml`) runs the quality job on pushes to `main` and
pull requests targeting it. After that job builds `dist/`, it runs
`pnpm security:probe` with no `SECURITY_WAIVER`; packaged-secret and redaction
failures are therefore continuously enforced. The pi compatibility result
below remains a **local, dated claim**; re-run it before treating it as current.

## Status: GREEN — 2026-08-25

Live evidence, branch `cursor/merge-preview-release-8011`, Node `v22.14.0`,
pnpm `10.17.1`, re-run after the screaming-snake secret samples landed:

```console
$ pnpm build && node scripts/security-probe.mjs
{
  "status": "ok",
  "passed": 16,
  "openFindings": [],
  "waivedFindings": []
}
exit 0

$ node scripts/pi-compat-probe.mjs
PASS pin @earendil-works/pi-agent-core: 0.84.3
PASS pin @earendil-works/pi-ai: 0.84.3
PASS legacy identifier GoogleThinkingLevel is absent from src/pi-adapter
PASS ThinkingLevel imports use @earendil-works/pi-agent-core only (1 found)
exit 0
```

No `SECURITY_WAIVER` was set for that run: `waivedFindings` is empty because
nothing failed, not because anything was suppressed.

| id | what it proved on 2026-08-25 |
|---|---|
| `pii-redaction` | 9 samples (email, IPv4, `+1` phone, CN mobile, Luhn-valid card, unix/macOS/Windows/UNC paths) — no core survives `redactFeedback` with `redactPII: true` |
| `secret-bodies` | 6 samples (`sk-proj-…`, `api_key=…`, `DATABASE_PASSWORD=…`, `API_TOKEN=…`, `Bearer eyJ…`, PEM private-key body) — the value is removed, not just the prefix |
| `packaged-secrets` | 233 text files of the 451-entry `npm pack --dry-run` list scanned; no credential pattern matched |

### What GREEN does not mean

- It is **not** a release authorization. `package.json` keeps `private: true`,
  the P0 privacy sign-off is still open, ADR-006 stays Proposed, and F-PROD has
  not started. Nothing here is Outcome-supported.
- The probe imports `dist/feedback/redaction.js`. A green result is only valid
  for the `dist/` that was built from the current redaction source — **run
  `pnpm build` immediately before `pnpm security:probe`**, or the result
  describes an artifact nobody is shipping.
- The run above was on Node `v22.14.0` while `engines.node` declares
  `>=22.19.0`. pnpm warns (`WARN Unsupported engine`) and continues; the
  supported-Node result is unverified here.

### History

- **2026-08-22 — BLOCKED.** `pii-redaction` and `secret-bodies` were open:
  `redactFeedback` labelled records but left email/IP/phone/card/path values in
  the body, and secret stripping removed only literal prefixes such as `sk-`.
- **Closed by** the value-removing transforms in `src/feedback/redaction.ts`
  (`9ceaad8`, then `d4b16e1`): PEM blocks, `Bearer`, vendor key shapes, JWTs and
  keyed `name=value` assignments collapse to `[secret]`; home/`.ssh`/Windows/UNC
  paths to `[path]`; email/IPv4/phone/Luhn-valid card to their placeholders.
  `test/unit/feedback/redaction.test.ts` pins the same gate cores against `src/`
  so a regression fails `pnpm test` before it reaches the probe.
- **2026-08-25 — re-verified GREEN after opus-A** added the two
  screaming-snake `secret-bodies` samples: 16 checks passed with no open or
  waived findings.

## Waivers

A finding may be time-boxed waived for a specific release:

```bash
SECURITY_WAIVER="pii-redaction,secret-bodies" pnpm prerelease
```

Rules:

1. A waiver MUST be recorded below with reason + expiry before use.
2. Waivers are per-release; they do not close the finding.
3. `packaged-secrets` findings are **never waivable** — credential material
   in the artifact is an unconditional block.

Rule 3 is enforced in code: `scripts/security-probe.mjs` only waives a finding
when its id is not `packaged-secrets`. A packaged-credential finding remains
open and blocks the probe even when `SECURITY_WAIVER` includes that id.

### Waiver register

(empty)

## Preview preflight

`scripts/preview-release-probe.mjs` checks cheap developer-preview invariants
(`private: true`, a non-empty `engines.node`, the `bin` path, a Status heading
in this file, `pnpm-workspace.yaml`). It is the first command in `prerelease`,
so a failed preview preflight stops the rest of the release bar.

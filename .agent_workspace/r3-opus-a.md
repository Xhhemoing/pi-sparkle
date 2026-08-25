model: claude-opus-5-thinking-high-fast

# R3-opus-A — screaming-snake secret names

**Branch:** `cursor/merge-preview-release-8011` (no git operations performed; working tree only)
**Date:** 2026-08-25

## The miss, reproduced first

`KEYED_SECRET_NAMES` was wrapped in `\b...\b`. `_` is a word character, so there is no
word boundary between `DATABASE_` and `PASSWORD`, and the keyed-assignment rules never
fired on the screaming-snake family. Reproduced against the pre-fix source:

```
"DATABASE_PASSWORD=hunter2-prod-db" -> "DATABASE_PASSWORD=hunter2-prod-db"
"API_TOKEN=abc123def456ghi789"      -> "API_TOKEN=abc123def456ghi789"
"api_key=xyz1234"                   -> "api_key=[secret]"     (only the lowercase form worked)
```

This is the shape a credential actually arrives in: an env dump or a `.env` excerpt pasted
into a feedback body. The store policy's needles (`sk-`, `api_key`, `API_KEY`,
`BEGIN PRIVATE`) do not appear anywhere in a `DATABASE_PASSWORD=` line, so nothing else in
the pipeline was removing these values — they were persisted in full.

## Fix (`src/feedback/redaction.ts`)

Replaced the `\b` boundaries around the keyed-name alternation with an explicit
letter/digit boundary, factored into one prefix both keyed rules share:

```ts
const SECRET_NAME_OPEN = "(?<![A-Za-z0-9])";
const SECRET_NAME_CLOSE = "(?![A-Za-z0-9])";
const KEYED_SECRET_PREFIX = `${SECRET_NAME_OPEN}(?:${KEYED_SECRET_NAMES})${SECRET_NAME_CLOSE}"?'?\\s*[:=]\\s*`;
```

`KEYED_SECRET_NAMES` itself is unchanged — the bug was the boundary, not the vocabulary.

What this deliberately does **not** do: it does not allow trailing name segments before
the delimiter (`(?:[_-][A-Za-z0-9]+)*`). That variant would redact `TOKEN_COUNT: 512` and
`output_tokens: 1024`, which are ordinary prose in this repo's own feedback. Only the last
segment of a name is matched, which is enough for every env-dump form and costs no
new over-redaction. The comment in the source says so.

Scope of the widening, pinned by tests:

| Input | Before | After |
|---|---|---|
| `DATABASE_PASSWORD=hunter2-prod-db` | survives | `DATABASE_PASSWORD=[secret]` |
| `API_TOKEN=abc123def456ghi789` | survives | `API_TOKEN=[secret]` |
| `X_AUTH_TOKEN: abcd1234efgh` | survives | `X_AUTH_TOKEN: [secret]` |
| `PI_CLIENT_SECRET=0123456789abcdef` | survives | `PI_CLIENT_SECRET=[secret]` |
| `DB_PASSWORD="p@ssw0rd!"` | survives | `DB_PASSWORD="[secret]"` |
| `redis.password = swordfish99` | redacted | unchanged behaviour |
| `TOKEN_COUNT: 512` | untouched | untouched |
| `MAX_TOKENS=4096` | untouched | untouched |
| `mypassword=notasecretname` | untouched | untouched |

Placeholders and idempotence are intact. The name prefix (`DATABASE_`) survives so the
shape stays reviewable, and the existing placeholder lookahead still blocks a second pass
from re-wrapping `DATABASE_PASSWORD=[secret]`. Pinned by
`screaming-snake redaction is idempotent`.

## Probe samples (`scripts/security-probe.mjs`)

Two `secret-bodies` samples added, nothing else touched. `packaged-secrets` remains
never-waivable (`finding.probe !== "packaged-secrets"` in the waiver predicate is
unchanged), and the policy literal is unchanged.

```js
{ id: "secret-bodies", name: "screaming-snake-password-value",
  body: "DATABASE_PASSWORD=hunter2-prod-db", core: "hunter2-prod-db" },
{ id: "secret-bodies", name: "screaming-snake-token-value",
  body: "API_TOKEN=abc123def456ghi789", core: "abc123def456ghi789" },
```

Sample count: **13 -> 15**. Probe `passed` count: **14 -> 16** (15 redaction samples plus
the one `packaged-secrets` scan entry).

The Round 1 drift guard sees both. Verified two ways rather than assumed:

1. Parsed `redactionSamples` with the guard's own literal parser: 15 samples, both new
   names present with the right cores.
2. Renamed one `GATE_CORES` pin and re-ran the file — the guard failed with
   `security-probe.mjs sample "screaming-snake-token-value" has no GATE_CORES pin — add one`.
   Pin restored; suite green again.

## Tests

- `test/unit/feedback/redaction.test.ts` — two new `GATE_CORES` pins (body, core, expected
  output, class list) so the drift guard is satisfied verbatim, plus three new tests:
  the screaming-snake/kebab matrix, the negative matrix (`TOKEN_COUNT`, `MAX_TOKENS`,
  `mypassword`, `output_tokens` must survive with **no** classes), and idempotence.
- `test/unit/privacy/redaction.test.ts` — the same two pins against
  `FEEDBACK_REDACTION_POLICY` (the *shipped* store policy, which has no `Bearer` needle),
  plus `screaming-snake env assignments lose their values under the store policy`, which
  checks the serialized record (body **and** summary), not just `body`.

## Verification run

Node v22.14.0 locally (below the 22.19.0 engines floor — pnpm warns; R3-gpt-A is pinning
CI to 22.19.0, which is the host that certifies this).

| Command | Result |
|---|---|
| `pnpm typecheck` | clean |
| `pnpm test` | 2135 tests, 2134 pass, 1 skip, **0 fail** |
| `pnpm lint` | clean |
| `pnpm build` | clean |
| `node scripts/security-probe.mjs` | `{"status":"ok","passed":16,"openFindings":[],"waivedFindings":[]}` |

Negative control, so the new samples are not decorative: I patched the built
`dist/feedback/redaction.js` back to the `\b` boundary and re-ran the probe. It went
`BLOCKED` with exactly the two new findings (`screaming-snake-password-value`,
`screaming-snake-token-value`, both "sensitive payload survives redaction"), `passed: 14`,
exit 1. `dist/` was then restored and rebuilt from source; the tree is clean of that edit.

## For R3-gpt-B (release-gate.md re-date)

The GREEN line needs a new date and count. Use:

- **Date:** 2026-08-25
- **Command:** `node scripts/security-probe.mjs` (run after `pnpm build`, against `dist/`)
- **Result:** `status: ok`, `passed: 16`, `openFindings: []`, `waivedFindings: []`
- **Samples:** 15 redaction samples — 9 `pii-redaction`, 6 `secret-bodies` (was 13/9/4)
- **Delta to cite:** added `screaming-snake-password-value` and
  `screaming-snake-token-value` under `secret-bodies`
- Rule 3 is unchanged and still enforced in code: `packaged-secrets` is excluded from the
  waiver predicate, so `SECURITY_WAIVER` cannot suppress it. Do not weaken that.

## Files written

- `src/feedback/redaction.ts`
- `scripts/security-probe.mjs` (two `secret-bodies` samples only)
- `test/unit/feedback/redaction.test.ts`
- `test/unit/privacy/redaction.test.ts`
- `.agent_workspace/r3-opus-a.md`

Not touched: `src/cli/`, `.github/workflows/`, `docs/specs/release-gate.md`,
`package.json`. No git commit, push, or checkout.

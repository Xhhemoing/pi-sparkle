model: claude-opus-5-thinking-high-fast

# R1-opus-B — release-gate spec honesty + preview readiness

## Headline

`docs/specs/release-gate.md` moves from **BLOCKED (2026-08-22)** to:

> **## Status: GREEN — 2026-08-25**

The 2026-08-22 findings (`pii-redaction`, `secret-bodies`) are closed by live
evidence, not by assertion. The waiver register stays `(empty)`; no waiver was
recorded and none was used.

## Evidence I ran (not inherited)

Branch `cursor/merge-preview-release-8011`, Node `v22.14.0`, pnpm `10.17.1`,
`src/feedback/redaction.ts` unmodified in the worktree at `d4b16e1`.

| command | exit | result |
|---|---|---|
| `pnpm build` | 0 | `tsc -p tsconfig.build.json` |
| `node scripts/security-probe.mjs` | 0 | `{"status":"ok","passed":14,"openFindings":[],"waivedFindings":[]}` |
| `node scripts/pi-compat-probe.mjs` | 0 | 4 PASS |
| `pnpm typecheck` | 0 | — |
| `pnpm lint` | 0 | — |
| `pnpm test` (15:55 UTC) | 0 | 2070 tests, 2069 pass, 0 fail, 1 skipped |
| `node scripts/preview-release-probe.mjs` (gpt-B's) | 0 | 5/5 ok against my rewritten spec |

Re-ran the security probe at 15:58:55Z after siblings had been writing: still
`ok`, and `git diff src/feedback/redaction.ts` is still empty. This matches
`.agent_workspace/r1-gpt-a.md` independently (same JSON, same 14 passed).

The one skipped test is the opt-in real-provider smoke. The 233-of-451 file
count in the spec's `packaged-secrets` row is from `npm pack --dry-run --json`
at the same time.

**Freshness rule that matters:** the probe imports `dist/feedback/redaction.js`.
GREEN is pinned to a `dist/` built from the *current* redaction source. If
opus-A lands a change to `src/feedback/redaction.ts`, `pnpm build &&
node scripts/security-probe.mjs` must be re-run before anyone quotes this status.
Both docs say so in place.

## What I changed

### `docs/specs/release-gate.md` (rewritten)

- Status is GREEN with the commands, exit codes, verbatim JSON, date, Node/pnpm
  versions, and the source SHA the claim is pinned to.
- Per-probe table of what each id actually proved (9 PII samples, 4 secret
  samples, the pack scan).
- New **"What GREEN does not mean"**: not a release authorization; `private:
  true` stays; P0 privacy open; ADR-006 Proposed; F-PROD not started; nothing
  Outcome-supported; result came from an off-pin Node.
- Corrected two stale statements: `pnpm prerelease` is **three** bars
  (`gate && security:probe && pi:probe`), not two, and **CI runs neither probe** —
  `ci.yml` is typecheck/lint/test/build plus a CLI smoke, so probe status is a
  dated local claim.
- History section keeps the 2026-08-22 BLOCKED record and names what closed it
  (`9ceaad8`, `d4b16e1`).
- Waiver register unchanged: `(empty)`.
- `scripts/preview-release-probe.mjs` is listed under **"Not yet a bar"**,
  described as unwired, so the spec does not imply a gate that does not exist.

### `docs/reports/2026-08-20-developer-preview-readiness.md`

Original 2026-08-20 snapshot kept verbatim as the dated record, with a
"partly superseded" banner pointing at a new **2026-08-25 addendum — 内测
operator brief** covering:

- Gate commands, including `pnpm build` *before* `pnpm security:probe`, and the
  live per-bar result table with the 15:55 UTC timestamp.
- Node pin: `>=22.19.0` declared, `v22.14.0` here, exact pnpm `WARN Unsupported
  engine` text, no `.npmrc` so `engine-strict` is off, CI uses `22.x` which does
  satisfy. Guidance: run the 内测 on `>=22.19.0` and disclose off-pin runs.
- Fake vs pi: fake is the default, plus the two traps operators hit first —
  plain `--children` starts with `skipContract: true` so the coverage gate never
  fires, and `--max-cost-usd` on the fake executor is recorded and forwarded but
  **not enforced**. Real path is opt-in; smoke needs `PI_SMOKE=1` + credentials.
- Still open: ADR-006 Proposed, P0 privacy human sign-off (explicitly: the gate
  going GREEN does **not** close P0), F-PROD not started so nothing is
  Outcome-supported, retention unbounded.
- Corrected the 2026-08-20 governance list, which said "ADR-004 remains
  Proposed" — ADR-004 and the six adaptive defaults were Accepted/Approved
  2026-08-21 per the status-matrix policy-gates table; ADR-006 is the open one.

### `test/unit/feedback/release-gate-policy.test.ts` (new, 5 tests, all pass)

Pins the release-gate **policy**, deliberately asserting nothing about redaction
behaviour, so it cannot collide with opus-A:

1. Every finding id the probe can emit (parsed from `scripts/security-probe.mjs`
   — today `pii-redaction`, `secret-bodies`, `packaged-secrets`) is documented in
   the spec. A new probe id without a doc entry fails the suite.
2. The spec carries a Status heading matching the same regex
   `scripts/preview-release-probe.mjs` uses, and that heading states GREEN or
   BLOCKED **and** a date.
3. A GREEN status must cite both probe scripts and the `"openFindings": []`
   output — an undated or unevidenced GREEN cannot be typed in.
4. The waiver register is `(empty)` or a table with an expiry column.
5. Spec and probe name the same `SECURITY_WAIVER` switch, and the
   `packaged-secrets` never-waivable rule is still in the spec.

Mutation-checked: weakening the never-waivable sentence, dropping the date from
the status line, or emptying the register each flips the corresponding
assertion to failure. `pnpm typecheck` and `eslint` are clean on the file.

## Requests for parent / other slots

1. **Real spec-vs-code gap (probe owner, `scripts/security-probe.mjs`).** The
   spec says `packaged-secrets` is never waivable; the code does not enforce it.
   The `effective` filter applies `SECURITY_WAIVER` to *every* failure, so
   `SECURITY_WAIVER="packaged-secrets"` would suppress packaged credential
   material. One-line fix: exclude that id from the waiver filter. I did not
   edit the probe (not my file, and gpt-A found no probe defect). Recorded
   honestly in both docs as "policy, enforced by review" rather than papered
   over. Suggested Round 2 owner: gpt-A.
2. **No shared export needed from `redaction.ts`.** Brief item 3 offered one; I
   did not take it. My test reads the probe and the spec, so opus-A's file is
   untouched and unblocked.
3. **Transient sibling state, not a gate finding.** At 15:57 UTC
   `test/unit/feedback/redaction.test.ts` and `test/unit/privacy/redaction.test.ts`
   were mid-write by opus-A: `pnpm lint` was briefly red with 5 unused-import
   errors (clean again by 15:58) and 7 assertions were failing, including a
   self-reported `"windows-unc-path" has no GATE_CORES pin — add one`. The
   *behaviour* is fine — `redactSensitiveText` on the probe's UNC sample returns
   `copied [path]` — so these are opus-A's fixtures catching up, not a
   regression. Parent must still re-run `pnpm gate` on the committed tree; my
   test-count row is explicitly a point-in-time snapshot.
4. **gpt-B's probe stays green** against the rewritten spec (`release-gate-status`
   ok). If parent wires `preview:probe` into `prerelease`, the "Not yet a bar"
   section of the spec needs one line deleted.

## Constraints honoured

No commit, push, or checkout. No edits to `src/feedback/redaction.ts` or
`src/cli/main.ts` (both verified clean in `git status`). No invented usage
numbers — every figure above came from a command I ran in this VM. Nothing is
marked Outcome-supported; ADR-006 stays Proposed; the waiver register is
still empty.

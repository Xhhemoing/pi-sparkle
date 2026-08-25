model: claude-opus-5-thinking-high-fast

# R2-opus-B — governance files + adapt-eval honesty + inspect verification display

Branch `cursor/merge-preview-release-8011`. No commit, no push, no checkout.

## Verdict

All three tasks landed in the worktree. Full gate is green on my last run
(after opus-A's `main.ts` / `inspection.ts` landed alongside mine):

```console
$ pnpm typecheck   # exit 0
$ pnpm lint        # exit 0
$ pnpm test        # tests 2121, pass 2120, fail 0, skipped 1
$ pnpm build       # exit 0
$ node scripts/security-probe.mjs
{ "status": "ok", "passed": 14, "openFindings": [], "waivedFindings": [] }
$ node scripts/preview-release-probe.mjs   # status ok, 5 checks
```

One caveat on the test number: the suite is growing under me because other
slots are writing to the same worktree. An earlier `pnpm test` in this slot
reported `fail 1` at `tests 2114`; re-running at `tests 2121` gave `fail 0`
twice in a row, and the failure never reproduced. I read it as a mid-edit
snapshot of a concurrent slot, not a defect in this slot's changes — but the
parent should treat the final pre-commit `pnpm gate` as the authoritative run,
not mine.

## 1. Governance files (from `df964ae`, adapted to the GREEN gate)

New, all four: `SECURITY.md`, `CHANGELOG.md`, `.github/CODEOWNERS`,
`.env.example`. `.gitignore` already had `!.env.example`, so the file is
tracked; it is not in `package.json#files`, so it stays out of the packed
artifact and cannot trip `packaged-secrets`.

What I changed relative to `df964ae`, and why:

| `df964ae` said | this branch says |
|---|---|
| "Known open findings … `pii-redaction` and `secret-bodies` are open" | "Current findings: **None open as of 2026-08-25**", with the 14-passed evidence and the 2026-08-22 → closed history kept as history |
| `.env.example`: "CI uses: `pii-redaction,secret-bodies`" | "Leave this EMPTY … the register is empty and both CI and `pnpm prerelease` run the probe with no waiver" |
| CHANGELOG: "CI now runs `pnpm security:probe` … with a registered waiver for the two open findings" | "with **no** `SECURITY_WAIVER`" |
| SECURITY.md: rule 3 as policy | rule 3 as code — `scripts/security-probe.mjs` excludes `packaged-secrets` from the `SECURITY_WAIVER` filter (gpt-A's change, already in the worktree at line 158) |

Nowhere do these files instruct an operator to waive `pii-redaction`. The only
`SECURITY_WAIVER` example left is the empty one in `.env.example`.

I dropped `df964ae`'s Unreleased entries that describe work which is **not** on
this branch: `docs/README.md` (does not exist), the
`docs/superpowers/` → `docs/work-plans/` rename (`docs/superpowers/` is still
there), the `src/cli/main.ts` split into per-command modules (main.ts is still
one ~2.3k-line file), the `CONTRIBUTING.md` structure refresh, and the README
Windows-path fix. Shipping those as changelog entries would have been a lie
about this tree. The Unreleased section I wrote instead describes only things I
verified in the worktree: the four governance files, the CI probe step, the
`preview:probe` wiring, the adapt-eval honesty fields, the ADR-006 assertions,
`inspect-format.ts`, the never-waivable `packaged-secrets` filter, and the
closed `pii-redaction` / `secret-bodies` findings.

The 0.1.0 section keeps `df964ae`'s Supported / Opt-in wording verbatim. Its
"Known open gates" list is re-stated against `docs/status-matrix.md` as it
reads today: P0 privacy still CONDITIONAL (Q1/Q2 remediated 2026-08-22,
cascade extended 2026-08-24, sign-off open), Checkpoint F-PROD open (ADR-005),
ADR-006 Proposed, and green-probe-is-not-a-release-authorization.

**Note for the parent (not mine to fix):** `docs/specs/release-gate.md` lines
93–97 still say rule 3 is "policy, not code" and that
`SECURITY_WAIVER="packaged-secrets"` "would in fact suppress" the finding.
That is now false — gpt-A's filter landed. It also still shows
`SECURITY_WAIVER="pii-redaction,secret-bodies" pnpm prerelease` as the waiver
example on a GREEN gate. I did not edit that file because it is outside my
writes and gpt-A owns the probe side of it.

## 2. adapt-eval honesty + ADR-006 assertions

`5f49bdc`, `38e20c2`, and the `test/unit/pi-boundary.test.ts` half of `92f00bc`
were all still missing and all applied **clean** with `git apply` (offsets
only, no fuzz, no conflict). Files touched:

- `src/adaptation/eval-routing.ts` — `ROUTING_EVAL_QUALITY_EVIDENCE`,
  `ROUTING_EVAL_QUALITY_NOTE`, `RoutingActionDiff`, the three new
  `RoutingEvalReport` fields, the `parseRoutingEvalReport` guards (tolerate
  absent, reject forged), and the `actionDiff` construction.
- `src/cli/adapt.ts` — the honest copy in `adapt status` and the evidence
  block, action-diff rows (capped at 10), and the positive-cost-upper-bound
  warning in `adapt eval`.
- `test/unit/adaptation/eval-routing.test.ts`, `test/unit/cli/adapt.test.ts` —
  the assertions from `5f49bdc`.
- `test/unit/adaptation/promotion.test.ts`,
  `test/unit/learning/active-routing.test.ts`,
  `test/unit/run/flowchart-learned-routing.test.ts` — the `38e20c2` fixture
  fields (required, or `tsc` rejects the typed `RoutingEvalReport` literals).
- `test/unit/pi-boundary.test.ts` — the `92f00bc` whitelist test and the
  `package.json` no-`pi.extensions` / no-`pi-coding-agent` test.

**Ownership flag:** `src/adaptation/eval-routing.ts` is not in my Writes column
in the brief. It is also not on anyone's Must-not-touch list, and the port is
impossible without it — `report.qualityEvidence` and `report.actionDiff` do not
exist on `RoutingEvalReport` otherwise, so `src/cli/adapt.ts` would not
typecheck. I took it. Same for the three fixture test files from `38e20c2`,
which are outside my column for the same mechanical reason.

Loop-4 CLI is not regressed: `adapt eval` still prints the report path as its
**first stdout line** and the ported tests parse it as `split("\n")[0]`, so
`adapt promote --eval-file "$(pnpm cli adapt eval ...)"` style call sites that
read the whole stream would need the same first-line treatment. The three
promote/eval call sites inside `test/unit/cli/adapt.test.ts` were updated by
the patch itself; I found no other consumer of that stdout.

## 3. `fc6058c` verification display

`src/cli/inspect-format.ts` is new and byte-identical to `fc6058c`'s version —
`formatTaskResultLine`, `unverifiedTaskIds`, `formatUnverifiedSummary`. It
typechecks against the current `src/run/inspection.ts` (`ChildInspection` still
carries `taskId: TaskId` and `terminalResult?: TaskResult`), including after
opus-A's `--follow` changes to that file.

Per the brief I did **not** touch `src/cli/main.ts`, so the module is exported
but not yet called and CLI output is unchanged. I also did not port
`fc6058c`'s `test/unit/cli/inspect-format.test.ts`, because my instruction was
to hand-port this via `src/cli/inspect-format.ts` only. Both are parent
decisions; the wiring patch is below.

### Exact wiring patch for the parent

Line numbers are against `src/cli/main.ts` as of my last read, after opus-A's
edits. Anchors are unique strings, so they survive small drift.

**(a) import** — after the existing `import { inspectRun } from "../run/inspection.js";`:

```ts
import { formatTaskResultLine, formatUnverifiedSummary } from "./inspect-format.js";
```

**(b) `run --children`** — around line 1140, inside `runCommand`:

```ts
-        io.stdout(`      result: ${terminal.outcome} — ${terminal.summary}\n`);
+        io.stdout(`      result: ${formatTaskResultLine(terminal)}\n`);
```

and after the `for (const child of inspection.children) { ... }` loop that
contains it, before `const episodeId = episodeIdFromEvents(outcome.events);`:

```ts
    const unverifiedSummary = formatUnverifiedSummary(inspection.children);
    if (unverifiedSummary !== undefined) {
      io.stdout(`  ${unverifiedSummary}\n`);
    }
```

**(c) `inspect --run`** — around line 1503, inside `inspectCommand`, the same
one-line swap:

```ts
-        io.stdout(`      result: ${terminal.outcome} — ${terminal.summary}\n`);
+        io.stdout(`      result: ${formatTaskResultLine(terminal)}\n`);
```

and after the enclosing `if (inspection.children.length > 0) { ... }` block,
before `for (const question of inspection.pendingQuestions)`:

```ts
    const unverifiedSummary = formatUnverifiedSummary(inspection.children);
    if (unverifiedSummary !== undefined) {
      io.stdout(`  ${unverifiedSummary}\n`);
    }
```

**(d) `--track`** — in `runCommand`, immediately after the
`if (outcome.learn !== undefined) { ... }` block (around line 1059) and before
the `events:` line:

```ts
    const trackInspection = await inspectRun(stateRoot, outcome.runId);
    const trackUnverified = formatUnverifiedSummary(trackInspection.children);
    if (trackUnverified !== undefined) {
      io.stdout(`  ${trackUnverified}\n`);
    }
```

`--json` output is untouched by all four hunks. Expect
`test/integration/cli/cli.test.ts` to need the `fc6058c` updates once (b)–(d)
land — that commit adds 45 lines there asserting the new
`verification=`/`unverified:` lines.

**Deliberately not ported from `fc6058c`:** the `resume --supervised`
deprecation warning and its flowchart-checkpoint refusal, the
`--children`-is-the-flowchart-engine doc corrections in
`docs/specs/m0-m2-architecture.md` and `README.md`, and the status-matrix rows.
The status-matrix / release-gate hunks in that commit describe a BLOCKED gate
and would regress the GREEN status if applied verbatim. The `--supervised`
deprecation is a real behaviour change in `main.ts` and belongs to whoever owns
that file next.

## Files I wrote

- `SECURITY.md` (new)
- `CHANGELOG.md` (new)
- `.github/CODEOWNERS` (new)
- `.env.example` (new)
- `src/cli/inspect-format.ts` (new)
- `src/adaptation/eval-routing.ts`, `src/cli/adapt.ts` (ported)
- `test/unit/adaptation/eval-routing.test.ts`, `test/unit/cli/adapt.test.ts`,
  `test/unit/pi-boundary.test.ts` (ported)
- `test/unit/adaptation/promotion.test.ts`,
  `test/unit/learning/active-routing.test.ts`,
  `test/unit/run/flowchart-learned-routing.test.ts` (fixture fields only)
- `.agent_workspace/r2-opus-b.md` (this file)

Untouched, as instructed: `src/cli/main.ts`, `src/run/inspection.ts`,
`package.json`, `scripts/security-probe.mjs`, `.github/workflows/ci.yml`.

MODEL_SLUG: claude-fable-5-thinking-xhigh

# Round 3 report — R3-fable-A (SOTA docs close-out)

## Delivered (exclusive write paths only; nothing committed)

1. **`docs/status-matrix.md`** — new section "Pi compatibility line
   (pin + auxiliary tooling)" between the runtime and adaptive-library
   lines, with the four requested rows, all honestly marked **not
   Outcome-supported** and framed as developer preview:
   - **Pi pin 0.84.3** — wired `src/pi-adapter/` only (ADR-001), exercised
     by typecheck + adapter tests + the specifier tripwire; exact matching
     pair, `pi-coding-agent` not a dependency.
   - **`pi-compat` CLI** — wired exactly as USAGE spells it
     (`pi-compat [--json] [--offline]`, online opt-in
     `pi-compat --online [--json]`); offline default, online fails closed,
     exit 1 only on adapter-contract breakage; probe adapter-source-only.
   - **doctor `pi-packages` / `pi-compat`** — offline-only check, inherits
     doctor's unfrozen output contract.
   - **`run --thinking <level>`** — all three `run` forms; flag >
     `PI_THINKING_LEVEL` > `off`; per-run, never persisted; Google clamp
     named as provider behavior. Exercised by `thinking-flag.test.ts` and
     the new clamp characterization test.
   - Section intro also states ADR-006 explicitly: no `pi.extensions`, only
     `skills` + `prompts`.
2. **`docs/reports/2026-08-24-round2-sota-gap.md`** — closed with a §4
   "Round 3 close-out": an already-in-tree evidence table (fixtures,
   `--thinking`, aliases, pin, clamp documentation, ADR-006), the
   remaining-proof list with per-owner acceptance, and a carried-beyond
   list. Two items I had drafted as open **landed mid-round while I
   worked** and §4 records them as observed, not promised:
   - `test/unit/pi-adapter/thinking-clamp.test.ts` (R3-opus-A):
     faux-provider proof the adapter forwards `xhigh`/`max` unchanged;
     `clampThinkingLevel` clamps to `high` on every Google reasoning model;
     compile-time `SameUnion` pins of `GoogleApiThinkingLevel` /
     `ResolvedGoogleThinkingLevel` against `SparkleThinkingLevel`.
   - README/overlay flip (R3-fable-B): README line 81 now has all seven
     levels including `max`, `--thinking` precedence, "never persists",
     the clamp, and a `pnpm pi:probe` row; SKILL.md + reference call the
     flag landed without claiming TUI persistence.
3. **`docs/how-to-adapt-to-pi.md`** —
   - Google clamp watch item now says in so many words: **known provider
     behavior, not a pi-sparkle bug**; do not file as drift, do not "fix"
     by rewriting the level; points at the clamp characterization test.
   - Step 5 gained the operator-facing non-finding: `--thinking xhigh|max`
     on a Google model behaves like `high` — the clamp, not a bump
     regression.
   - `"off"` divergence item now states the design: pi-ai dropped `"off"`
     from its own `ThinkingLevel` (`ModelThinkingLevel = "off" | ...`), and
     this repo is unaffected **because the adapter imports agent-core's
     union** and everything else sees only the adapter's re-export.
   - Maintainer note rewritten from "no automated drift test yet" (now
     stale) to the actual coverage: a *narrowed* agent-core union fails
     typecheck at the adapter boundary + the clamp test's compile-time
     pins; an *added* level still goes silently stale in the three
     sparkle-owned mirrors and stays a manual step-2 comparison.
4. This report.

## Verification (this VM, Node 22.22.2, pnpm 10.17.1, 2026-08-24)

- `pnpm cli pi-compat` run **before and after** my how-to edits (check.ts
  reads that file as prose evidence): exit 0 both times,
  `pinned: agent-core=0.84.3 ai=0.84.3`, `google-thinking=absent`, all
  seven levels, `nested-skill-discovery=yes`,
  `agents-md-not-broken-skill=yes`. The legacy identifier is still spelled
  in the maintainer notes; the report did not flip — the Round 2
  regression probe stands.
- `pnpm cli doctor`: exit 0, all ten checks ok including
  `pi-packages: agent-core=0.84.3 ai=0.84.3` and
  `pi-compat: status=unknown (offline …)`.
- Flag cross-check against USAGE in `src/cli/main.ts` (read this round):
  every flag spelling in the matrix, how-to, and gap report matches
  (`--offline` explicit-default, `--online` opt-in, `--json`,
  `--thinking <off|minimal|low|medium|high|xhigh|max>` on all three `run`
  forms). Audit report grep confirmed no stale flag spellings.
- Fixtures confirmed on disk: `test/fixtures/pi-0843-skills/grouping/`
  (README.md, AGENTS.md, nested-skill/SKILL.md) — cited as existing, not
  planned.

## Scope discipline

Wrote only `docs/**` and this file. `src/`, `test/`, `README.md`, skills,
`package.json` untouched. Nothing committed (parent commits). No
extensions proposed anywhere (ADR-006 respected in every doc touched).

## Residual risk

1. **Concurrent-tree race (main risk).** Both fable-B's flip and opus-A's
   clamp test landed *while I wrote*; my docs describe the tree as read at
   ~15:00 UTC. If a Round 3 peer force-rewrites those files after me, §4's
   "landed mid-round" observations could go stale the same way Round 2's
   overlay did. Mitigation: every §4 claim carries its file path so the
   parent's post-round `pnpm gate` + a grep will catch reversal cheaply.
2. **Gate not yet run as a whole.** My evidence is per-command
   (`pi-compat`, `doctor`) and per-file reads, not a full
   `pnpm gate` — that is deliberately owned by R3-opus-B/parent (§4 item
   3). The clamp test in particular I read but did not execute; if it
   fails under the gate, §4 item 2 must be reopened, not edited away.
3. **Additive thinking-level drift stays manual.** Narrowing fails
   typecheck; adding a level fails nothing. Three sparkle-owned mirrors
   (`SparkleThinkingLevel`, `THINKING_LEVELS`, `SPARKLE_THINKING_LEVELS`)
   can silently omit a new level. Documented in the how-to maintainer
   note; an exhaustiveness test remains an open P1 for a future round.
4. **Docs describe a moving upstream.** "Google clamps to `high`" is
   0.84.3-true and now test-pinned, but a future Pi could raise Google's
   ceiling; the clamp test is written to fail in that case, and the
   how-to/USAGE would then need a coordinated edit — the docs say so
   explicitly, which is the intended failure mode.
5. **Unowned carries.** Shipped-tree skill packaging doctor check (P1,
   optional) and the online CI cron (needs network policy) leave Round 3
   with no owner; recorded in §4 so they are a decision, not an oversight.

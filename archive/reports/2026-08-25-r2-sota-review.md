# R2 SOTA review — Round 1 landings, cae9 ingest, Round 3 scope

Reviewed at HEAD `afec150` on `cursor/merge-preview-release-8011`, 2026-08-25
16:12–16:21 UTC, Node `v22.14.0`, pnpm `10.17.1`. The working tree carried
in-flight Round 2 edits from all sibling slots while this review ran; every
test/probe result below is timestamped point-in-time and the parent must
re-run `pnpm gate` on the committed Round 2 tree. Nothing outside this file
and `.agent_workspace/r2-fable-a.md` was written; no git operations.

## 1. Verdicts

| Subject | Verdict |
|---|---|
| Round 1 landings (`afec150`) | **ACCEPT, all five slots** — two spec sentences fall due for truth-up as Round 2 lands (§2.3) |
| opus-A pin tests lock the probe | **CONFIRMED** (§2.1) |
| opus-B GREEN claims vs live probe | **CONFIRMED** — re-derived, not inherited (§3) |
| cae9 ingest (planned, now in flight) | **Faithful where ported; four leftovers need parent disposition** (§4) |
| Round 3 | **Two landings**: screaming-snake keyed secrets; CI Node pin 22.19.0 (§5) |

## 2. Round 1 landings vs the SOTA 内测 bar

### 2.1 The pin tests actually lock the probe

`test/unit/feedback/redaction.test.ts` (landed in `afec150`) locks
`scripts/security-probe.mjs` through four independent mechanisms, all verified
live here:

1. **Coverage pin** — `GATE_CORES covers every sample the probe checks,
   verbatim` fails with a named message for any probe sample lacking a pin.
2. **In-process gate reproduction** — the suite parses `redactionSamples` and
   the `policy` literal out of the probe *source* (imports would run
   `npm pack` as a side effect) and drives `redactFeedback` with them, so a
   new probe sample is exercised by `pnpm test` before anyone hand-copies it.
3. **Policy pin** — `redactPII`/`maxBodyChars`/`forbiddenSubstrings` asserted
   against the script, closing the "gate policy is not the shipped policy"
   gap opus-A found; `test/unit/privacy/redaction.test.ts` separately pins
   all 13 cores under the shipped `FEEDBACK_REDACTION_POLICY`.
4. **Loud failure on refactor** — the parser throws
   `"no longer declares a redactionSamples array literal"` rather than
   silently matching a subset.

Independent checks this review added: the parser regex, re-run standalone
against the current probe, reads **13/13** samples by name (not a subset);
and the suite stayed green across gpt-A's Round 2 edit to the same file —
the lock binds the sample/policy blocks, not incidental text, which is
exactly the drift dimension that matters. opus-A's own mutation run
(UNC-rule break → 7 named failures, 5 from the new pins) is recorded in
`.agent_workspace/r1-opus-a.md` §5 and is consistent with everything above.

Known one-way limit, by design: the lock guarantees tests cover every probe
sample; nothing forces a new redaction rule to gain a probe sample. The probe
is the floor, not the census.

### 2.2 The other four slots

- **opus-B** (`docs/specs/release-gate.md` rewrite,
  `test/unit/feedback/release-gate-policy.test.ts`): the GREEN status is
  evidence-pinned (commands, exit codes, verbatim JSON, `d4b16e1` source SHA)
  and the "What GREEN does not mean" section keeps the claim honest. The
  policy suite (5 tests) passed here against the live tree, including through
  gpt-A's in-flight probe edit.
- **gpt-B** (`scripts/preview-release-probe.mjs`): read-only, fails closed on
  unreadable input, 5/5 checks ok, exit 0 re-verified (§3).
- **gpt-A**: live probe evidence matches opus-B's and this review's runs
  exactly (`ok`, 14 passed); the no-defect finding on the probe holds.
- **fable-A/fable-B** (reports): the load-bearing audit claims were re-checked
  and hold — `origin/cursor/agent-market-eval-opt-cae9` tip is `73e9677`,
  **0 behind / 6 ahead** of `origin/main` (`git rev-list --left-right
  --count`), and the 内测-GREEN/publish-BLOCKED split matches the live gate.

### 2.3 Debt created by Round 2 landing on top of Round 1 (parent, one-line edits)

Both are spec drift in the *safe* direction, but this campaign's product is
honesty, so they must not survive Round 2 closeout:

1. `docs/specs/release-gate.md` "Rule 3 is policy, not code … until it lands,
   rule 3 is enforced by review" — **stale once gpt-A's never-waivable filter
   commits** (already in the worktree: `isWaived` excludes `packaged-secrets`,
   `scripts/security-probe.mjs:158`).
2. Same file, "Not yet a bar" — **stale once gpt-B's wiring commits**
   (worktree `prerelease` is now `pnpm preview:probe && pnpm gate && pnpm
   security:probe && pnpm pi:probe`). opus-B pre-announced this exact edit in
   `.agent_workspace/r1-opus-b.md`.

`release-gate-policy.test.ts` cannot catch either (it checks ids, headings,
and the waiver register, not wiring claims) — these are parent edits, not
test failures.

## 3. Probe GREEN vs spec — confirmed live

All runs on a `dist/` rebuilt in-session from the current tree,
`SECURITY_WAIVER` unset throughout:

| command | exit | result |
|---|---|---|
| `pnpm build` | 0 | fresh dist |
| `node scripts/security-probe.mjs` | 0 | `{"status":"ok","passed":14,"openFindings":[],"waivedFindings":[]}` |
| `node scripts/preview-release-probe.mjs` | 0 | 5/5 `ok` |
| `pnpm pi:probe` | 0 | 4 PASS (pins 0.84.3) |
| `npx tsc --noEmit` | 0 | clean, with all Round 2 edits in tree |
| 4 gate suites (feedback/privacy/policy/preview) | 0 | 59/59 pass |
| follow + inspection suites (in-flight cae9 port) | 0 | 38/38 pass @16:20Z |

`src/feedback/redaction.ts` is clean against HEAD and its last touch is
`d4b16e1` — the SHA the spec's GREEN is pinned to. The security probe run
included gpt-A's in-flight waiver-filter edit; the sample and policy blocks
it reads are untouched, so the 14-pass result is comparable with Round 1's.
The one standing caveat is unchanged: all of this ran on Node `v22.14.0`,
below the declared `>=22.19.0` floor — which is Round 3 rec 2.

## 4. cae9 ingest — faithful where ported, four leftovers

Branch facts re-confirmed: `origin/cursor/agent-market-eval-opt-cae9` tip
`73e9677`, 6 commits, 0 behind `origin/main`. The `.agent_workspace/`
collision is real — cae9 carries its own `r1-fable-a.md` … `r3-opus-b.md`
under this campaign's slot names — so port-without-merge was the right call,
and opus-A did port file-by-file (no merge commit, collision avoided).

### 4.1 Fidelity of what landed (in flight, verified 16:19–16:21Z)

- `src/run/inspection.ts` — **byte-identical** to cae9's (`git diff` vs the
  branch is empty). `--follow` is a read-only poller with injectable clock
  and opt-in idle deadline; it needed no `event-store.ts` change because
  `EventLogRecovery` already exists at HEAD (`src/run/event-store.ts:37`) —
  no hidden coupling.
- `scripts/market-eval-probe.mjs` — **byte-identical**, exits 0 here, and is
  pure reads (`readFile`/`readdir`/`stat`; no `execSync`, no `npm pack` side
  effect — safe for tests to spawn).
- `src/cli/main.ts` — `export const USAGE` (from cae9 `5c1421c`) plus follow
  wiring, adapted around PR #11's `--max-cost-usd` text as the brief required.
- Two **intelligent adaptations**, both improvements over verbatim porting:
  - `test/unit/package/market-eval-probe.test.ts` is script-name-agnostic.
    cae9's original pinned `scripts["market:eval"]` while the Round 2 brief
    told gpt-B to add `market-eval:probe` — a verbatim port would have wedged
    the two slots against each other.
  - `test/unit/cli/readme-command-parity.test.ts` carries
    `KNOWN_UNDOCUMENTED_VERBS = ["unblock", "help"]` with a self-tightening
    companion test (the list may only name verbs that *really* lack a README
    row). Honest: this branch's README `## Commands` table genuinely lacks
    both rows (verified against the dispatch switch), cae9 fixed that in its
    own README (+79), and README is in no Round 2 slot's write list.

### 4.2 Left behind in cae9 — parent disposition needed at Round 2 close

1. **`src/pi-adapter/pi-executor.ts` steer-refusal for cost-stopped runs**
   (+43, with `test/integration/pi-adapter/cost-stop.test.ts` +258): refuses
   `steerText` once the spend ceiling has stopped a run, so `STEER_INJECTED`
   is never logged for words no model will read. Real production honesty fix,
   fully independent of `--follow`; excluded only by the ownership matrix.
   Disposition: bundle with the early-exit telemetry fix (§5, deferred) —
   same file, one owner, one round.
2. **README rows for `unblock`/`help`** (from cae9's README), after which
   `KNOWN_UNDOCUMENTED_VERBS` must be emptied. The parity test's own origin
   story is that `unblock` — the only exit from a BLOCKED run — was
   undocumented; this branch still has that exact gap.
3. **`src/cli/doctor.ts` node-floor detail (+6) and
   `docs/research/node-engine-floor.md` (+30)** — pairs naturally with
   Round 3 rec 2; porting the doctor line alone would dangle a reference to
   a doc that does not exist here.
4. **Docs/evidence census**: `docs/research/agent-ecosystem-eval.md`,
   `mcp-position.md`, the market-eval acceptance report,
   `test/unit/package/mcp-absence.test.ts`,
   `test/integration/cli/answer-correlation.test.ts`, and the
   status-matrix/kernel-reuse touches. Not urgency — but the branch should
   not be deleted until the parent decides which of these are wanted.

## 5. Round 3 — exactly two landings

**1. Close the screaming-snake keyed-secret miss in redaction.**
Verified live against the freshly built `dist/feedback/redaction.js`:
`DATABASE_PASSWORD=hunter2supersecret`, `DB_PASSWORD: hunter2`, and
`export API_TOKEN=abc123def456` all survive redaction untouched, while
`password=hunter2supersecret` → `password=[secret]`. Cause: the keyed-secret
rules anchor on `\b(?:…|password|token|…)\b` (`src/feedback/redaction.ts:75`
and `:83` over `KEYED_SECRET_NAMES` at `:47`), and `_` is a word character,
so no boundary exists inside `DATABASE_PASSWORD`. This is the only known
miss where the rule *intends* to match and does not, and it is a whole family
(`*_PASSWORD`, `*_TOKEN`, `*_SECRET`, `*_KEY`), the most common shape in
pasted logs. Land as: boundary fix in `redaction.ts` + a new `secret-bodies`
probe sample — the Round 1 drift guard then *forces* the matching pins, which
is the lock working as designed. Landing this invalidates the dated GREEN:
re-run `pnpm build && node scripts/security-probe.mjs` and re-date the spec
status in the same commit.

**2. Pin CI Node to the engines floor (22.19.0).**
`.github/workflows/ci.yml` uses `node-version: [22.x]` in both jobs (lines
14 and 53); `engines.node` is `>=22.19.0`; every green result in this
campaign so far ran on `v22.14.0`, below the floor. gpt-A's in-flight CI step
now runs `pnpm security:probe` after Build — pinning the matrix to `22.19.0`
makes that run the first probe certification on a provably engines-compliant
host, converting fable-B's GREEN condition 3 from incidental to proven and
retiring the below-floor caveat in the spec and readiness addendum. Carry
cae9 leftover 3 (node-engine-floor doc + doctor detail) in the same landing.

**Deferred, deliberately:** early-exit ModelInvocation telemetry. The gap is
real and was re-verified structurally — `reportInvocation` fires only on the
pre-aborted path (`src/pi-adapter/pi-executor.ts:753`) and the normal path
(`:777`); `execute()` has no `finally` around its `yield*`, so a consumer
that stops iterating early aborts the kernel (`:615`) and the invocation is
never recorded. Lower 内测 impact than the two above, and it edits the same
file as cae9 leftover 1 — bundle both into one owner in a later round rather
than splitting `pi-executor.ts` across rounds.

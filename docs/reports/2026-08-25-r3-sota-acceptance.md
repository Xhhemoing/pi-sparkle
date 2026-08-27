model: claude-fable-5-thinking-xhigh

# Round 3 — SOTA acceptance of Round 2 landings

**Scope.** Accept/reject the Round 2 landings committed in `cafc512`
("feat(preview): ingest Round 2 内测 landings and open Round 3", 35 files,
+3002/−18 on `afec150`), confirm the two known leftovers at Round 2 close, and
verify the in-tree Round 3 state that existed during this review. Read-only
git only (log/show/diff/grep/merge-base); no commit, push, or checkout. Review
window ~16:25–16:50 UTC; all six Round 3 slots landed in the worktree during
it, and the final reproduction run below is on the stable tree.

**Verdict up front: ACCEPT all Round 2 landings. Both Round 2 leftovers
confirmed at `cafc512` and both closed in-tree by Round 3. Zero Round 4.**

## 1. Round 2 acceptance, per landing

### 1.1 Security probe hardening (R2-gpt-A) — ACCEPT

- Never-waivable is code, not policy, at `cafc512`:
  `scripts/security-probe.mjs:158` —
  `isWaived = (finding) => finding.probe !== "packaged-secrets" && waivers.has(finding.probe)`,
  with the rule-3 citation comment on line 157. The predicate is unchanged in
  the Round 3 worktree (opus-A added samples only).
- CI runs the probe: `cafc512:.github/workflows/ci.yml:46-47` has a
  `Security probe` step (`pnpm security:probe`) after Build in the quality
  job, with no `env:`/`SECURITY_WAIVER` in the step block. Node matrix was
  still `22.x` at `cafc512` (lines 14/53), as the Round 3 brief recorded;
  R3-gpt-A has since pinned both to `"22.19.0"` in-tree.
- Reproduced live (§3): probe `status: ok`, exit 0, no open or waived
  findings, `SECURITY_WAIVER` unset.

### 1.2 Prerelease wiring (R2-gpt-B) — ACCEPT

- `cafc512:package.json:47` —
  `"prerelease": "pnpm preview:probe && pnpm gate && pnpm security:probe && pnpm pi:probe"`;
  `preview:probe` is first, exactly as briefed.
- `market-eval:probe` correctly **absent** at `cafc512` (script grep of the
  committed `package.json`: `pi:probe`, `invocation:probe`, `security:probe`,
  `preview:probe` only) while `scripts/market-eval-probe.mjs` (274 lines) and
  its script-name-agnostic test landed — the recorded reason (script landed
  after gpt-B started) is consistent with the tree. R3-gpt-B has since wired
  it in-tree.
- `private: true` and `engines.node >=22.19.0` unchanged (preview probe
  re-verified both, §3).

### 1.3 `inspect --follow` port (R2-opus-A) — ACCEPT

- Ported without merging the branch: `git merge-base --is-ancestor 73e9677
  HEAD` → **not** an ancestor; zero merge commits in `e88f2ce..HEAD`.
- Faithful where byte-identity was claimed:
  `git diff 73e9677 cafc512 -- src/run/inspection.ts scripts/market-eval-probe.mjs`
  is **empty**.
- Substance present at `cafc512`: `followInspect`/`FOLLOW_STOP_STATUSES` in
  `main.ts`, the read-only/no-lock/`--idle-timeout-ms` USAGE contract, and the
  389-line `test/integration/cli/inspect-follow.test.ts`. All pass in the full
  suite (§3).

### 1.4 Governance + honesty + ADR-006 ports (R2-opus-B) — ACCEPT

- Governance files landed GREEN-adapted, not raw-picked: `SECURITY.md`
  documents register-first waivers and the in-code never-waivable rule
  (lines 39–48) with the 2026-08-22 findings in a **history** section
  (line 68), not as open; no resurrected waiver register. `CHANGELOG.md`,
  `.github/CODEOWNERS`, `.env.example` present and consistent with the GREEN
  gate — the exact correction R2-fable-B's plan demanded over raw `df964ae`.
- adapt-eval honesty is substantive: `ROUTING_EVAL_QUALITY_EVIDENCE =
  "none-by-construction"` + note, `actionDiff` rows with `costDeltaUsd`,
  a parser guard rejecting any other `qualityEvidence` value
  (`src/adaptation/eval-routing.ts`), and `adapt eval`/`adapt status` CLI
  output stating utilityDelta is 0 by construction with a positive-cost-upper
  warning (`src/cli/adapt.ts`).
- ADR-006 guardrails are tests, not prose: `test/unit/pi-boundary.test.ts`
  pins the `@earendil-works` import whitelist (`pi-agent-core`, `pi-ai`) for
  `src/pi-adapter`, no `pi.extensions` in `package.json`, no `pi-coding-agent`
  dependency. ADR-006 itself remains **Proposed** (frozen invariant intact).

### 1.5 Round 2 review artifacts (R2-fable-A/B) — ACCEPT

`docs/reports/2026-08-25-r2-sota-review.md` and
`2026-08-25-r2-cherry-pick-plan.md` committed. Their load-bearing predictions
all verified correct this round: the two stale spec sentences (§2 below), the
screaming-snake miss (fixed by R3-opus-A with the predicted root cause —
`\b` vs `_`), the CI Node pin (done by R3-gpt-A), and the `main.ts` splice
points (used by R3-opus-B; wiring matches the plan's four-hunk shape).

## 2. The two leftovers, confirmed at Round 2 close (`cafc512`)

1. **`inspect-format.ts` unwired — CONFIRMED.**
   `git grep "inspect-format" cafc512 -- "*.ts" "*.mjs"` → **zero matches**:
   no importer in `src/`, none in `test/` either (the module landed untested
   as well as uncalled). The file itself is present (38 lines, exports
   `formatTaskResultLine`, `unverifiedTaskIds`, `formatUnverifiedSummary`).
   Closed in-tree by R3-opus-B: `src/cli/main.ts:56` imports it; four additive
   hunks cover `run --children`, `inspect --run`, and `run --track`;
   `--follow` and `--max-cost-usd` intact; 8-test unit file plus end-to-end
   `verification=` integration assertions added.
2. **Two stale release-gate sentences — CONFIRMED.**
   `cafc512:docs/specs/release-gate.md:93` ("Rule 3 is policy, not code…") and
   `:103` ("## Not yet a bar"). Both were false-safe after Round 2 code
   landed. Closed in-tree by R3-gpt-B: Rule 3 now described as enforced in
   code; preview probe described as the first prerelease command; the "CI runs
   only the quality gate / neither probe runs in CI" paragraph replaced with
   the probe-after-build reality.

## 3. Reproduction on the final tree

Host: Node `v22.14.0`, pnpm `10.17.1` — below the `>=22.19.0` engines floor
(pnpm warns and continues). This is the known caveat; R3-gpt-A's CI pin to
`22.19.0` is what certifies on a compliant host.

`pnpm prerelease` on the stable tree (all six Round 3 slots landed), exit
**0**:

- `preview:probe` — `status: ok`, 5/5 checks (`package-private`,
  `node-engine`, `bin-path`, `release-gate-status`, `pnpm-workspace`).
- `gate` — typecheck, lint, build clean; tests **2137 total, 2136 pass,
  0 fail, 1 skip** (includes opus-A's redaction matrix, opus-B's
  inspect-format unit + integration tests, and the parity suite with an
  **empty** `KNOWN_UNDOCUMENTED_VERBS`).
- `security:probe` — `{"status":"ok","passed":16,"openFindings":[],
  "waivedFindings":[]}` against the freshly built `dist/` — matches the
  re-dated GREEN block in `docs/specs/release-gate.md` (opus-A's two
  screaming-snake samples included).
- `pi:probe` — pass (prerelease exit 0 requires it).

Round 2's own GREEN (`passed: 14` at `cafc512`) is strictly superseded: the
current probe carries the same 13 samples plus two, and passes.

**Flake note.** My first `pnpm prerelease` (~16:31 UTC) had exactly one test
failure out of 2137 — during the window when sibling Round 3 edits were
landing in the worktree mid-run. It did not reproduce in three subsequent
full runs (one `pnpm test`, two `pnpm prerelease`) on the settled tree. Not a
reproduced gap; recorded here so a future single-failure sighting has a
precedent to compare against.

## 4. Round 3 in-tree state (observed, not formally in my acceptance scope)

All six slots landed inside their ownership columns; the modified-file list
maps 1:1 to the ownership table with no collisions. Notables:

- R3-opus-A's fix is the correct one (explicit `(?<![A-Za-z0-9])` /
  `(?![A-Za-z0-9])` boundaries; vocabulary unchanged; `TOKEN_COUNT`/
  `MAX_TOKENS` negatives pinned) with a recorded negative control: patching
  `dist/` back to `\b` turns the probe BLOCKED with exactly the two new
  findings.
- The GREEN re-date race resolved itself: R3-fable-B's declaration flagged
  the spec as still `passed: 14` at their close, but R3-gpt-B's follow-up
  landed afterwards — the spec now records `passed: 16`, "re-run after the
  screaming-snake secret samples landed", with a dated History bullet. I
  reproduced `passed: 16` live (§3), so the re-date is evidence-backed.

## 5. Parent closeout items — one-liners, none justify a Round 4 slot

1. `CHANGELOG.md:38` still says `inspect-format` "is not yet called from
   `src/cli/main.ts`" — now a false underclaim; drop the clause at closeout.
2. `docs/reports/2026-08-25-neice-declaration.md` §5 states the spec "records
   GREEN … with `passed: 14`" and demands a re-date — true when written,
   superseded minutes later by gpt-B's follow-up. Leave as history or add one
   line noting the re-date landed; the still-live part is only "cite GREEN
   against the closeout commit".
3. Cosmetic: the GREEN block cites `passed: 16` and the delta but not the
   literal 9/6 per-class sample split from opus-A's payload. Optional.
4. Commit the worktree — no SHA is claimable for 内测 until then (declaration
   §1 already says so).

Pre-existing deferrals stay deferred (already on record in the R2 review, not
new): cae9 leftovers (pi-executor steer-refusal for cost-stopped runs, doctor
node-floor detail, docs/research census), the belt-and-braces `fc6058c`
assertions for `test/unit/run/inspection.test.ts` (covered end-to-end by
opus-B's integration test), early-exit ModelInvocation telemetry.

## 6. Round 4 recommendation: ZERO

Every Round 3 objective in the brief is landed and reproduced: screaming-snake
redaction (probe 16/16, negative control on record), CI Node pinned to
22.19.0 on both jobs, `inspect-format` wired with `--follow`/`--max-cost-usd`
intact, README parity with an empty allowlist, `market-eval:probe` wired,
release-gate truthed-up and re-dated, declaration written. The full release
bar passes on the combined tree. The only failure observed this session did
not reproduce (§3). Frozen invariants intact: ADR-006 Proposed, `private:
true`, no live R1, no Outcome-supported claims, no PR #9 merge. What remains
is §5 — closeout edits and the commit itself, which belong to the parent, not
to another round.

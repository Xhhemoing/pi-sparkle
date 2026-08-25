model: claude-fable-5-thinking-xhigh

# R2-fable-A — SOTA review working notes (for parent)

Deliverable: `docs/reports/2026-08-25-r2-sota-review.md` (written).
Only my two owned files touched. No git operations. Review window
16:12–16:21 UTC with all sibling Round 2 edits in flight — every result
below is point-in-time; re-run `pnpm gate` on the committed tree.

## Headlines

1. **Round 1: ACCEPT, all five slots.** opus-A's pin tests genuinely lock
   the probe: parser reads 13/13 samples (independently re-verified), a
   probe sample without a pin fails loud, the probe's policy literal is
   pinned, and the suite reproduces the gate in-process against `src/`.
   The lock survived gpt-A's Round 2 edit to the same file untripped —
   it binds samples/policy, not incidental text.
2. **Probe GREEN vs spec: confirmed live, not inherited.** Fresh build →
   security probe `ok`/14/0/0 exit 0, preview probe 5/5, pi:probe 4 PASS,
   `tsc --noEmit` clean with all Round 2 edits, 59/59 across the four gate
   suites, 38/38 on the ported follow/inspection suites (16:20Z).
   `src/feedback/redaction.ts` clean vs HEAD, last touch `d4b16e1` — the
   SHA the spec pins. `SECURITY_WAIVER` unset throughout.
3. **cae9 ingest is faithful where ported.** Tip `73e9677`, 0 behind / 6
   ahead of `origin/main` re-confirmed. `inspection.ts` and
   `market-eval-probe.mjs` are byte-identical to cae9; no hidden coupling
   (`EventLogRecovery` already at HEAD, `event-store.ts:37`). opus-A's two
   adaptations are improvements: script-name-agnostic probe test (defuses
   cae9's `market:eval` vs gpt-B's `market-eval:probe`) and the honest
   `KNOWN_UNDOCUMENTED_VERBS = ["unblock","help"]` allowlist (our README
   really lacks both rows; README is in nobody's write list).

## Parent actions at Round 2 close (small, easy to miss)

- Two spec sentences are now stale **in the safe direction** and must be
  truthed up in the closeout commit: the "Rule 3 is policy, not code"
  paragraph (gpt-A's filter now enforces it, `security-probe.mjs:158`) and
  "Not yet a bar" (gpt-B wired `preview:probe` first in `prerelease`).
  `release-gate-policy.test.ts` cannot catch either.
- cae9 leftovers needing disposition before the branch is deleted:
  (a) pi-executor steer-refusal for cost-stopped runs + cost-stop tests —
  real production, independent of `--follow`; (b) README `unblock`/`help`
  rows, then empty the allowlist; (c) doctor node-floor detail +
  `node-engine-floor.md`; (d) docs/research + mcp-absence +
  answer-correlation census.

## Round 3 recommendations (exactly 2, evidence in the docs report)

1. **Screaming-snake keyed secrets.** Live-verified miss:
   `DATABASE_PASSWORD=hunter2supersecret`, `DB_PASSWORD: hunter2`,
   `API_TOKEN=abc123def456` all survive redaction; `password=…` does not.
   Cause: `\b` around `KEYED_SECRET_NAMES` (`redaction.ts:47,:75,:83`) and
   `_` is a word char. Fix + new `secret-bodies` probe sample (the Round 1
   drift guard then forces the pins). Re-run probe + re-date GREEN in the
   same commit.
2. **Pin CI Node to 22.19.0** (`ci.yml` lines 14/53, currently `22.x`).
   With gpt-A's CI probe step, this makes the first probe run on a provably
   engines-compliant host and retires the "all green evidence is below
   floor" caveat. Fold in cae9's node-engine-floor doc + doctor detail.

Deferred: early-exit ModelInvocation telemetry (verified real —
`reportInvocation` only at `pi-executor.ts:753`/`:777`, no `finally` behind
the `yield*`, consumer early-exit aborts at `:615` unrecorded). Bundle with
leftover (a) later: same file, one owner, one round.

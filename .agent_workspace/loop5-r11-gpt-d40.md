KEEP

# D40 landing recheck

Reviewed PR [#30](https://github.com/Xhhemoing/pi-sparkle/pull/30) at
`f0162ff9a142dba15aafd295fcf5aff162223067` against its merge-base
`05566af85fdb2c98197490c14169cfb45baedadd` with
`origin/cursor/pi-sparkle-sota-opt-0da8`.

- The four in-module envelopes use `command: "commits"` and the required
  stages: absent checkpoint is `lookup`; corrupt checkpoint, non-flowchart
  checkpoint, and zero completed nodes are `validation`. The store/plane
  messages are preserved, and both new inspect remedies are exact, path-free,
  and interpolate only the constrained run id.
- Each new catch converts only an uncoded `DomainValidationError`.
  `EventStore.readAll()` remains outside them. The proposal catches follow
  `filterDecisionCommitNodeIds`, so the closed D32 unknown-node bytes still
  answer first.
- Fresh live probes driven through `main(...)`, seeded only under
  `/tmp/r11-gpt-d40/**`, confirmed all four envelopes. The non-flowchart,
  zero-completed, and D32 apply refusals left `git rev-list --all` empty.
  `apply --file ... --nodes bogus` kept the D32 state-root-bearing remedy.
- The same probes confirmed that a corrupt event log retains the doctor remedy
  without `runId`; file-as-state-root ENOTDIR and checkpoint-as-directory
  EISDIR retain `stage: "execute"`. A successful preview retained the exact
  `COMMITS_PREVIEW` top-level keys.
- The three-dot diff contains only `src/cli/commits.ts`,
  `test/integration/cli/commits.test.ts`, and the implementer report.
  `git diff --check` is clean; forbidden modules and `package.json` are absent.

Verification from `/tmp/d40-recheck`:

- `pnpm install --frozen-lockfile` — passed with the expected Node 22.14.0
  warning against `>=22.19.0`.
- `npx tsx --test test/integration/cli/commits.test.ts` — 45 passed
  (35 baseline + 10), 0 failed, 0 skipped.
- `npx tsc --noEmit` — passed.

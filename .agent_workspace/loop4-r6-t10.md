# R6-10 — Flowchart dead-letter reachability and monotone requeue pin

Slot: Round 6 · R6-10. Branch `agent/opt-continuous`, starting HEAD `b4cc072`. Test-only and additive; no commit.

## Change

- `test/integration/cluster/undelivered-mail.test.ts`: added a real `startFlowchartRun` with `cluster: true` and five dependency-chained `scout` children. The first child queues its self-role cast; the four later role registrations cross `DEFAULT_MAX_ROLE_REQUEUES`. The completed outcome pins the existing `clusterMail` shape exactly:

  ```text
  { pending: 0, pendingByRole: [], deadLettered: 1,
    deadLetteredByRole: [{ role: "scout", count: 1 }],
    deadLetteredByReason: [{ reason: "requeue-limit", count: 1 }] }
  ```

  It also pins the byte-identical operator line:

  ```text
  warning: cluster role-cast mail undelivered: pending=0, dead-lettered=1 (scout=1; requeue-limit=1)\n
  ```

- `test/unit/cluster/mailbox.test.ts`: added a focused countdown pin. After the sender is registered as a `tester`, three fresh same-role claimants produce the monotone tallies `[1, 2, 3]`; the next claimant drops the mail. The pending-only `requeueCount()` accessor then returns `0`, while the exact dead-letter record preserves the final tally as `requeues: 3`.

No production file changed. `deadLetterReport()`, `onDeadLetter`, `ClusterDeadLetter`, `ClusterMailReport`, and the CLI line formatter remain byte-untouched.

## Verification

- `pnpm test -- test/integration/cluster/undelivered-mail.test.ts test/unit/cluster/mailbox.test.ts` — PASS, 23/23 tests, 0 skipped.
- `pnpm exec eslint test/integration/cluster/undelivered-mail.test.ts test/unit/cluster/mailbox.test.ts` — PASS, exit 0.
- `pnpm exec tsc --noEmit` — PASS, exit 0 over the whole tree.
- `git diff --check` — PASS, exit 0.

The test command emitted the repository's existing engine warning because the VM runs Node `22.14.0` while `package.json` requests `>=22.19.0`; all scoped tests passed.

## Files

- `test/integration/cluster/undelivered-mail.test.ts`
- `test/unit/cluster/mailbox.test.ts`
- `.agent_workspace/loop4-r6-t10.md`

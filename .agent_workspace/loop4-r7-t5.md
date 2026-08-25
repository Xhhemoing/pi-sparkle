# R7-5 — A BLOCKED run deserves a `next:`

**`run` now routes BLOCKED the way it routes FAILED: the recorded reason, the evidence the block is owed, and the three things an operator can actually do — with resume listed for what it does rather than what it sounds like. `flowchartExitCode` still decides the exit code; every existing pinned string is untouched.**

Slot: R7-5 (P2/P3, operator surface). Branch `agent/opt-continuous`, no commits, no checkouts. Owned files only: `src/cli/main.ts` (sole) and one new additive file under `test/integration/cli/`.

---

## 1. What I did and did not do

| Asked | Done |
|---|---|
| A BLOCKED-specific block naming the queued analysis and the required evidence | `formatBlockedRunReport` reads both off the newest `RUN_BLOCKED.payload` (`reason`, `requiredEvidence`) — nothing re-derived |
| Name today's real options: `inspect`, injection, resume with the honest caveat | Two `next:` lines (`inspect`, `inject`) and one `note:` that says resume cannot unblock and replays BLOCKED until an unblock ships |
| Keep `flowchartExitCode` intact | Both sites still `return flowchartExitCode(outcome.status)`; the block is a stderr-only prelude. Pinned (§4) |
| Keep every existing pinned string intact | No existing line touched. `reportFailedRun`, `printFlowchartOutcome`, `missingRun`, `GENERIC_FAILURE_NEXT`, all five `DOCTOR_ROUTED_NEXT` routes, the cluster-mail line: byte-identical (§6) |
| Sink-wiring + resume-disclosure pins stay green | Green, both plus the byte-exact loopback disclosure on a BLOCKED supervised resume (§5) |
| Do **not** add `--lock-wait-ms` to pause; do **not** flip ADR-006 | Neither touched. My diff is `main.ts` only and adds no flag and no `docs/**` edit |
| Census first; census my consumers; scoped eslint + whole-tree `tsc`; 3× owned tests; no full gate; no scratch files | §2, §5, §6 |

**Scope call I made, and why.** The brief's evidence is `main.ts:911`, the `--children` branch. I wired **both** flowchart-outcome sites in `runCommand` — `--flowchart` (guard at `:760`) and `--children` (guard at `:964`) — and deliberately left `resumeCommand` and `answerCommand` alone. Reasoning in §3; the short version is that `--flowchart` is the only BLOCKED an offline test can drive through `main()`, so wiring it is what turns this slot from a source pin into an end-to-end witness, while resume's stderr is byte-pinned by a loopback test and belongs to whoever owns that pin.

## 2. Census (before trusting the brief)

Re-verified in the working tree, not from report hearsay.

- **The defect reproduces.** `run --flowchart` over a one-node flowchart with no result stalls to BLOCKED, exit 1, and at HEAD printed the status and nothing else. R6-1's disclosure and the reviewer's `main.ts:911` citation are both accurate.
- **Two producers write `RUN_BLOCKED`, and the block has to serve both.** `gate-apply.ts:132` writes `{ reason: "ANALYSIS_QUEUED", requiredEvidence: [...assessment.evidenceRefs] }`; `flowchart-run.ts:593` and `supervisor.ts:365/503` write `{ reason: "no progress for too many rounds", requiredEvidence: ledger… }`. Same payload shape, different reason. So the block prints the recorded reason rather than assuming the gate's — a hard-coded "analysis queued" would have been wrong on three of the four producers.
- **Last writer wins.** `inspection.ts:129-133` already applies that rule to this exact payload ("a run can stall repeatedly, and only the newest demand describes what it is still waiting for"). `formatBlockedRunReport` uses `findLast` for the same reason; pinned in §4.
- **The options I name are the ones that exist.** `INJECTABLE_STATUSES` (`flowchart-run.ts:1193`) contains `BLOCKED`, so `inject` is real. `RESUMABLE_CRASH_STATUSES` contains it too, and `gate-outcome.test.ts:248` already pins that resuming a blocked run repeats the block. `inspect` is unconditional. There is no fourth option: R7-3 is designing the unblock for Round 8, so the `note:` is the whole truth today.
- **`--children` cannot be driven to BLOCKED offline.** `ChildFakeExecutor` (`main.ts:128`) hard-codes `verification: { kind: "PASSED" }`, and `--children` without `--executor pi` always resolves to it (`:718-723`). Every compiled node has a child task, so the stall producer is unreachable there too. This is the same wall `undelivered-mail.test.ts:406-411` hit and documented ("The CLI has no seam to inject a peer-mail executor"), and I answered it the same way it did — see §4.

**Consumers of what I changed** (`main.ts` behaviour and `main.ts` source; all run in §5): the four source pins over `main.ts` — `invocation-sink-wiring.test.ts`, `invocation-log.test.ts:472-`, `undelivered-mail.test.ts:411`, `live-isolation.test.ts:44/56`; every suite that drives a flowchart or children run through `main()` — `cli/pause-inject`, `cli/cli`, `cli/commands`, `cli/public-prior-cli`, `cli/command-error-doctor`, `cli/delete`, `cli/commits`, `cli/migrate-legacy`, `m1/cli-children`, `m2.5/cli-contract-honesty`, `track/track-loop`, `pi-adapter/loopback-cli-resume`; plus `gate-outcome.test.ts`, whose ANALYSIS_QUEUED payload my formatter now reads.

## 3. The change

`formatBlockedRunReport(runId, stateRoot, events)` is a pure formatter exported for testing, in the shape `formatUndeliveredClusterMail` already established in this file (exported pure formatter, private `io`-writing wrapper). `reportBlockedRun` writes it; both `runCommand` flowchart sites call it under `if (outcome.status === "BLOCKED")` and then fall through to the unchanged `return flowchartExitCode(outcome.status)`.

Real output, `run --flowchart` over a stalling one-node flowchart (stdout above the rule is unchanged from HEAD):

```
Run run_31eab…: BLOCKED
  project: /tmp/…/proj
  events: 12 -> /tmp/…/events.jsonl
  checkpoint: /tmp/…/checkpoint.json
  flowchart: BLOCKED (only=RUNNING)
── stderr ──
  reason: no progress for too many rounds
  required evidence: Add a completed task, validated evidence, a new fact, or resolve a blocker in the next round
  next: pnpm cli inspect --run run_31eab… --state-root /tmp/…/state
  next: pnpm cli inject --run run_31eab… --type fact --key <key> --value <text> --state-root /tmp/…/state
  note: resume re-runs this run but cannot unblock it — no event clears a BLOCKED log today, so pnpm cli resume --run run_31eab… --state-root /tmp/…/state replays BLOCKED until an unblock ships
```

Three deliberate choices:

1. **stderr + `flowchartExitCode`, not `cliFail`.** `reportFailedRun` ends in `cliFail`, which emits the `{"ok":false,…}` machine line and returns 1. I did not reuse it. The brief says keep `flowchartExitCode` intact, and a BLOCKED run is not a thrown command error — it is a run that completed its loop and is waiting on the operator. Routing it through the error envelope would have put a second `ok:false` shape on a path `parseCliErrorJson` consumers do not expect it on. The exit code is identical either way (1), so nothing is lost.
2. **`(none recorded)` rather than omitting the line.** An empty demand is information: it says the block named no evidence, which is different from the block not being read. Pinned.
3. **The `note:` wording is what I could prove.** My first draft said resume "repeats this block". It does not — I did not wire resume, so a resumed BLOCKED run prints the status and no block. The landed wording ("re-runs this run but cannot unblock it … replays BLOCKED until an unblock ships") is true of the tree as it stands, and §4's resume test drives it through the CLI rather than asserting it.

**Why not `resume`/`answer` too.** Both have the same gap and both are one `if` away. I left them because: (a) `resumeCommand`'s stderr on a BLOCKED run is byte-pinned — `loopback-cli-resume.test.ts:457-460` asserts `resumed.err.join("")` **equals** the executor-config disclosure line exactly, on a supervised resume that ends BLOCKED; touching that plane means amending a frozen pin, which is not this slot's ownership; (b) `resumeCommand` already prints a `note:`-prefixed disclosure, so a second `note:` there wants a wording decision I would be making alone. Prescription for whoever takes it: wire the same helper at `main.ts` flowchart-resume and `answer` sites, leave the supervised branch alone or update the loopback pin in the same diff with disclosure.

## 4. Tests — `test/integration/cli/blocked-next.test.ts` (8, additive, new file)

| # | Pin | Why it is not decoration |
|---|---|---|
| 1 | `run --flowchart` ending BLOCKED prints reason, required evidence, both `next:` lines with the real run id and state root, and the `note:` | End to end through `main()`. Also asserts exit **1** and the unchanged `Run …: BLOCKED` status line, so the block cannot be bought by changing the exit code |
| 2 | Exactly three routed lines, in order: `inspect`, `inject`, resume-note | Catches both directions of drift — a lost option and an invented one. Asserts the note carries `no event clears a BLOCKED log today` and `replays BLOCKED until an unblock ships`, so the honesty clause cannot be softened into a recommendation |
| 3 | A COMPLETED run's stderr is exactly `""` | The block is BLOCKED-specific; negative control against printing it unconditionally |
| 4 | After the block, `resume --run` through the CLI comes back BLOCKED, exit 1 | Makes the `note:` evidence-backed rather than asserted — the claim is driven, not narrated |
| 5 | The gate's payload reaches the operator verbatim | Real `startFlowchartRun` (`cluster: true`, one clustered child returning `SUCCESS` + `verification: FAILED`, R6-1's seed) produces a genuine `ANALYSIS_QUEUED` block; the formatter both branches share renders `reason: ANALYSIS_QUEUED` and `required evidence: evd_vf-tsk_verify`. This is the motivating case, driven through production code |
| 6 | Wiring pin: **both** `return flowchartExitCode(outcome.status)` sites in `runCommand` are guarded by `reportBlockedRun` | The honest answer to §2's last bullet: `--children` — the branch the brief cites — cannot reach BLOCKED offline, so what is left to protect is that it still calls the formatter. Same remedy `undelivered-mail.test.ts` uses for the same wall |
| 7 | Mutation check: the pin **fails** when the `--children` branch's block is deleted | Keeps pin 6 from passing vacuously |
| 8 | Newest `RUN_BLOCKED` wins over a stale one; empty evidence renders `(none recorded)` | The last-writer rule from `inspection.ts` and the empty-demand branch, neither reachable from pins 1–5 |

`+8` tests, `0` new skips (the only skip in the tree is still the `PI_SMOKE=1` real-provider gate).

## 5. Verification (this VM, Node v22.14.0)

- **Whole-tree `npx tsc --noEmit`** — clean, twice (before and after the wiring pin), against the shared tree including siblings' in-flight edits.
- **Scoped `npx eslint src/cli/main.ts test/integration/cli/blocked-next.test.ts`** — clean.
- **Owned tests 3×** — 8/8, 8/8, 8/8.
- **Censused consumers, all green:** one batch of 170 tests over `cli/pause-inject`, `cli/cli`, `cli/commands`, `cli/public-prior-cli`, `cli/command-error-doctor`, `cli/delete`, `cli/commits`, `cli/migrate-legacy`, `m1/cli-children`, `m2.5/cli-contract-honesty`, `cluster/undelivered-mail`, `cli/invocation-sink-wiring`, `cli/resume-executor-config`, `cli/flowchart-cli`, `cli/thinking-flag`, `telemetry/invocation-log`, `routing/live-isolation`, `run/gate-outcome` → **170/170**. Then `pi-adapter/loopback-cli-resume` → **3/3**, including the byte-exact `resumed.err` disclosure on the BLOCKED supervised resume. Then `track/track-loop`, `run/inspection`, `cli/doctor` → **36/36**.
- **`node scripts/run-tests.mjs test/integration/cli`** → **86/86** (78 before + my 8; the runner walks directories, so the new file is discovered without a manifest edit).
- No full gate (parent's job). No crash probe run — my diff touches no probe case and no probe consumer.
- **`live-isolation.test.ts` run anyway**, green: I added **no** import to any `src/**` file (`Event`, `RunId`, `FlowchartRunOutcome` and `CliIo` were all already imported into `main.ts`), so the live closure is unchanged, but the brief's rule is cheap to over-satisfy.

## 6. Frozen-contract audit

- **Existing strings byte-identical**: `git diff src/cli/main.ts` is three hunks — one new function pair, two three-line `if` guards. No existing line is modified. `reportFailedRun`'s `reason:` line and its `pnpm cli inspect --run …` next, `printFlowchartOutcome`'s five lines, `missingRun`, `GENERIC_FAILURE_NEXT`, all five `DOCTOR_ROUTED_NEXT` routes, `formatUndeliveredClusterMail`'s line, `USAGE`: untouched.
- **`flowchartExitCode`**: body unchanged, still the return at both sites, and now pinned as such (§4 pin 6).
- **No new `createExecutor` call** — `invocation-sink-wiring.test.ts`'s exact count of 4 and `invocation-log.test.ts`'s runCommand pin both still hold.
- **`--lock-wait-ms` / `pause`**: not touched; no flag added anywhere. **ADR-006**: no `docs/**` edit in this slot. **No `package.json`**, no dependency, no new persisted schema, no event type, no live R1/bandit/topology read, no `writeFileAtomic`/jsonl/lock touch.
- **New export**: `formatBlockedRunReport`. It has two production callers via `reportBlockedRun` and one test caller, so it does not add to R6-9's no-production-caller set.
- Working tree at report time: my two files plus siblings' in-flight edits (`coordinator.ts`, `flowchart-run.ts`, `tracking/*`, `flowchart-run-abort.test.ts` and their reports). **No scratch files** — the one shell repro in §3 ran in a `mktemp -d` that was removed in the same command; nothing under `/workspace` outside my two files and this report.

## 7. Handoffs

- **R7-3 (unblock design):** when the unblock event lands, the `note:` line in `formatBlockedRunReport` is the one operator-facing string that must change with it — it currently promises that nothing clears a BLOCKED log. Pin 2 asserts both of its clauses, so it will go red rather than rot.
- **R7-6 (docs):** the runbook line is *`run` on a BLOCKED flowchart or children run prints the recorded block reason, the evidence the block is owed, `inspect` and `inject` remedies, and a note that resume cannot unblock the run today.* Exit code unchanged (1, via `flowchartExitCode`). Nothing to say about `resume`/`answer` — they still print the status only.
- **Whoever extends this to `resume`/`answer`:** §3's last paragraph has the prescription and names the pin that must move with it.

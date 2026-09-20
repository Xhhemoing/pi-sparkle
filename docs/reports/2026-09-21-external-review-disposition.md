# External review disposition — 2026-09-21

Source: external review of [.agent_workspace/2026-09-21-project-status-brief.md](<../../.agent_workspace/2026-09-21-project-status-brief.md>)
(received in session 2026-09-21; full review text retained in the session
transcript). The review was explicit that its implementation-specific points
were **risks to verify, not confirmed defects**. This record distinguishes
(a) points verified against the current tree, (b) genuine findings, (c)
accepted strategy, (d) deferrals. Author-run verification only; independent
verification remains pending per the standing relay outage.

## Concurrency note

The projection slice (`TASK-20260920-native-observation-projection`) was
completed by the implementation session **while this verification pass ran**:
verification record [2026-09-20-native-observation-projection](2026-09-20-native-observation-projection.md),
serialized full suite 2826 pass / 0 fail / 18 skip, probes green. The verdicts
below were checked against that implemented tree (the working branch). Items
marked "fix" are **acceptance-test/hardening additions** on top of verified
behavior, not repairs of confirmed defects.

## Verdict summary

| # | Review point | Verified verdict | Disposition |
|---|---|---|---|
| R1 | Projection layer: new results only, or history rewrite? | **Confirmed safe variant**: wrapping is at `tool.execute` (new results only); history append-only; no payload-prefix rewriting | Keep; add payload-prefix pinning test |
| R2 | Observation identity: same path ≠ same content | **Counter is content-keyed, not path-keyed** — a modified file at the same path gets a fresh first-two window (exactly the requested behavior). Residual edge: the key is length+head256+tail256, so two contents sharing head/tail/length but differing in the middle share one counter (a packing-timing inaccuracy, not a recall error — exact identity is the store's sha256) | Harden: full sha256 counter key (costless — `store.put` hashes every eligible call already); add same-path-mutation + collision tests |
| R3 | Recall returns archived snapshot, not live file | **Confirmed by construction**: `store.recall(ref)` reads `objects/<sha256>.txt`, hash+byteLength verified; never re-reads the source file | Add snapshot-vs-live-mutation test |
| R4 | Run isolation / foreign-id refusal | **Confirmed by construction**: recall resolves `projector.refs` (in-memory, run-scoped); object path bound to the projector's runId | Pinned in existing new tests |
| R5 | Error/receipt protection via trusted metadata | **Partial gap**: wrapper never passes `isError`/`evidenceReceipt` (defaults false). Structurally safe today (read tool throws on error → nothing projected; marker-in-text forces ineligibility fail-closed) — but protection of a large error-shaped body rests on the text-marker heuristic alone | Harden: forward explicit `isError` when the wrapped result carries it; add spoof tests |
| R6 | Recall re-projection loop | **Confirmed absent**: recall tool's execute is never wrapped; pages return raw | Keep; page size already bounded (`OBSERVATION_MAX_RECALL_BYTES`/`_LINES`) |
| R7 | Lifecycle: delete/cancel/resume semantics | **Partially defined**: delete cascade clears the archive; recall after delete fails closed ("object not found"); counters are in-memory → post-resume first reads are full again (safe direction) | Add delete-after and resume-restart test pins; document resume semantics |
| R8 | Privacy: archived bytes vs redaction policy | **Aligned**: archive stores exactly the bytes the model saw (run-scoped, `run-observation` class, `delete --run` cascade, owner-only perms). No extra sensitive copy is kept beyond live-context bytes | Document the alignment statement; no redaction transform on this path by design |
| R9 | Cache/preserved-thinking risk | **Does not apply to this design**: no history rewrite ⇒ prefixes stable; savings bounded to 3rd+ repeat of same content | Measurement still needed (R13) |
| R10 | Frozen command ≠ frozen acceptance logic (apply) | **Genuine design gap**: `reverifyCandidate` runs the frozen command *inside the candidate* (`apply.ts`); a candidate that rewires `package.json`/test config changes what the command verifies. The recorded verification identity binds command/argv, not the acceptance-definition bytes | Record as boundary item for the pending registration independent review + write-tool registration review; add acceptance-definition digest binding to the apply-registration review scope |
| R11 | Handle binds full trust object? | **Partially bound**: handle = (runId, artifactSha256, candidatePath); base revision bound via `preflight.revision`; candidate tree → commit → ff-only enforced. Not bound: evaluator/config digest, candidate-tree hash at issue time, approval identity | Same review-scope addition as R10 |
| R12 | Learned routing reads a promoted frozen snapshot? | **Confirmed**: `loadLearnedRouting` reads the registry's **versioned active pointer**, hash-verifies content, refuses the legacy `routing.json`; promotion is CAS-only. "R0-equivalent static + learned policy" is consistent — learned policy is promoted-frozen, not live-updating | Add behavior-level pin: mutating shadow/bandit/holdout artifacts must not change live routing output; record policy version/hash in `MODEL_ROUTED` (or an adjacent row) |
| R13 | Synthetic reduction % ≠ real benefit | **Confirmed**: only PR-B lifecycle (synthetic) evidence exists; no token/cost measurement | Accepted — projection closes with a measurement plan, not just wiring |
| R14 | 18 skips unexplained | **Explained**: mostly POSIX-permission/atomic-write/symlink tests skipped on `win32` (author environment is Windows; hosted CI runs the ubuntu+windows matrix), plus opt-in live `PI_SMOKE` gate and a small number of platform/feature skips | Recorded here; no action |
| R15 | Worktree isolation ≠ sandbox | **Consistent with current claims**: repo claims candidate-scoped tools + retained worktree, never "sandbox"; ADR-006 keeps credential/permission/trust/tool-activation boundaries excluded; write-tool registration is a separate gated slice | Keep claims as-is; write-tool registration treated as capability-boundary expansion (reviewer's framing accepted) |

## Accepted strategy (owner decision recorded for routing)

The review's mainline ordering is **accepted as the default next-phase plan**:

1. Close the review channel decision (owner-preapproved independent backup
   channel; "no silent fallback" becomes "switch only to an approved path,
   with a trail; otherwise stay blocked"). Blocked on owner + relay.
2. Close observation projection **with a measurement plan** (this branch):
   wiring + the new invariant tests below + an explicit real-token measurement
   plan as part of closeout.
3. Real-provider small controlled acceptance: A (native Pi baseline) / B
   (sparkle, frozen routing, projection off) / C (B + projection on);
   20–30 real tasks × 2–3 repeats; report per-accepted-task total cost,
   success rate, human correction time, failure taxonomy. Opt-in, budget-capped.
4. CLI wiring for projection only if the C-vs-B delta justifies it.
5. Write-tool registration last, after the execution-boundary review (R10/R11).

F6 stays a parked research line with a decision node (named owner + material
checklist + degrade rules) — not a mainline blocker. M7: data-qualification
assessment only, no training infrastructure.

## Acceptance criteria added to TASK-20260920-native-observation-projection

From R1–R7 (added to the plan's amended Acceptance Criteria; the base criteria
are already met by the verified implementation):

- sha256-keyed send counter (no fuzzy prefix key); changed-file same-path case
  gets a fresh first-two window.
- File content containing the evidence-receipt marker is never packed
  (fail-closed spoof direction pinned).
- Explicit `isError` forwarded when the wrapped result carries it.
- Recall returns the archived snapshot after the source file is mutated.
- Recall after `delete --run` fails closed with a clear error; post-resume
  counters restart (full sends first), documented.
- Payload-prefix pinning: two consecutive projected requests share an
  append-only message prefix (no history rewrite), pinned at the adapter
  stream-capture level.
- Closeout includes a real-token measurement plan (mechanism/economic/outcome
  layers), not only wiring evidence.

## Review-scope additions for pending independent reviews

- Apply registration review (batched on relay recovery): add R10/R11 —
  acceptance-definition digest binding (which candidate files define what the
  frozen command verifies), handle trust-chain completeness (candidate-tree
  hash at issue, approval identity), and the crash-reconciliation windows
  (accepted→mutated, base advanced pre-merge, post-merge pre-receipt crash,
  duplicate/replay apply).
- Delegate routing review: add R12 behavior pin + per-run policy version/hash
  recording.

## Not accepted / rejected

- Nothing rejected. The review's four "innovation directions" are recorded as
  context only; no new research line is opened by this record.
- The review's product-positioning suggestion ("evidence-traceable,
  change-controlled runtime") is noted; README positioning changes are an
  owner decision and are not made here.

## Open owner items from this disposition

1. Preapprove (or refuse) an independent backup review channel with
   model/credentials/budget/scope recorded.
2. F6 decision node: named owner + restart conditions + degrade rules.
3. Positioning: accept or decline the review's framing for README/status text.

## New finding recorded during this pass (not from the review)

- The projection slice's verification surfaced a real PR-B library bug the
  review could not have known: `ObservationStore.put/recall` shared the run
  lifecycle lock, so every mid-run archive silently degraded to
  `storage-unavailable`. Fixed via a dedicated `observationLockPath`. Recorded
  in the slice's verification record; noted here so the independent review
  sees the library surface changed (lock domain), not just new wiring.

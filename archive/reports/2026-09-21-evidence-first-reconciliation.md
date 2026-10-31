# Evidence-first reconciliation verification record

## Identity

- Task: `TASK-20260921-evidence-first-reconciliation`
- Date/environment: 2026-09-21, Windows worktree `E:\Project\pi-sparkle`
- Current run identity: `PI_SESSION_ID=01a0c457-ae30-747b-8b0d-b8bea6519195`; provider `xhh-luna`, model `gpt-5.6-luna-fast`.
- Prior run: `mubans2h-81481856` timed out after partial edits. The timeout remains recorded as a true prior failure; it is not treated as verification.
- Scope: documentation-only reconciliation and a reproducible checker; no product code, provider experiment, live pilot, apply authorization, write registration, commit, push, merge, deletion, or cleanup.
- Review disposition: **REQUEST CHANGES**. This is fresh-context same-model author provenance, not independent review; no independent reviewer or owner approval has occurred. Fresh low-concurrency re-review remains required.

## Reconciled changes

- `tasks/todo.md` now orders the umbrella slice **Stage 0 boundary freeze → projection hardening → read-only evaluator freeze → exploratory A/B/C pilot**. F6 remains parked by the 2026-09-20 owner decision. The 2026-09-20 relay evidence is explicitly date-scoped: it records failed sampled dispatches, not universal current unavailability and not recovery. The three 2026-09-21 returned reports and this successful implementation dispatch are evidence that current universal unavailability is unestablished; they are not a blanket recovery claim.
- `tasks/plan.md` and `tasks/todo.md` retain merge hashes/counts, PR-A/B/HOTFIX/P3/P4/P5 scope, G0–G3 scope and source links, and dated pre-reconciliation delivery evidence. Superseded annotations distinguish historical records from current work without deleting evidence.
- The evaluator plan/spec retain `boundaryDesignDigest`, the complete frozen-routing tuple (`routingSnapshotRef`, `routingSnapshotDigest`, `loadedPolicyHash`), disabled-routing omission, partial-tuple refusal, fixed retry policy, and no-write/apply semantics. Redundant schema prose was shortened without changing fields or meaning.
- Stage 0 approval/freeze, independent implementation review, owner pilot budget/data approval, live pilot, F6/F-PROD, production apply authorization, and all other human/policy gates remain open.

## Focused checker

Added `.agent_workspace/evidence-first-reconciliation/check-docs.mjs`. It checks all 11 touched documentation documents, resolves local Markdown links and anchors, parses the evaluator interface fields from both evaluator documents, compares the shared field and arm-schema sets, and checks arm/ledger, routing/retry, Stage 0, review-state, and forbidden-completion invariants. It does not use network access.

The first two checker failures were checker defects, not product regressions:

```text
node .agent_workspace/evidence-first-reconciliation/check-docs.mjs
# initial checker: FAIL (18) — schema parser stopped at nested fields and routing union was treated as separate prose values
# corrected checker: FAIL (9) — the broadened arm-schema check exposed missing arm fields and schedule text in the evaluator freeze plan
```

The checker was then corrected to parse the nested arm schema and require the
same identity/retry invariants across every touched document. The focused checker is now green after the schema-parser and evaluator-freeze-plan corrections; the exact final output is recorded below.

## Verification commands

Final commands and exact output are recorded here after the final documentation edits:

```text
node .agent_workspace/evidence-first-reconciliation/check-docs.mjs
targeted-doc-check: PASS (11 documents; links, schemas, arm identity, retry scope, Stage 0 draft, and review-state invariants synchronized)

pnpm workflow:check

> pi-sparkle@0.1.0 workflow:check E:\Project\pi-sparkle
> node scripts/workflow-check.mjs

workflow-check: ok (10 required files, 16 required headings)

git diff --check
(no output; exit 0)
```

No product tests, provider calls, experiment runs, live pilot, F6 run, or apply/write action was performed.

## Risks and handoff

- The amended evidence-first phase remains planned/unaccepted and needs fresh low-concurrency review, including the repository-consistency role that previously hit the concurrency limit.
- Relay outage/review dispatch, owner pilot budget and data-transfer approval, exact preregistration thresholds, Stage 0 owner/reviewer freeze, F6 custody/readiness/seal, and R10/R11 evaluator/apply review remain unresolved.
- This report records author-run command verification only; it is not independent review, human acceptance, provider evidence, production approval, apply authorization, or an Outcome-supported claim.
- Pre-existing dirty and untracked content was preserved; explicitly allowed documentation paths were edited in place. Other pre-existing paths were not intentionally edited. This does not claim that all previously dirty files were untouched.

## Host closeout after the second timeout

- Subagent runs: `mubans2h-81481856` timed out at 240s; `mubb3yur-3337a7a5` and `mubbpiv0-fa857608` completed the initial reconciliation/corrections; read-only review `mubcd7l9-651229f5` returned REQUEST CHANGES; correction run `mubcjllz-60aaffc6` timed out at 600s. Its final transcript repeatedly contains edit-tool validation errors (`path` missing). Partial artifacts are retained; the final correction is NOT accepted.
- Host reran `node .agent_workspace/evidence-first-reconciliation/check-docs.mjs`, `pnpm workflow:check`, and `git diff --check` after that timeout: respectively PASS (11 documents), `workflow-check: ok (10 required files, 16 required headings)`, and exit 0/no output. These checks do not establish semantic correctness.
- Residual P1: the Stage 0 draft encodes `boundaryDesignDigest` with a `sha256:` prefix, while the evaluator manifest expects lowercase SHA-256 values. Choose one wire representation consistently before implementation. Approval hashing must also retain the bound design digest; excluding that reference is not necessary to avoid circularity.
- Residual P1: the A baseline is native Pi single-agent, but amended documents attribute pi-sparkle's `src/pi-adapter/native-executor.ts` / `PiAgentExecutor` tool and retry behavior to A. Those sources establish B/C behavior only; A's actual host execution/tool/retry policy remains to be inspected and frozen independently.
- Residual schema work: the manifest retains common runtime/tool/routing fields alongside per-arm fields without defining their precedence, and embeds the temporary literal `taskAttemptEnforcement: "not-implemented"` in the proposed frozen schema. Separate draft implementation readiness from frozen execution policy and clarify the digest input (excluding its own derived digest).
- The same-model fresh-context consistency review did execute; only independent review and the subsequent correction re-review remain open. Earlier wording about the consistency role not running refers to the original four-way dispatch, not this session.
- Two scratch historical copies created by subagent work at repository root (`.agent_workspace_head_plan.txt`, `.agent_workspace_head_todo.txt`) were moved without deletion to `.agent_workspace/evidence-first-reconciliation/`; unrelated `nul` and `pelican-bike.html` remain untouched.

Handoff: fix these concrete documentation contradictions in a bounded follow-up, rerun semantic review, then obtain independent review and owner Stage 0 approval. Do not start product implementation requiring that freeze, live providers, or write/apply work before the named gates close.

Evidence: [reconciliation plan](../superpowers/plans/2026-09-21-evidence-first-reconciliation.md), [expert review](2026-09-21-evidence-first-plan-expert-review.md), [re-review request](2026-09-21-evidence-first-plan-re-review.md), [relay outage](2026-09-20-luna-dispatch-outage.md).

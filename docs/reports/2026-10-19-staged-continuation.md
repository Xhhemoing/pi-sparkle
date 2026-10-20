# Staged ADR-009 continuation verification

## Identity
- Task: TASK-20261019-staged-continuation.
- Date/environment: 2026-10-19 (America/Los_Angeles), Windows; existing codex/command-tool-uncertainty-20261019 checkout based on 2ec715a5.
- Owner: root coordinator. Independent agents: gpt-6.1-sol/high, fresh context.
- [Plan](../superpowers/plans/2026-10-19-staged-continuation.md).

## Initial source reconciliation
Ten pre-existing task files are preserved. No unrelated user edits are reset. Read-only feasibility review verified that production CodeMap construction has no source input and that the parent grounder replaces a child-supplied contextPacket. M1 must test actual dispatch. Existing M2/M3/M4/M6/M7 machinery is reused; no whole-roadmap completion is inferred.

## Commands and reviews
| Command/review | Result | Evidence |
|---|---|---|
| pnpm test --test-concurrency=1 test/unit/pi-adapter/worktree-coding-tools.test.ts test/integration/development/controller-admission.test.ts | PASS: 23/23, no skips | .agent_workspace/staged-continuation/uncertainty-focused.log |
| M0-C specification review / uncertainty_spec | PASS, static independent review | Synchronous typed receipt, sticky uncertainty, no check/repair, durable ownership match requirements. No tests run by reviewer. |
| M0-C code-quality review / uncertainty_quality | PASS, static independent review | Cancellation settlement, factory disposal, metadata privacy, experimental callback compatibility and tests inspected. No actionable findings. |
| pnpm gate | FAIL: 3646 pass / 1 fixture cleanup failure / 48 skip | .agent_workspace/staged-continuation/uncertainty-gate.log; process-local affinity 3 gives availableParallelism=2, reducing competing test files without changing repository scripts. |

## Open scope
Implementation and command verification, independent static review, human approval, publication and outcome support are separate. Historical full-gate failures remain in the original M0-C report; the running command is not yet passing evidence. Provider/crash/benchmark/holdout runs are not enabled. Continue scoped implementation after M0-C closeout; no final completion claimed.

## Read-only feasibility findings retained for subsequent implementation
- M2: avoid adding package exports solely for convenience; even wildcard exports can change legacy extensionless CommonJS resolution. Physical sdk forwarders preserve the resolver. [Scoped SDK plan](../superpowers/plans/2026-10-19-sdk-contributions.md).
- M3: independent-check already has an in-memory trustedChecks WeakMap. Exact descriptor/object evidence rejects spread/serialized copies. Existing evaluation invalidation should be reused rather than duplicated. Findings must not elevate checker stdout to verified source locations.
- M7: HostTerminalOutcome and binding assessment already exist, but no actual host publisher is wired. Existing TASK_RESULT-derived learning projections are not independent host acceptance. Read-only reviewer also identified possible legacy attribution defects (PARTIAL/CANCELLED handling and retained modelVersion after an unknown-version retry in from-episode); verify those with focused RED before any correction. No production/model-benefit claim follows from those projections.
- Candidate M1 service currently has 20 passing cases and one intended UTF8 RED. Untracked source/test are temporarily retained in .agent_workspace/staged-continuation/m1-pending while the initial source gate runs. No existing runtime source was changed by that partial service work.
- M1 service specification review (task_context_spec) passes bounded source review, pending strict UTF8 reader support and final executor-prompt integration. Reviewer did not run tests. Quality review is separate.

## Isolation adjustment during verification
The initial full gate is exercising slow real Git/process integration scenarios. To keep its runtime source unchanged while continuing M1, root requested managed worktree staged-context-20261019 at the same Git base 2ec715a5. The original ten-file diff and gate remain in the original checkout. The staged M1 files will be copied into the new checkout and independently verified there; reviewed source commits are integrated only after resolving any overlapping native-session changes. No user changes are discarded.

## M1 service verification in managed worktree
Managed workspace: C:/Users/86080/.codex/worktrees/staged-context-20261019/pi-sparkle, same base plus copied M0-C source. Installed pinned dependencies are reused through a node_modules junction; no network install or lockfile change.

- Independent specification review: PASS for bounded service; actual executor wiring remains separate.
- Independent quality review found P2: exact 65,536-byte required content followed by an empty required file was refused. Builder added a regression, observed RED 0/1, then corrected it.
- Service GREEN: 23/23, including strict UTF8 and aggregate/optional limits. Logs in that worktree: m1-service-boundary-red.log and m1-service-green.log under .agent_workspace/staged-continuation.
- Strict UTF8 is additive opt-in on WorkspaceFilesContext and covers returned whole/range buffers; old default decoding remains unchanged.
- Quality re-review and native/direct/conversation integration RED/GREEN are pending. No M1 completion or commit claimed yet.

## Real-provider authorization update
User explicitly selected real-model validation during this session. Provider/model ID, total cost ceiling and existing credential/config location are still pending; no paid dispatch has started. Proceed with local implementation and independent reviews while awaiting those parameters. Real-provider results must retain their own task eligibility, measured usage/coverage and outcome evidence; they cannot be inferred from the scripted executor regressions.

## Real-provider parameters confirmed
User supplied https://api.xhh.cloudns.be/v1, recommended gpt-6.1-sol and explicitly removed a fixed monetary ceiling while asking for cost-effective testing. The previously configured XHH_API_KEY returned HTTP 401 on read-only model metadata. A newly user-supplied credential, retained only in tool/session memory, successfully read the model catalog and confirmed gpt-6.1-sol among 9 models. No secret or auth header is stored in this record. Catalog metadata contains no pricing, so dollar cost remains unknown unless authoritative rates become available; reported usage is recorded separately. Start with two small synthetic candidate tasks, bounded attempts/wall time/output, then assess whether additional calls answer a new question. No broad benchmark, holdout or production promotion is inferred.

## Live synthetic provider smoke (opt-in, actual execution)
User explicitly authorized this endpoint/model and cost-effective paid calls without a fixed monetary ceiling. [Pre-registered plan](../superpowers/plans/2026-10-19-live-development-smoke.md). Executed `pnpm exec tsx .agent_workspace/staged-continuation/live-trial.ts` in the managed workspace: exit 0. Two preselected synthetic Git fixtures used actual Pi/provider execution, fresh M1 candidate context, file tools and an external host Node verifier. Both returned COMPLETED and accepted=true; exact candidate bytes matched; original source bytes, HEAD and Git status remained unchanged. No source apply occurred.

| Fixture | Calls | Reported input/output tokens | Wall time | Outcome |
|---|---:|---:|---:|---|
| status-literal | 1 | 3608 / 165 | 18076.8 ms | accepted, settled |
| increment | 1 | 2760 / 182 | 12085.5 ms | accepted, settled |

Total reported usage: 6368 input / 347 output tokens. Both call outcomes are ok. USD cost is unknown because authoritative endpoint rates are unavailable; do not infer zero from missing prices. Private scratch evidence: managed workspace `.agent_workspace/staged-continuation/live-trial.log`, script `live-trial.ts`, and `live-eab315f2-edd0-449d-9f6a-e1dc8235720c/summary.json` with actual run/check artifact references. Credentials were process-local and are absent from tracked records. This is a two-case connectivity/execution smoke, not a benchmark, comparative benefit result, holdout, production qualification or whole-M1 acceptance.

## M1 full focused verification and independent review
The earlier service-pending snapshots above are superseded by actual managed-workspace checks. Integration RED: 11 expected failures before wiring. Integration GREEN: 11/11, covering final executor prompt, dispatch refusal, repair freshness/failure evidence and conversation registration. Adjacent native/direct/context/conversation/workspace tests: 131 pass / 0 fail / 1 existing Windows skip; service 23/23 is included. Combined unique focused total: 142 pass / 0 fail / 1 skip. A final repair-evidence assertion rerun passes 1/1. Typecheck and focused seven-file lint pass. Exact logs: m1-integration-red.log, m1-integration-green.log, m1-adjacent.log, m1-repair-evidence.log, m1-typecheck.log and m1-focused-lint.log under managed `.agent_workspace/staged-continuation/`.

Independent service quality re-review and integration specification/quality reviews all pass. Reviewers inspected source and command evidence, did not independently execute tests. M1 remains pending source integration, final integration gate and its own commit; no old gate result is attributed to new source.

## SDK review iteration (implementation worktree)
The SDK builder produced physical host/testing forwarders, lazy read-only contribution host, two public-entry consumers and an actual packed artifact probe. Initial 11/11 passed. Independent specification review reproduced output-getter-triggered close publishing a late available result. Builder recorded RED in sdk-snapshot-close-red.log, fixed post-snapshot lifecycle checks and expanded to 16/16; specification re-review passed. Independent quality review executed those 16 tests and the existing packed probe successfully, then separately reproduced two getter reread defects: callback validation differed from the staged value, and diagnostic severity validation differed from the published value. Those findings remain under correction; do not treat the earlier GREEN or spec review as final SDK acceptance. No commit or production SDK stability claim yet.

## Additional feasibility and attribution design
Read-only remaining_feasibility and attribution_design agents identified concrete local follow-ups, now recorded in [local follow-ons](../superpowers/plans/2026-10-19-local-followons.md) and [host attribution](../superpowers/plans/2026-10-19-host-attribution.md). Actual native checks retain an in-process private trust identity; persisted artifact JSON is not a trusted publisher. Repairs create new run/task IDs, so offline leakage prevention needs one logical execute identity across attempts. Unknown actual model versions remain exclusions. Existing legacy PARTIAL/CANCELLED and retry-version replay hypotheses require observed RED before corrections.

## Integrated gate observation still under diagnosis
The running original-source gate reported one failure: `Git tree path-list output is capped before unbounded parsing` in test/unit/execution/exact-git-tree.test.ts. The unchanged selected test was executed separately with `pnpm test --test-concurrency=1 --test-name-pattern='Git tree path-list output' test/unit/execution/exact-git-tree.test.ts`: PASS 1/1, exit 0 (tree-limit-focused.log). This does not erase the full-gate failure. Await complete error diagnostics before deciding a correction; no product bound or assertion has been relaxed. The formerly failing batch cases passed in the current full run.

### Tree-output test failure reproduced and localized
The first repeat of the unchanged selected test failed (tree-limit-repeat-1.log, 0 pass / 1 fail). Its behavior assertion completed; the actual failure is the fixture after-hook at exact-git-tree.test.ts:25: Node fs.rmSync throws EPERM deleting its own temporary Git directory on Windows. This is not evidence that output limits failed. A bounded cleanup retry, consistent with existing test fixture patterns, is the proposed test-only correction; it must not change production Git bounds or skip the assertion. Verify the observed failing file repeatedly and retain the actual full-gate failure before a fresh final gate.

## M0 checkpoint verification result
Original full gate finished with 3646 pass / 1 fail / 48 skip; exact failure was reproduced Windows EPERM fixture teardown. Corrected exact-git-tree full file: 25 pass / 0 fail / 2 platform skips (tree-limit-green.log). Four further unchanged product-behavior selected runs passed with bounded cleanup retry (tree-limit-fixed-repeat-1..4.log); focused fixture lint passed. Independent uncertainty_quality review confirms only cleanup retry changed, all bounds/assertions and exhaustion error remain; M0 source diff remains the previously approved one. Current build PASS, security 26 PASS, Pi 4 PASS and workflow PASS. Final full integrated gate is still open. These facts authorize a local source checkpoint, not merge/production acceptance.

## SDK final focused/review result before integration
Getter reread RED: 16 passing / 5 failing (sdk-getter-red.log). Final builder focused: 21/21; typecheck, focused lint, build, actual repack and consumer compile/run all pass. Independent quality reviewer independently reran 21/21 and the two original getter reproductions after the fix: PASS; no remaining actionable findings. Final packed consumer directory sdk-consumer-XIYa58, evidence in managed sdk-consumer.log. Spec review already passed the lifecycle correction. SDK source integration, local commit and final integrated full gate remain pending.

# Opt-in real-provider development smoke

## Identity
- ID: TASK-20261019-live-development-smoke
- Owner: root coordinator; provider access explicitly authorized by user during this session.
- State: in-progress.
- Date: 2026-10-19 (America/Los_Angeles).
- Provider/model: https://api.xhh.cloudns.be/v1 / gpt-6.1-sol; fresh credential in session memory only.
- Cost: user chose no fixed monetary ceiling and requested cost-effectiveness. Start small; metadata has no authoritative price rates, so USD remains unknown, not zero.

## Question, eligibility and scope
Can the actual Pi adapter and selected provider complete a tiny isolated file edit through the new M1 task-context path, with acceptance decided by the real host checker and unchanged source checkout? This is a capability smoke, not a comparative benchmark or evidence of model-quality/cost improvement.

Two preselected synthetic fixtures: (1) change a status literal in a text file; (2) repair a one-line increment function. Each task receives the exact required candidate file and an immutable initial revision. Host verification compares exact expected bytes using a host-owned Node -e command; models cannot change the verifier definition. No commands are exposed to the worker beyond existing scoped file tools. No real user repository content, credentials or private tasks are sent to the provider.

Each case uses one native attempt, no provider retry/fallback, low reasoning setting, max output 4096 and 180-second wall limit. Stop further cases on authentication, protocol or unsettled-effects failure; inspect evidence before retrying. Keep candidate and run evidence under .agent_workspace/staged-continuation. Record actual provider calls, call outcomes and reported token counts; missing usage/pricing remains unknown. Do not set a guessed catalog rate to simulate a cost cap.

## Acceptance and verification
- Actual provider invocation recorded through PiAgentExecutor; at least one real call, not faux executor.
- Real host verification accepts exact candidate bytes; original source file and revision are unchanged.
- Actual executed prompt receives task context, and candidate remains available for inspection.
- Any failure is retained with bounded reason and actual usage; no fabricated success, automatic apply, production activation or broad learning update.
- Durable report includes code/workspace provenance, command, outcomes, skips and limits; scratch raw run data is never committed.

## Follow-up
Run the two cases once after M1 focused/review acceptance. Further calls require a concrete unresolved question and retain the user's cost-efficiency instruction. Real production/holdout gates and full M0 platform containment remain separate.

## Follow-up eligibility smoke (planned after M7 publisher integration)
The original two fixtures passed as recorded in the staged report. After the actual host publisher is implemented/reviewed, one additional synthetic status-literal task may answer a new question: does live Pi telemetry reach the host-owned collector while an unpinned/unknown actual modelVersion remains explicitly ineligible for model-quality attribution? Forward the existing invocation callback to both host collector and private usage capture; do not invent a version or rates. Require real checker acceptance/source unchanged, nonempty observed invocations, reported usage coverage, and explicit unknown-version exclusion. Same endpoint/model, one native attempt, output/wall bounds and credential handling. No comparative experiment, holdout, online policy or extra broad provider runs are authorized by this smoke record. Keep status planned until executed evidence exists.

### Follow-up execution note
The first eligibility smoke executed on the frozen managed publisher source after independent specification review and before source integration/quality closeout. Provider request timed out (one actual call, no reported usage); the expected unknown-version assertion failed. Preserve this evidence. One later same-bounds retry is justified only to resolve that still-untested plumbing/version question after the quality correction, not to select a successful sample or claim comparative benefit. The harness now persists the observed result before its reason assertion so a different terminal outcome remains inspectable.

### Harness correction before the final targeted call
The one retry completed an accepted exact edit (4654 input /168 output tokens), but the harness had omitted trustedVerification and correctly received original-exact-evidence-required instead of the intended unknown-version exclusion. That is a harness failure, not evidence of an attribution defect. Prepare the descriptor from the same host-owned command before dispatch. The corrected harness was first run with a controlled faux executor and actual Git/Node check: exit0, accepted exact edit, source unchanged, unknown-or-mixed-model-version exclusion; zero network/provider calls (its older providerCalls label counted the single synthetic callback). After this local correction, perform at most one additional actual call with the same original bounds. Preserve all failed observations; do not treat retries as an estimated success rate or claim model-quality benefit.

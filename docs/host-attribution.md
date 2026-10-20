# Native host attribution

Host attribution is an opt-in read model of an actual native execution and independent checker. It does not accept a queue item, apply a candidate, select models or promote learned policy.

Pass `hostEvaluator` to `NativeWriteSession` or `startDevelopmentTask`, specifying evaluator/rubric identity and versions, a canonical JSON definition, and the nonzero checker exits that specifically represent model-evaluated failure. Generic nonzero exits remain unavailable unless declared. The executor factory must forward its `onInvocation` callback into the existing Pi executor callback; compose any existing telemetry sink as well.

The returned `hostObservation` binds one logical task across repair attempts. Attempts retain parent run/check/artifact identities and actual child execution identities separately. Actual model invocation provider, model and version must be consistent across every attempt. Routing aliases cannot fill missing versions. Missing or malformed telemetry, provider/tool/runtime failures, cancellation, unsettled effects, or missing original trusted check evidence produce an explicit `UNOBSERVED` assessment. Ordinary task acceptance is still decided by the existing checker.

`isNativeHostObservation` from `src/native/write-session.ts` recognizes only an original object issued by real session finalization in the current process. Copies, parsed artifacts and projections assembled by exported helpers cannot recreate that provenance. Host factories and callbacks are trusted same-process code; this interface is not a sandbox.

The existing run artifact store retains bounded references, not prompts or source text. Published invocation snapshots carry reported usage and preserve `pi`/`faux` provenance. Unknown usage or prices stay unknown. With attribution disabled, no collector or observation artifact is created. Actual results also expose additive task/logical-task identities; historical reconstructed results may lack them.

[Implementation plan](superpowers/plans/2026-10-19-host-attribution.md) · [Verification record](reports/2026-10-19-staged-continuation.md). Offline dataset preparation is a separate slice. Real-provider capability smoke is separate from model-quality benefit and production authorization.

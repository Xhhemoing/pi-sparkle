# Inspect host check findings

Native development results may include `findings` when the host supplied an
original trusted verification descriptor and the actual checker produced valid,
settled exact evidence. A completed failing check yields a generic historical
observation. A successful trusted check yields an empty array. An absent field
means this stronger observation evidence is unavailable; it does not mean PASS.

```ts
// result is the actual awaited startDevelopmentTask/NativeWriteSession result.
if (result.findings === undefined) {
  console.log("Trusted findings unavailable");
} else {
  for (const finding of result.findings) {
    console.log(finding.message, finding.evidenceRef, finding.revision);
  }
}
```

The experimental `evaluation/check-findings` module also exposes
`findingsFromIndependentCheck` for host code retaining the original
`runIndependentCheck` record and descriptor. Copied, serialized or foreign
records cannot recover in-memory trust. The projection returns explicit
`available`/`unavailable` state; it never parses checker stdout into claimed
source locations or publishes raw output in the default message.

`partitionCurrentFindings(findings, { revision, generation })` returns `current`
and `stale` arrays. Exact repeated observation identities coalesce; a fresh check
remains visible. Native generation is the actual attempt run ID. Stale evidence
is retained for inspection, not deleted or silently made current.

Findings carry an opaque check reference, source base revision and attempt
identity. They describe a historical check; they are not proof that current
candidate bytes remain unchanged, a model-quality label, queue acceptance or
permission to apply or repair. Existing native repair, cancellation and effect
settlement rules remain authoritative. Descriptor-free checks and untrusted or
interrupted evidence do not acquire stronger observations.

[Plan](../archive/superpowers/plans/2026-10-19-check-findings.md) and
[current verification](../archive/reports/2026-10-19-staged-continuation.md).

## Optional host analysis

Set `checkFindingAnalysis` on `NativeWriteSession` or `startDevelopmentTask` to
analyze actual trusted failing checks. The callback receives a frozen finding,
the existing bounded `feedback`, and a cancellation signal. Return an object
with an own string `summary` property, or an ordinary native Promise of that object (including a normal cross-realm Promise).
Arbitrary thenables and accessor summaries are unavailable outputs. No callback
runs for successful checks, unavailable trusted evidence or unsettled effects.

```ts
// hostTask already supplies the executor and original trusted verification.
const result = await startDevelopmentTask({
  ...hostTask,
  checkFindingAnalysis: {
    timeoutMs: 5000,
    analyze: ({ finding, feedback }) => ({
      summary: `${finding.message} Observed checker exit: ${feedback.exitCode}.`
    })
  }
});
console.log(result.findingAnalyses);
```

One execute coalesces identical pending/completed evidence. Its default analysis
capacity is 32 (maximum 256), timeout 5000 ms (maximum 30000), and summary limit 2048
UTF-16 code units (maximum 4096). Full capacity declines further analysis; original
findings remain evidence. `findingAnalyses` partitions immutable advisory history
into `current` and `stale` by the final attempt identity. A later successful
attempt does not turn an earlier failure summary into current evidence.

Summaries are untrusted text: they are not inserted into the next writer's
objective and do not change acceptance, repair limits or apply permission. Checker
stdout/stderr are each limited to 4096 code units through existing repair feedback;
these limits do not redact secrets printed by a checker. Enabling this callback
explicitly discloses that bounded output to trusted host code.

Constructor overrides, Promise subclasses, custom species and modified intrinsic Promise metadata are unsupported. Descriptor checks reject obvious invalid metadata without calling its getters; they cannot prove arbitrary cross-realm metadata is ordinary. The trusted host must preserve this precondition and own settlement/rejections of unsupported asynchronous returns.

Timeout bounds waiting, not callback execution. Supported raw callbacks remain owned until
they actually settle; `shutdown()` waits for them even after `execute()` returned.
`startDevelopmentTask` awaits shutdown in its finally block, so an uncooperative
callback can delay that helper indefinitely. Same-process synchronous code can
also block timers. Use cooperative callbacks; this API provides no sandbox or
hard termination. Cancellation still cancels the native result, including the
default one-attempt path without a host evaluator.

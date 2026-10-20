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

[Plan](superpowers/plans/2026-10-19-check-findings.md) and
[current verification](reports/2026-10-19-staged-continuation.md).

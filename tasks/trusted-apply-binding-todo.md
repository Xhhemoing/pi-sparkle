# Trusted candidate application checklist

Plan: [exact tree binding](../docs/superpowers/plans/2026-10-15-trusted-apply-binding.md). Baseline `e837aab`.

- [x] TA-00 stable registration input snapshots
- [x] TA-01 bounded exact Git tree comparison
- [x] TA-02 fresh host capability for opt-in native apply
- [x] TA-03 checked bytes/tree and transform-safe application
- [x] TA-04 prepared target persistence callback and fences
- [x] TA-05 explicit queue integration/dependency demonstration
- [ ] TA-06 independent review, aggregate/hosted checks and staged saves

This does not close production/R10/R11/live gates or introduce automatic integration.

Implementation closeout: TA-00 registration 23/23; TA-01 exact tree 26 pass / 0 fail / 1 Windows skip; TA-02/03 trusted apply 16/16 plus existing apply/source/unit 26/26; TA-04 callback fences included; TA-05 explicit queue integration demo PASS with dependent task from integrated revision and stale sibling refusal. Local full suite is 3574 total / 3572 pass / 0 fail / 2 skips. TA-06 remains pending hosted cross-platform evidence and final staged save.

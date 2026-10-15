# Trusted candidate application checklist

Plan: [exact tree binding](../docs/superpowers/plans/2026-10-15-trusted-apply-binding.md). Baseline `e837aab`.

- [x] TA-00 stable registration input snapshots
- [x] TA-01 bounded exact Git tree comparison
- [x] TA-02 fresh host capability for opt-in native apply
- [x] TA-03 checked bytes/tree and transform-safe application
- [x] TA-04 prepared target persistence callback and fences
- [x] TA-05 explicit queue integration/dependency demonstration
- [x] TA-06 independent review, aggregate/hosted checks and staged saves

This does not close production/R10/R11/live gates or introduce automatic integration.

Implementation closeout: TA-00 registration 23/23; TA-01 exact tree 26 pass / 0 fail / 1 Windows skip; TA-02/03 trusted apply 16/16 plus existing apply/source/unit 26/26; TA-04 callback fences included; TA-05 explicit queue integration demo PASS with dependent task from integrated revision and stale sibling refusal. Local full suite is 3574 total / 3572 pass / 0 fail / 2 skips. TA-06 is closed after the source-disjoint PASS review, exact staged tree evidence, and five hosted jobs passing on Node 22.19.x / pnpm 10.17.1.

Hosted evidence for remote head `df28c0b4ce560b66b9472d2f716c75155a5901b9` (tree `25e16232faae04729c93140c8ed82cdf6c496b54`): [CI 38684829754](https://github.com/Xhhemoing/pi-sparkle/actions/runs/38684829754) passed quality plus Ubuntu/Windows smoke; [root regressions 38684828933](https://github.com/Xhhemoing/pi-sparkle/actions/runs/38684828933) passed Ubuntu/Windows. Main remains unchanged and this checkpoint does not close production/R10/R11/live gates.

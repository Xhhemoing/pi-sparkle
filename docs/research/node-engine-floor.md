# Node engine floor evidence

## Recorded measurement

On 2026-08-25, Round 1 ran the full `pnpm test` suite on Node v22.14.0. The run
completed green: 2,050 tests were discovered, 2,049 passed, one was skipped, and
none failed.

The package declared `"node": ">=22.19.0"` when that run was made, and that
declaration remains unchanged.

## What the result does not establish

This is one recorded test run, not a compatibility guarantee for Node v22.14.0
or for every version below v22.19.0. It does not prove that unexercised CLI,
provider, filesystem, or platform paths work on those versions. The declared
floor is a pin enforced by tooling; it is not presented as the first observed
failing Node release.

## Criteria for changing the floor

Lowering the floor requires either:

1. archaeology and targeted testing that record a concrete failing reason below
   v22.19.0, establishing a defensible boundary; or
2. an explicit maintainer decision to drop or replace the existing pin, with
   the resulting compatibility policy stated directly.

Until one of those occurs, `package.json` continues to require Node
`>=22.19.0`.

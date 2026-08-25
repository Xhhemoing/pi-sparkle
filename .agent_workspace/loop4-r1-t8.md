[Model: gpt-5.6-sol-xhigh-fast]
# Loop 4 Round 1 — T8 protocol v1 structured fuzz

## Seed

- Fixed default seed: `0x4f310008`
- Failures print the seed, iteration, validator surface, and unexpected error.

## Mutations run

- 3,000 `AgentMessage` candidates, starting from one validated fixture for each of the five message types and applying 1–3 mutations per candidate.
- 800 approval plan/reply pairs, independently mutating both values while retaining periodic valid controls.
- 800 generated message arrays for `assertAtMostOneTerminal`, including malformed entries, boundary-position terminals, inflated arrays, and valid controls.
- Mutation classes: dropped, retyped, inflated, and renamed fields; own `__proto__`/`constructor` keys; corrupted enums, IDs, timestamps, numeric limits, and bounded nested objects.
- Every successful validation was repeated and compared by deep equality. Every rejection was required to have `error.constructor === DomainValidationError`.

## Defect found and fixed

- Initial run at seed `0x4f310008`, terminal iteration 0: `assertAtMostOneTerminal([null])` escaped `TypeError: Cannot read properties of null (reading 'type')`.
- Minimal fix: `assertAtMostOneTerminal` now validates each array entry with `validateAgentMessage` before checking whether it is terminal. Malformed entries therefore fail closed with exactly `DomainValidationError`.
- Named regression added for the malformed-array entry.

## Explicit cases

- Own proto-pollution keys remain inert data and do not alter `Object.prototype`.
- Duplicate terminal messages at the first and last array indices are rejected.
- 10,000-entry protocol and message arrays complete with the required error-class discipline.

## Verification

`pnpm test -- test/unit/protocol/fuzz.test.ts test/unit/protocol/v1.test.ts`

- Result: 20 passed, 0 failed.
- Total test duration reported by the runner: 867.85 ms.
- The three fuzz subtests completed in approximately 623 ms combined.

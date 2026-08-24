# loop4-r1-t8: typecheck hotfix (TS2339 evidenceIds on AgentMessage)

The gate failure at `test/unit/protocol/v1.test.ts(302,56)` came from reading `.evidenceIds` directly off the
return value of `validateAgentMessage(...)`, which is the `AgentMessage` union; `TaskRequest` and `AgentQuestion`
and `PeerMessage` members of that union carry no `evidenceIds`, so the property access was rejected. The fix,
confined to the owned test file, binds the validated message to a `const validatedProgress` and asserts
`validatedProgress.type === "PROGRESS"` via `assert.ok`, whose `asserts value` signature narrows the union to
`ProgressUpdate` through the `type` discriminant before the length assertion runs. This keeps full type strength
(no `as any`, no cast at all) and additionally strengthens the test at runtime, because it now verifies that the
validator actually preserves the PROGRESS discriminant instead of silently accepting any variant. No change was
needed in `src/protocol/v1.ts` — the union and the `ProgressUpdate.evidenceIds` declaration were already correct,
so this was purely a test-side narrowing gap. Verification: `pnpm typecheck` exits 0 with no remaining errors
anywhere in the project, and `npx tsx --test test/unit/protocol/v1.test.ts` passes all 17 tests. Nothing was
committed, per instructions.

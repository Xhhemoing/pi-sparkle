# D36 landing recheck — KEEP

Verdict: **KEEP** landing `2e9d35ef949be21dbfe5a321f513a6bfbad57bd5`
on `origin/cursor/validate-path-retarget-0da8` ([PR #18](https://github.com/Xhhemoing/pi-sparkle/pull/18)).

Independent review against
`origin/cursor/pi-sparkle-sota-opt-0da8...origin/cursor/validate-path-retarget-0da8`
confirms the Rank 3 contract:

- Blank `--children` and `--flowchart` values refuse before reads with
  `command: "validate"` and `stage: "parse-args"`, naming the selected flag.
- The shared catch is ordered correctly: `DomainValidationError` keeps the
  existing spec `validation` response; a remaining coded error becomes
  `lookup` and reports `cannot read <flag> <path>: ...`; an uncoded unexpected
  error retains `execute`.
- EISDIR is covered as the same coded lookup class for both path flags, rather
  than special-casing ENOENT.
- In the flowchart branch, `buildLiveCatalogConfig` and its dedicated catch
  still run before `parseFlowchartFile`. Therefore an unreadable flowchart
  becomes `lookup` only after catalog construction succeeds; catalog failures
  retain their existing response.
- The production diff changes only `src/cli/validate.ts`.
  `src/cli/children-spec.ts`, `src/cli/flowchart-io.ts`, and `src/cli/main.ts`
  are untouched. The `VALIDATE_OK` success assembly is unchanged.

Verification from a detached worktree at `2e9d35e`:

```text
npx tsx --test test/unit/cli/validate.test.ts
18 tests passed, 0 failed
```

The worktree initially lacked dependency links and failed module loading before
test execution. After exposing the repository's existing `node_modules`, the
same prescribed command passed all 18 tests. The temporary worktree was
removed. No implementation change is warranted.

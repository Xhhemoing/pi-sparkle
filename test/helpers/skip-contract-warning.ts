/**
 * The one stderr line a contract-less start prints.
 *
 * `--flowchart` and plain `--children` bind `skipContract: true`, so
 * `assertCoverageAllowsStart` never runs and the CLI discloses that once per
 * start (`coverageGateSkippedWarning` in `src/cli/main.ts`). Tests whose point
 * is "this path is otherwise quiet on stderr" strip the disclosure here rather
 * than each carrying its own copy of the pattern; the disclosure itself is
 * pinned in `test/integration/cli/skip-contract-warning.test.ts`, which is
 * where a change to its wording should go red.
 */
export const SKIP_CONTRACT_WARNING =
  /^warning: run run_[A-Za-z0-9_-]+ started without a requirement contract \(skipContract: true\)/;

/** `stderr` with the disclosure's line removed, joined back as it was. */
export function stripSkipContractWarning(stderr: string): string {
  return stderr
    .split("\n")
    .filter((line) => !SKIP_CONTRACT_WARNING.test(line))
    .join("\n");
}

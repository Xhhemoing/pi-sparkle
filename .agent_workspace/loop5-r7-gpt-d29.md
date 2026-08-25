# Loop 5 · Round 7 — D29 independent landing recheck

Target: `origin/cursor/doctor-help-dialect-0da8` at
`0244549dab7e989de6824edbd5f12c043532ec32`

Ranked contract: GPT D29 **KEEP**; Fable Rank 2.

## Verdict — KEEP

The landing matches the ranked contract.

1. **Parser/help boundary: PASS.** The `try/catch` contains only the
   synchronous `parseArgs(...)` assignment. `--help` and `-h` return
   `DOCTOR_USAGE` with exit 0 before `readPackageEngines()`, lock inventory,
   run-state inventory, learned-state inventory, storage inventory, or any
   check. Direct CLI reproduction with a fresh child `--state-root` returned
   exit 0, empty stderr, usage on stdout, and `stateRootExists: false`.
2. **Malformed argv dialect: PASS.** Direct `doctor --bogus` reproduction
   returned exit 1, empty stdout, and the structured report
   `command: "doctor"`, `stage: "parse-args"`,
   `next: "run pi-sparkle doctor --help"`. The unit pin for positional
   `doctor help` asserts the same command/stage/remedy and empty stdout.
3. **Frozen doctor surface: PASS.** `DoctorJsonReport` retains, in order,
   `version`, `preview`, `liveAdaptive`, `ok`, `checks`, `next`, `locks`,
   `runStates`, `learnedState`, `storage`. The existing exact contract test
   still pins those ten keys, sixteen checks, and four inventories.
   `DoctorInFlightRunStatus` remains exactly `PLANNING | RUNNING`.
   `DOCTOR_ROUTED_NEXT` remains the existing five-entry map. The commit does
   not touch `main.ts`; its only `doctor.ts` hunks add usage and alter the
   lexical argv boundary, leaving D22 storage/inventory code unchanged.
4. **Footprint/portability: PASS.** The commit changes only
   `src/cli/doctor.ts` and `test/unit/cli/doctor.test.ts`. New tests use
   Node temp/path/filesystem APIs and captured argv/I/O, with no
   platform-specific path or shell assumption.

Verification at `0244549`:

- doctor unit file: **32 passed, 0 failed**
- strict typecheck: **passed**
- ESLint on both changed files: **passed**
- `git diff --check`: **passed**

No remaining contract bytes.

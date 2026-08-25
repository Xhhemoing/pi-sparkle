# Loop 5 · Round 7 — GPT independent ranking challenge

Analysis only. Fetched and reviewed
`origin/cursor/pi-sparkle-sota-opt-0da8` at
`152e61f586246645690fc4ca4465cdf9aa211184`; Fable ranked at
`786f23ea994fdf1ac3aaf0e20a0474d94e347505`.

PR #12 was re-read live at open head
`5c6376cde6e34271288b98cd4c4737050553a2e7`. Its source files remain
`src/adaptation/eval-routing.ts`, `src/cli/adapt.ts`,
`src/cli/inspect-format.ts`, `src/cli/main.ts`,
`src/feedback/redaction.ts`, `src/pi-adapter/runtime.ts`,
`src/run/flowchart-run.ts`, and `src/run/inspection.ts`. None of the six
ranked source/test paths is in that live file list.

Direct CLI probes reproduced the claimed operator surfaces:

- `auth badcmd` emitted usage and an unstructured refusal; `auth status
  --json` failed as `stage: execute`; `auth login --help` printed usage as
  part of a missing-provider failure and exited 1.
- `doctor --help` and `doctor --bogus` both failed as `stage: execute` with
  the generic doctor remedy.
- invalid inject values are not checked before lookup: both
  `--type banana` and `--confidence 2` against `run_missing0001` reported
  `stage: lookup`.

## D28 — FIX

Keep rank 1 and the two-file footprint. The dialect completion and
`AUTH_STATUS` contract are useful, freeze-safe, and technically grounded.
The proposed JSON shapes are coherent: stored mode has exactly
`type/preview/mode/stored`; all mode adds `environment`; rows expose metadata
and source names, never credential values. Reusing `sourceLabel` preserves
D24's configured-byte equality, and explicitly sorting both row collections
makes the output deterministic. Whole-object and compact-line pins are the
right freeze boundary.

One structured error byte remains unspecified. A `CliErrorReport` includes
`command`, and the analogous models parser boundary reports the owning
subcommand (`models list`, `models enable`, and so on). D28 specifies
`command: "auth"` for an unknown top-level auth subcommand, but its three
`parseArgs` catches and tests do not pin the corresponding values. Leaving
that open permits `auth status --bogus` to retain the current coarse
`command: "auth"` even while the rest of the error changes dialect.

Make the parser-error contract exact:

- status parser errors: `command: "auth status"`;
- login parser errors: `command: "auth login"`;
- logout parser errors: `command: "auth logout"`;
- unknown auth subcommands remain `command: "auth"`.

Pin all three parser cases through `parseCliErrorJson`, including
`message`, `stage: "parse-args"`, and the common auth-help remedy. The
`try/catch` boundary still contains only synchronous `parseArgs`; provider
validation, config/store reads, and damaged-store classification remain
outside it. Help still returns before any provider or store work.

No other D28 correction is needed. `AUTH_STATUS` remains a
`preview: true` CLI view object outside the Event union, and no `main.ts`
change is required.

## D29 — KEEP

Keep rank 2 as specified. The remedy target currently rejects both discovery
and malformed argv with `stage: execute`, and a module-local `DOCTOR_USAGE`
plus a lexical `parseArgs` catch fixes that without touching diagnostic work.

The ordering is load-bearing: parse, return usage for `--help`/`-h`, then
read package metadata and inventory state. This gives help a zero-write
surface and keeps every engines, inventory, and preflight failure outside the
parser catch. The proposed tests pin exit/output, the no-created-state-root
property, `command: "doctor"`, `stage: "parse-args"`, and the doctor-help
remedy. Positionals remain refused.

The existing `DoctorJsonReport` construction and its ten top-level keys,
sixteen checks, four inventories, `ok`, `next`, and output ordering remain
untouched. `runStates` remains limited to PLANNING/RUNNING. No `main.ts`,
Event, or `RunStatus` edit is needed.

## D30 — FIX

Keep rank 3 and the two-file footprint. Type/confidence validation belongs
before `parseRunId`/`EventStore` lookup, while run lookup and flowchart-plane
failures must remain outside any new catch. The missing-run probes confirm
that the precedence defect is observable even without constructing a
flowchart fixture.

The finite-range rule needs one additional lexical guard. The proposed
algorithm computes `Number(values.confidence)` and rejects only non-finite or
out-of-range results. JavaScript converts both `""` and whitespace-only
strings to finite `0`, so an explicitly empty `--confidence` would pass the
new preflight despite not being a number. A live coercion probe confirmed
`Number("") === 0` and `Number("   ") === 0`.

Before conversion, reject `values.confidence.trim() === ""` with the same
specified parse-args report:

- `command: "inject"`;
- `message: invalid --confidence "<raw>": confidence must be a finite number
  between 0 and 1`;
- `next: "pass --confidence <0-1>"`;
- the supplied `runId`.

Then compute the number once and apply the finite `[0,1]` check. Add empty and
whitespace-only cases alongside `banana`, `2`, and `-1`; retain successful
boundary pins for `0` and `1`. This correction does not require narrowing
other numeric spellings accepted by `Number`.

Use the already-exported `INJECTION_KINDS` from `src/run/injection.ts` for
the type membership check rather than duplicating the plane's accepted set;
that changes no additional file and keeps the CLI preflight aligned with the
validator. Unknown type remains the first value-domain refusal, before
per-type requirements and lookup.

## Verdicts

| Slot | Verdict | Action |
|---|---|---|
| D28 | **FIX** | Keep rank 1; pin parser-error `command` as `auth status`, `auth login`, or `auth logout`, while unknown subcommands remain `auth`. |
| D29 | **KEEP** | Keep rank 2 exactly as specified; help returns before all work and frozen doctor JSON is byte-untouched. |
| D30 | **FIX** | Keep rank 3; reject blank confidence before numeric coercion and share the plane's exported injection-kind set. |

No additional slot is proposed. The corrected scopes still avoid live R1,
ADR-006, `INSPECT_SUMMARY`, doctor JSON changes, the eight-member
`RunStatus`, new Event types, `main.ts`, and every PR #12 path.

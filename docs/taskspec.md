# Run a TaskSpec with zero-model preparation

These experimental source APIs and CLI commands are in the Phase 1 candidate,
not a published package or stable SDK export. They support literal paths and bounded write/protect patterns, JSON `command`/`args`, and one worker attempt. Shell `run` strings, explicit model overrides and USD budgets are rejected. Full
Phase 1 acceptance and four-language installation examples remain unfinished.

A TaskSpec selects the same host checks for the base preflight and final
acceptance. Preflight actually runs preparation and those checks without a
model. A task run prepares the candidate it will give to the worker, preserving
ordinary ignored build caches within that invocation. A separate standalone
preflight creates its own candidate; it does not reserve a cache for a later run.

## Generate a draft and run preflight

From the pi-sparkle checkout, `pnpm cli init --task --dir <repo>` writes
`sparkle.task.json`. It detects one supported project language and generates a
conservative draft. Init does not execute tests, install dependencies or invoke
a model; preflight is the actual runtime and dependency check.

| Profile | Supported inputs and actual checks |
|---|---|
| Node / TypeScript | A package with an explicit `node --test test/value.test.cjs` or `.ts/.mts/.cts` script and `src` or `lib`. TypeScript requires native Node type stripping and erasable syntax; static type checking is not included. Enums and other syntax requiring transformation fail actual preflight. |
| Python | Regular `pyproject.toml`, `src` and `tests`, with explicit `[tool.pytest.ini_options]`, `testpaths = ["tests"]` and `pythonpath = ["src"]`. Runs actual pytest and Ruff through the selected interpreter. |
| Rust | One stdlib-only package with `Cargo.toml`, matching `Cargo.lock`, `src/lib.rs` or `src/main.rs`, and external integration tests under `tests`. Runs actual `cargo test --offline --locked`. |
| Go | One root stdlib-only package with a simple `go.mod`, regular source and test files. Runs actual `go test -count=1 ./...`. Source stems start with an ASCII letter and contain only letters/digits; test names are `<stem>_test.go`. |

These initial profiles deliberately reject unsupported inference. Node rejects
quoting, shell syntax, implicit discovery and other runners. Python accepts
single-line bare TOML keys and explicit tool tables, rejects conflicting or
nested checker configuration and external Ruff configuration, and requires
existing pytest/ruff modules. Rust rejects workspaces, dependencies, build
scripts, toolchain/config overrides and additional automatic targets. Go
rejects dependencies, workspaces, subpackages, ignored/platform-selective file
names, build constraints and embed directives. Linked inputs and ambiguous
language detection refuse. Author and review an explicit TaskSpec for a project
outside these subsets.

For Python, `--python <executable>` selects an existing interpreter; otherwise
init prefers a real project `.venv` then Python on PATH, excluding WindowsApps
launcher aliases. A runtime outside source is recommended for execution because
the existing clean-source policy still applies to ignored dependency folders.
pytest disables bytecode and its result cache. Ruff explicitly uses the protected
root `pyproject.toml`, disables its cache and ignores Git exclusion rules, so a
worker-added nested config or ignore file cannot relax that generated command.

For Rust/Go, `--state-root <private-dir>` selects external compiler storage
(default `~/.pi-sparkle`); Node and Python reject this init flag. Each actual
check creates a fresh child output directory after checking its parent path.
Go additionally disables successful test-result caching and module network
access, and uses the local toolchain with CGO disabled. Outputs are retained for
host-managed cleanup; init itself creates no compiler storage. This avoids
reusing mutable test executables between checks, without claiming general OS
process containment. Compiled checks request 40 seconds; Python's two checks
request 20 seconds each, within the existing 40-second combined recipe limit.

Review the draft's objective, writable/protected paths, checks and time limits,
then commit the intended task inputs so the source meets the existing clean
repository requirement. The generated draft expects a passing base; use the
explicit assertion convention below for a target regression. Existing files
are preserved unless `--force` is supplied; linked or nonregular targets are
refused even with that option. Plain `init` keeps its existing children and
flowchart example behavior.

Run `pnpm cli preflight <task.json> --project <repo> --state-root <private-dir>`
to execute the actual preparation and base checks. `--json` returns the host
artifact locator and settlement/disposal summary, without raw command output.
Omitting `--state-root` uses the existing generic `~/.pi-sparkle` state root;
the root must remain outside the source and candidate. Preflight needs no
provider configuration and never applies source changes. Its standalone
candidate is not reused by a later task invocation.

Use `pnpm cli init --task --help` or `pnpm cli preflight --help` for flags.
CLI task execution, Verdict presentation and four-language installed examples are
still unfinished; the one-worker source API described below is available for
host integration.
## Exercise an installed package

The experimental `examples/task-spec-language-demo.mjs` runner creates its own
synthetic Git repositories. It supports `node-express`, `python-fastapi`,
`rust-cli`, `go-service`, or `all`. Each example starts with passing checks,
uses the owned worker tool for a semantics-preserving refactor, checks that
acceptance left the original fixture unchanged, and separately requests apply
with fresh whole-candidate verification. The prepared apply target is saved
before source mutation. These are scripted mechanism demonstrations; they do
not establish real-model equivalence or the quality/cost targets.

Build and pack the current checkout, then install that tarball with its Pi peer
into a private prefix. No global installation or publication is needed. For
example, after `pnpm build` and `pnpm pack --pack-destination <artifacts>`, use
`npm install --prefix <private-pi-prefix> --omit=dev --ignore-scripts --no-audit --no-fund <tarball> @earendil-works/pi-coding-agent@1.4.0`.
Install Express separately with
`npm install --prefix <private-node-deps> --ignore-scripts --save-exact express@5.3.0`.
Select an external Python 3.12 virtual environment containing FastAPI, pytest,
Ruff and httpx. The locally exercised versions are FastAPI 0.162.0, pytest
9.1.1, Ruff 0.17.2 and httpx 0.28.1. Rust/Cargo and Go must already be selected
on PATH. The runner installs no dependencies and does not skip missing tools.

Run the installed copy, supplying your chosen private paths. On Windows, keep the evidence parent short (for example, a short child of .agent_workspace): Git worktree creation can fail with "$GIT_DIR too big" under deeply nested paths. Such an early failure does not exercise the language tests or worker.

```powershell
$ErrorActionPreference = 'Stop'
& node "$piPrefix/node_modules/pi-sparkle/examples/task-spec-language-demo.mjs" `
  --root $evidenceParent --node-deps $nodeDeps --python $pythonRuntime --language all
```

Dependencies and compiler output stay outside the generated source trees.
The runner retains command output, per-language outcomes, native evidence and
prepared apply records under a new child of `--root`; inspect failures before
retrying. Results explicitly report zero model invocations, unknown monetary
cost and no live-effectiveness claim. Actual installed execution evidence and
remaining acceptance work are recorded in the active plan and PR; merely
building or reading this example does not complete that acceptance.

## Define the task

`parseDevelopmentTaskSpec(text)` in `src/development/task-spec.ts` accepts at
most 64 KiB of UTF-8 JSON. `snapshotDevelopmentTaskSpec(value)` accepts the
corresponding ordinary own-data object. Both return a deeply frozen copy and
reject unknown fields, accessors, proxies and malformed values.

| Field | Current behavior |
|---|---|
| `version` | Must be `1`; this experimental schema remains subject to implementation review. |
| `objective` | Required nonempty text, up to 4096 characters. |
| `context` | Up to 32 required base files; defaults to an empty list. Files generated by preparation cannot supply this context. |
| `write.allow` | 1–32 safe relative literal prefixes or bounded patterns. Future writable matches may be absent. |
| `write.protect` | 0–128 required prefixes/patterns; each must match before the worker. Protection takes precedence over write permission. |
| `prepare` | Up to 8 unique commands with `id`, `command`, `args`; defaults to none. |
| `checks` | 1–8 existing check definitions, each with `expect`. Their declared protected dependencies must be covered by `write.protect`. |
| `budget.totalSeconds` | One overall deadline, including preparation, context, worker and final acceptance. It is not renewed after preparation. |
| `budget.prepareSeconds` | One cumulative allowance for the preparation phase. |
| `budget.checkSeconds` | Allowance for each base/final check phase, separate from preparation. Existing per-recipe limits still apply. |
| `budget.workerSeconds` | Worker allowance for this one-attempt path, separate from preparation. |
| `worker.model` | Only `inherit`; omitted worker configuration defaults to it. The host supplies the actual Pi executor factory. |

All four time fields are required, from 0.001 to 1800 seconds with whole
millisecond precision. The earlier recipe default remains 5 seconds per check
and at most 40 seconds of declared recipe time in total. A larger
`checkSeconds` does not increase those recipe limits. This is not the complete
future cumulative repair or monetary-budget interface. Unknown cost stays
unknown; `budget.usd` is explicitly unsupported.

Checks use `id`, `command`, `args`, `verifierVersion`, optional
`protectedPaths`, `timeoutMs`, `maxStdoutBytes`, `maxStderrBytes` and
`visibleToWorker`. Visibility defaults to true. See the
[fixed check plan](direct-development-task.md) for bounded output and repair
projection. Hidden host checks are separate from independent benchmark scoring.

## Select writable and protected paths

Use `/` separators and repository-relative, case-sensitive paths. A literal
`src` includes that directory and its subtree. Within a segment, `*` matches
zero or more characters and `?` matches one; an entire `**` segment matches
zero or more path segments. For example, `src/**/*.ts` includes TypeScript
files under `src`, and `crates/**/tests/no_write_api.rs` protects matching
checks across crates. A matched directory includes its subtree.

Each protection selector must already match; allow selectors may describe
future files. Protection always wins. Matching is repeated before and after
execution and checks, so newly created matching files, including ignored files
and dotfiles, participate. `.git` is always excluded and cannot be written
through the task's owned mutation tools. Brace expansion, character classes, extglobs,
absolute paths and `.`/`..` components are unsupported. Existing literal names are not expanded; the narrower pattern grammar applies when `*` or `?` is present.

`context` and each check's `protectedPaths` remain literal. A declared checker
directory requires protection of its entire subtree; protecting only today's
matching child files is insufficient. Existing Controller queue definitions
also retain their literal path rules. Directory links and junctions in an
observed path are refused; these checks do not create OS process containment.
## Describe the expected base result

For a check that should already pass, use `"expect": { "baseline": "pass" }`.
For a target regression, use a specific assertion identifier:

```json
{ "expect": { "baseline": "fail", "failureAssertion": "value-regression" } }
```

That trusted checker must finish normally with exit 1, empty stderr, and this
complete stdout JSON when its final diagnosis is that business assertion:

```json
{ "assertion": "value-regression", "outcome": "failed" }
```

The narrow convention intentionally rejects raw TAP/pytest/cargo diagnostics.
A project-specific trusted wrapper must classify the actual assertion and emit
this report only after ruling out setup/infrastructure errors. An arbitrary
exit 1, missing dependency, compiler error, truncated output or different
assertion does not establish the expected RED. Even matching JSON followed by
an import error on stderr is refused. This convention trusts the selected
checker; it is not proof against an incorrectly implemented trusted wrapper.

Final acceptance still requires every check to exit successfully. An expected
base failure never grants permission to deliver a failing candidate.

## Execute through the host

`startDevelopmentTaskSpec` and `preflightDevelopmentTaskSpec` are in
`src/development/start-task-spec.ts`.

- `startDevelopmentTaskSpec({ sourceRepo, stateRoot, sandboxRoot?, spec,
  executorFactory, signal? })` returns `{ execution, preflight? }`. Supply the
  same host-owned executor factory used by
  [`startDevelopmentTask`](direct-development-task.md). The actual factory is
  invoked only after successful base preflight and fresh source verification.
  `execution` is the existing native result: acceptance does not apply changes. Missing declared checker inputs can be refused by Native admission before the preflight wrapper starts; in that case `preflight` is absent and the Native result retains the refusal reason. Standalone preflight still produces its own actual failure artifact.
- `preflightDevelopmentTaskSpec({ sourceRepo, stateRoot, sandboxRoot?, spec,
  signal? })` has no worker factory. It runs actual preparation/checks in an
  isolated worktree. Settled temporary candidates are removed; unresolved
  process cleanup retains the candidate for host reconciliation.

Keep `stateRoot` outside the original source repository, normally in the
host's private `.agent_workspace` area. Source must satisfy the existing clean
Git-root requirements. Context is checked before preparation or real factory
creation; free-text objective paths are not automatically inferred.

Preparation and base checks may create ignored caches outside observed source
prefixes. Changes to observed source/protected bytes or Git-visible source
state refuse before the worker factory. The run path retains failed candidate bytes as evidence; standalone preflight removes settled temporary candidates and retains their command report. Neither path resets bytes to disguise the failure. Arbitrary trusted command effects outside
observed scope remain outside the containment guarantee; a worktree is not an
OS sandbox.

The returned preflight `artifactPath` contains bounded command outcomes,
separate preparation/check timings, unobserved check IDs, cancellation and
settlement facts. Base-check diagnostics are host-private and are not added to
worker context. Artifact failures must not erase unresolved command cleanup.
A failed preflight creates no real worker; the run path records the failure
using existing native evidence. Pre-allocation input/context failures can throw
without an execution result. Inspect the reported retained candidate before
retrying any unresolved operation.

The active [implementation plan](../tasks/plan.md) and [PR #78](https://github.com/Xhhemoing/pi-sparkle/pull/78)
distinguish focused verification, complete candidate acceptance and remaining
Phase 1 work. The quality and cost comparison targets remain unproven.

# Run a TaskSpec with zero-model preparation

These experimental source APIs and CLI commands are in the Phase 1 candidate,
not a published package or stable SDK export. They support literal paths and bounded write/protect patterns, JSON or YAML `command`/`args`, and up to five bounded worker attempts (one by default). Shell `run` strings and explicit model overrides are rejected. Full
Phase 1 acceptance remains unfinished; the installed four-language examples have bounded Windows mechanism evidence.

A TaskSpec selects the same host checks for the base preflight and final
acceptance. Preflight actually runs preparation and those checks without a
model. A task run prepares the candidate it will give to the worker, preserving
ordinary ignored build caches within that invocation. A separate standalone
preflight creates its own candidate; it does not reserve a cache for a later run.

Files ending in `.yaml` or `.yml` (case insensitive) select YAML 1.2; all other
paths retain strict JSON parsing. Both produce the same validated TaskSpec.
YAML accepts one UTF-8 document of at most 64 KiB with ordinary scalar/string
keys, comments, block strings and collections. Duplicate keys, extra documents,
aliases, merges, custom tags, complex keys, nonfinite numbers and fields outside
the schema refuse before execution. Shell expansion and automatic JSON-to-YAML
fallback are not supported. Parser diagnostics omit private YAML source values.

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
access, and uses the local toolchain with CGO disabled. Rust captures only explicitly supplied `RUSTUP_HOME`, `CARGO_HOME` and `RUSTUP_TOOLCHAIN`; relative home paths are resolved at init, and checks force `RUSTUP_AUTO_INSTALL=0` and `CARGO_NET_OFFLINE=true`. On POSIX it also requires a discoverable `cc` linker and receives only a PATH containing the selected cargo/cc directories. HOME/USERPROFILE and other host variables are not copied. A caller using a private HOME must explicitly select its installed Rust environment; implicit defaults from another HOME are not recovered. The supplied CARGO_HOME remains trusted compiler configuration, not OS isolation. Outputs are retained for
host-managed cleanup; init itself creates no compiler storage. This avoids
reusing mutable test executables between checks, without claiming general OS
process containment. Compiled checks request 40 seconds; Python's two checks
request 20 seconds each, within the existing 40-second combined recipe limit.

Rust drafts are **bound to the init host**. Node/Cargo executables, explicitly
selected Rust homes/toolchain and output locations can contain local absolute
paths and usernames. Regenerate and review the draft on another host. Review
those paths before committing or sharing; do not share an unreviewed machine-bound
draft. Neither preflight nor final verification re-resolves the environment:
both use the draft's same fixed commands and captured environment.

For recognized, nonzero, completed Cargo failures, preflight and task-run expose
static infrastructure advice in the optional `refusal` projection:

- `RUST_TOOLCHAIN_UNAVAILABLE`: the rustup Cargo shim reports that no default
  toolchain is selected. From the original host shell, inspect `rustup toolchain
  list`, then explicitly select an **already installed** toolchain before init.
  In PowerShell, set `$env:RUSTUP_HOME = (rustup show home)` and
  `$env:RUSTUP_TOOLCHAIN = '<installed-toolchain>'` using that installed name.
  Regenerate and review init-generated drafts. For an explicitly authored
  TaskSpec, the owner instead reviews and updates its fixed toolchain/environment
  definition before checking again; dependency-bearing projects still cannot
  use the stdlib-only init profile.
- `RUST_OFFLINE_DEPENDENCY_MISSING`: Cargo reports a missing package in the
  crates.io index together with its offline-mode diagnostic. Outside the
  product's offline run, use the same reviewed `CARGO_HOME` and registry
  configuration selected by the fixed TaskSpec. The owner can prepare dependencies with `cargo fetch`
  and review any `Cargo.lock` changes, or use `cargo vendor` and review the
  vendor configuration. Filling an unrelated default cache will not repair a
  task bound to a different cache. If that selection changes, explicitly review
  the TaskSpec; then retry the fixed offline/locked checks.

The product does not install toolchains, download dependencies or turn off
offline mode. Other diagnostics retain generic refusal and private evidence;
an unknown message is not guessed from a broad “toolchain” or “offline” keyword.
Advice never repeats raw stderr, package names, local homes or credentials.
Dependency-bearing counterexamples use explicitly authored TaskSpecs; init's
stdlib-only restriction remains in force.

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
The configured CLI and current Pi host entries below share the same TaskSpec checks and lifecycle. Complete current-candidate and cross-platform qualification remain unfinished; the installed four-language examples have earlier Windows mechanism evidence.
## Run with configured Pi from the CLI

```text
pnpm cli task run task.yaml --project <repo> --state-root <private-dir> --executor pi --review --json
```

The command uses the existing CLI provider/model/credential configuration and
thinking level (`providers.json`, its state-root credentials, or supported
`PI_*` environment values). It supplies fresh declared task context and scoped
candidate tools; it does not inherit an interactive parent's prompt, skills or
hooks. Normal configured providers may incur charges. Optional `budget.usd`
uses the same strict task-wide reference-usage pool as the host command.

The default retains the candidate and returns its acceptance/evidence summary.
Use `--review` to keep this process alive for one explicit `apply`, `discard` or
`retain` decision. EOF also retains. Prompts go to stderr; `--json` emits a safe
execution JSON line and, when selected, a separate action line. Apply requires
acceptance and fresh verification; discard can remove a settled refused
candidate. Neither outcome prints hidden checker output.

After the process exits, its run ID and saved JSON cannot restore the live
verifier or remaining budget pools. `task resume` explicitly refuses that
reconstruction. The older top-level `resume` still continues supervised and
flowchart runs; ordinary runs rebuild their checkpoint without resuming a
worker. Cooperative cancellation waits for owned settlement and retains unknown
effects. A forced OS termination has no such observed settlement guarantee.
## Run from the current Pi host

The experimental `/sparkle-task <task.json>` user command captures the current
Pi model, effective prompt, thinking level, custom thinking budgets and approved resource bodies, then
runs the task in an isolated candidate with the supplied scoped write tools.
Quote a complete task-file path containing spaces. The file must be bounded,
regular UTF-8 JSON or explicitly selected YAML with no linked parent or leaf. Host configuration may select
external state/candidate directories; defaults use `~/.pi-sparkle` outside the
source repository.

The result identifies the retained candidate and evidence and separates
acceptance from application. The command does not trigger a follow-up model
turn or apply changes. In that same live Pi session, choose explicitly:

```text
/sparkle-task-apply <runId>
/sparkle-task-discard <runId>
```

Apply requires an accepted, settled candidate. It rechecks the original source
branch/revision, managed candidate identity, whole contents/index and task scope,
then reruns the original trusted verification. The host persists its prepared
application target before changing source and records completion afterward.
A failed or ambiguous effect/receipt requires reconciliation; repeating the
command cannot replay an uncertain application.

Discard accepts a settled candidate retained by this session, including a
refused task. It removes only that unchanged managed worktree; changed, replaced,
locked or missing candidates refuse automatic disposal. It retains private
artifacts. After apply, discard uses the original prepared candidate identity,
not a newly adopted snapshot. Neither command runs a model or accepts a JSON
record as authority. A run ID from another session or after restart is not a
recoverable handle. Shutdown waits for owned work to settle and retains any
remaining candidate; it does not silently apply or remove it.
The controlled child uses its own tools and persistence; this is not a claim of
arbitrary parent-session tool, transcript, shell/MCP or OS containment equivalence.

The Phase 1 configuration comparison has six separate requirements. Current
evidence and remaining differences are:

| Configuration | Current behavior and limit |
|---|---|
| Model | Captures the selected eligible model before asynchronous work and dispatches through the original host transport, retaining request-time host authentication. |
| System prompt | Preserves the getter's exact text. Later parent `context_with_system` hooks can change the parent's final request and are not copied. |
| Skills | Copies explicitly approved skill bodies once. Parent skill discovery and arbitrary resource loaders are not inherited. |
| Tools | Uses five supplied scoped file tools. Ordinary Pi shell, MCP/custom tools, names and editing algorithms are not equivalent to that set. |
| Context | Uses declared task files and approved context in a fresh owned session. Parent conversation history and hidden acceptance output are excluded. |
| Budget | Uses explicit task deadlines, bounded attempts and optional task-wide reference USD. Captures the SDK's optional `minimal/low/medium/high` thinking-budget values before resource callbacks and preserves the snapshot across turns and repairs. Actual fake-wire checks cover custom values and mutation; provider interpretation and billing remain with Pi. |

A comparison against direct Pi must run both arms with an explicitly shared
supported configuration and observe their actual requests and stopping behavior.
That can qualify the selected configuration; it cannot establish equivalence to
every parent session or demonstrate the quality/cost targets.

## Read a historical Verdict

```text
pnpm cli task verdict --artifact <artifact.json> --markdown
pnpm cli task verdict --artifact <artifact.json> --apply-record <host-saved-apply.json> --json
```

Choose exactly one output format. The command reads an existing Native check,
loop, failure or apply-registration artifact, or a TaskSpec preflight record.
Both formats use one allowlisted projection. Raw checker output, hidden checker
IDs and commands remain private; cost is unknown. Inputs must be ordinary,
nonlinked UTF-8 JSON files no larger than 2 MiB each.

The output states the scope of the historical acceptance. A provisional check
record without an acceptance remains incomplete; a preflight pass does not
establish the full task outcome. An optional matching host-saved apply result
reports recorded application separately from a merely prepared target.
These editable records never establish current-source verification or recreate
execution/apply authority. No command is executed and record references are
not followed. Exit 0 means the supported record was read, even when it reports
a historical refusal; missing, unsafe, corrupt or unsupported evidence returns
an explicit projection and a nonzero exit status.

## Exercise an installed package

The experimental `examples/task-spec-language-demo.mjs` runner creates its own
synthetic Git repositories. It supports `node-express`, `python-fastapi`,
`rust-cli`, `go-service`, or `all`. Each example starts with passing checks,
performs a semantics-preserving refactor, observes that acceptance left the
source and protected files unchanged, then explicitly applies with fresh checks.

Use `--mode cli` to exercise the installed public `init`, `preflight` and
`task run --executor pi --review` commands. A local loopback provider supplies
two deterministic SDK turns; no external model service is contacted. The runner
records acceptance and source bytes before sending `apply` to the same CLI
process, then checks the applied source through public preflight. The Node
example uses YAML; the other three use JSON. This is a mechanism demonstration,
not a model-quality comparison. The default `--mode scripted` retains the earlier
direct API demonstration with no model dispatches.

Build and pack the current checkout, then install that tarball with its Pi peer
into a private prefix. No global installation or publication is needed. For
example, after `pnpm build` and `pnpm pack --pack-destination <artifacts>`, use
`npm install --prefix <private-pi-prefix> --omit=dev --ignore-scripts --no-audit --no-fund <tarball> @earendil-works/pi-coding-agent@1.4.0`.
Supply Express, TypeScript and the Node/Express type packages separately in
`<private-node-deps>`. For example, run `npm install --prefix <private-node-deps>
--ignore-scripts --save-exact express@5.3.0 typescript@5.9.3 @types/node@26.2.0 @types/express@5.0.6`
as an explicit host preparation step; retain and review that prefix's lockfile.
The example never installs or downloads them.
Select an external Python 3.12 virtual environment containing FastAPI, pytest,
Ruff and httpx. The locally exercised versions are FastAPI 0.162.0, pytest
9.1.1, Ruff 0.17.2 and httpx 0.28.1. Rust/Cargo and Go must already be selected
on PATH. CLI mode resolves the existing Rust executable with `rustup which cargo`
(with auto-install disabled) before isolating Pi HOME, so the checker does not
use a rustup shim against an empty profile. The runner installs no dependencies
and does not skip missing tools.

Run the installed copy, supplying your chosen private paths. On Windows, keep
the evidence parent short: Git worktree creation can fail with "$GIT_DIR too big"
under deeply nested paths. Such an early failure does not exercise language checks.

```powershell
$ErrorActionPreference = 'Stop'
& node "$piPrefix/node_modules/pi-sparkle/examples/task-spec-language-demo.mjs" `
  --mode cli --root $evidenceParent --node-deps $nodeDeps `
  --python $pythonRuntime --language all
```

Dependencies and compiler output stay outside the generated source trees.
The runner retains command output, per-language outcomes, private evidence and
`accepted-before-apply.json` under a new child of `--root`; inspect failures
before retrying. Successful CLI examples report two synthetic SDK dispatches,
known reference usage and unknown provider billing. Scripted mode reports zero
model dispatches. Neither mode demonstrates the quality/cost targets. Actual
installed execution and remaining acceptance work are recorded in the active
plan and PR; building or reading the example does not complete that acceptance.

The node-express example adds a protected `tsconfig.json` and fixed
`tsc --noEmit -p .` check before its Node HTTP tests. The same fixed checks run
at baseline, final candidate acceptance and explicit application. Compiler
startup is part of the existing check allowance, including its cumulative pool;
it is not free preparation. The example declares a 20-second compiler check,
within its 40-second check phase and 80-second cumulative check pool. Generic `init --task` remains stripping-only and
does not infer a compiler or configuration for arbitrary TypeScript projects.

Recognized example failures add an optional `refusal` object to standalone
preflight and failed task-run JSON, with `code`, `category`, `message` and `next`. Existing fields
and exit code 1 are unchanged. `TS_COMPILER_MISSING` (also missing required type
packages) and `TS_CONFIG_MISSING` are `infrastructure` failures with preparation
guidance. `TS_UNDECLARED_RED` is an `undeclared-red`: a compiler ran and found
errors in a baseline declared passing, so fix that code before retrying. None
establishes a named business RED or allocates a model. Unrecognized failures,
incomplete output or unsettled effects keep generic refusal. Advice is static;
compiler diagnostics and paths remain in private evidence. A compiler failure
after worker edits rejects final acceptance and leaves the source unchanged.

## Compared host configuration

The configuration comparison covers a fresh task with an explicitly declared
model, system prompt, approved skill and context files, scoped file tools and
budgets. One arm creates a direct public Pi SDK session; the other uses the
Native write factory and owned Pi executor. Each reads its own fixture files.
The test inspects actual SDK requests and runs the tools.

| Configuration | Observed comparison |
|---|---|
| Model | Same provider/id, declared pricing and token capabilities on every dispatch. |
| Prompt | Same predeclared host system-prompt bytes. |
| Skills | Same approved name, description and body delivered once per transcript. |
| Tools | Same five scoped file-tool schemas and report schema; actual read, allowed write and protected-path refusal. |
| Context | Same declared fresh file contents, separate roots, no ambient or other-arm marker. |
| Budget | Same four thinking values and common explicit deadline; both wait for a held tool to settle after cancellation. |

The worker additionally enforces its TaskSpec reference-USD pool; the direct
session does not acquire that policy merely by participating in the comparison.
Report acknowledgements/message type labels, absolute roots and synthetic usage
amounts are recorded differences. Neither billing nor cost equality follows.
This does not reproduce arbitrary parent hooks, prior conversation, automatic
skill discovery, shell/MCP tools, OAuth, compaction or cross-process recovery.
Use the bounded result when reviewing the Phase 1 configuration scope; quality
and completion non-inferiority still need the separately planned benchmark.

## Use the input schema

The package includes [schema/taskspec.v1.json](../schema/taskspec.v1.json) for
editor validation of JSON authoring inputs. Configure it as an external schema
association: the TaskSpec parser rejects an added `$schema` field, like any
other unsupported input field. From the source checkout, `pnpm schema:taskspec`
regenerates the JSON from `src/pi-adapter/task-spec-schema.ts`.

Defaults are annotations; the strict parser supplies the defaults. This schema
covers field shapes and bounds, not execution authority. The parser additionally
checks whole-millisecond precision, unique recipe IDs, aggregate timeout/output
limits and the 64 KiB UTF-8 input limit. Own-data object safety, actual file/link
checks, protection coverage, source freshness and named business-failure
assertions still require the parser and runtime. String lengths in the parser
use UTF-16 units; generic JSON Schema consumers may count Unicode characters
differently. Keep these checks even when an editor accepts the document.

## Define the task

`parseDevelopmentTaskSpec(text)` in `src/development/task-spec.ts` accepts at
most 64 KiB of UTF-8 JSON. `snapshotDevelopmentTaskSpec(value)` accepts the
corresponding ordinary own-data object. Both return a deeply frozen copy and
reject unknown fields, accessors, proxies and malformed values.

| Field | Current behavior |
|---|---|
| `version` | Must be `1`; this experimental schema remains subject to implementation review. |
| `objective` | Required nonempty text, up to 4096 characters. |
| `context` | Required base files, combined with explicit objective file references up to 32. Defaults to an empty list; preparation cannot generate these required inputs. |
| `write.allow` | 1–32 safe relative literal prefixes or bounded patterns. Future writable matches may be absent. |
| `write.protect` | 0–128 required prefixes/patterns; each must match before the worker. Protection takes precedence over write permission. |
| `write.require` | Optional 0–32 unique literal output paths that must be permitted by allow and not protected. They may be absent; declaring them grants no permission. |
| `prepare` | Up to 8 unique commands with `id`, `command`, `args`; defaults to none. |
| `checks` | 1–8 existing check definitions, each with `expect`. Their declared protected dependencies must be covered by `write.protect`. |
| `budget.totalSeconds` | One overall deadline, including preparation, context, worker and final acceptance. It is not renewed after preparation. |
| `budget.prepareSeconds` | One cumulative allowance for the preparation phase. |
| `budget.checkSeconds` | Allowance for each base/final check phase, separate from preparation. Existing per-recipe limits still apply. |
| `budget.workerSeconds` | Per-attempt worker allowance, separate from first-factory preparation and base checks. |
| `budget.workerTotalSeconds` | Optional cumulative worker allowance across all attempts in this invocation. |
| `budget.checkTotalSeconds` | Optional cumulative allowance for the first base checks and every final verification phase. Preparation is separate. |
| `budget.usd` | Optional positive finite reference-usage allowance shared across all worker attempts. Requires the strict, host-bound Pi cost callbacks. |
| `worker.model` | Only `inherit`; omitted worker configuration defaults to it. The host supplies the actual Pi executor factory. |
| `worker.maxAttempts` | Optional integer from 1 to 5; defaults to 1. Repair reuses the same candidate, fixed check plan and original protected observation. |

In the objective, `[[file:docs/design.md]]` explicitly declares a required input.
The parser merges it with `context`; preflight checks the actual file and the
worker receives its contents through the existing bounded context renderer.
Malformed or unsafe declarations refuse. Ordinary backticks and path-like prose
remain text, so a future output mentioned in an explanation is not treated as a
missing input. This convention does not parse arbitrary natural-language file
references.

Use `write.require` when a task requires a particular output location, such as
`tests/destination_feasibility.rs`. If only `src/plan.rs` is allowed, that explicit
requirement refuses before a worker can run. Add the reviewed integration-test
path to `allow` to resolve the configuration; do not remove or weaken the
protected source-scanning policy. The requirement checks declared permissions,
not file existence or whether an arbitrary checker accepts the planned content.
The synthetic historical fixture separately proves that a pure production fix
can pass while a filesystem-writing test under `src` is rejected, and the same
test placed in its allowed integration-test location passes the policy.

The four original time fields are required; the two cumulative totals are optional. All durations range from 0.001 to 1800 seconds with whole
millisecond precision. The earlier recipe default remains 5 seconds per check
and at most 40 seconds of declared recipe time in total. A larger
`checkSeconds` does not increase those recipe limits. Cross-process resume is
not implemented; persisted summaries do not restore execution authority.

Optional `budget.usd` creates one reference-cost pool for the logical task. For
example, after spending 0.6 of a 1.0 allowance, repair receives only 0.4. Each
actual Pi stream dispatch checks that the pool remains usable; a successful
attempt whose observed total exceeds the allowance is refused. Exact exhaustion
can finish an otherwise accepted candidate but cannot fund another attempt.
Cancellation and unknown settlement retain their existing precedence.

The default host write factory binds the strict Pi executor, actual request
identity and original settlement callback to that pool. A custom factory must
use the same live `executionCostBudget` capability; unsupported executors refuse
before execution. Missing, partial, unpriced, foreign, copied or duplicate
receipts cannot create more allowance. Late faults are checked again after
asynchronous evidence persistence and before returning acceptance.

`referenceCost` on the Native result and loop evidence distinguishes the known
reference subtotal, coverage, settlement and remaining allowance. Unknown
coverage never means free work, and foreign request costs remain in their
diagnostic record rather than this task's subtotal. This measures observed SDK
reference usage and stream dispatches, not underlying HTTP retries, tool charges
or a provider bill. An already admitted request can overrun the allowance; this
is not a billing hard cap. Omitting `budget.usd` keeps the prior monetary policy.

Preparation and base checks execute once before the first real worker. Repair
gets only worker-visible failure feedback and does not refresh the total
deadline or either optional cumulative pool. Worker time covers the actual
worker lifecycle; final verification time includes its existing evidence
persistence. Base-check time is charged before preflight artifact persistence,
so a failed write cannot refund it. Each phase uses the smaller remaining
allowance and its existing per-phase limit. An over-budget successful check
remains in the evidence while candidate delivery is refused. Exhausted pools
prevent later workers/checks; unknown cleanup stops repair and retains the
candidate. Omitting the totals preserves the prior per-attempt/per-phase
behavior under the same overall deadline.

Preflight JSON and its private artifact report `resources`: the existing
snapshot's file count and UTF-8-independent byte length, plus actual
preparation/check elapsed time divided by each effective phase allowance.
The snapshot covers selected allow/protect/check inputs; it is not a measurement
of all workspace files, peak memory, CPU or external compiler outputs. A phase
or snapshot that was not reached is `null`, including its ratio; a failed phase
retains the elapsed time actually observed. Hidden command output stays private.

The explicit maintainer fixture
`node --import tsx --test test/probes/task-preflight-cold-compiler.ts` performs
four fresh stdlib Rust compilations and then executes their assertions under a
separate check allowance. It prints actual phase timings, retains failures and
marks missing compiler/linker support as unverified. It uses no model or sleep
to stand in for compilation. This machine-dependent measurement is separate
from the default test gate; its success establishes the exercised preparation
budget separation, not general compiler cache safety or process containment.

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

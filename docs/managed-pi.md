# Manage staged Pi runtimes

The experimental `pi-adapter/managed/candidate` module stages a fresh build and
its installed runtime dependencies into a new opaque generation directory.
Build the program first and keep its installed package tree stable during the
copy. Supply the exact core and ai versions from that program's dependency pins.
The generations parent must already exist as a physical directory.

```ts
const candidate = await stageManagedCandidate({
  programRoot,
  generationsRoot,
  expectedVersions: { core: "1.4.0", ai: "1.4.0" }
});
console.log(candidate.generationId, candidate.root);
```

The result contains `app/package.json`, fresh `app/dist`, physical dependency
packages and newly created links between packages inside that generation. Staging
preserves each importer's resolved dependency and peer context, including cycles;
it does not flatten packages by name or fetch missing dependencies. Missing
required dependencies refuse staging. Missing optional dependencies are recorded.
Unexpected source-file links, external packages, and destinations inside trees
being copied are refused.

`candidate.json` is written last to record completed staging. It is ordinary
lifecycle metadata, not qualification or an integrity certificate. This API never
replaces an existing generation or deletes older ones. A failed copy can leave
an incomplete, unselected directory for explicit host cleanup. Successful staging
alone does not make a candidate approved or choose it for a run.

The builtin-only bootstrap is for a fresh controlled child process. Before
importing an entry from copied `app/dist`, it checks candidate/engine identities
and installs Node resolution and pre-load hooks. Non-builtin modules must resolve
to physical files inside that generation, including ESM, dynamic imports and
CJS/createRequire. The hooks remain active for the process lifetime. A fresh child
and a clean environment are required; preloaded module caches are not rechecked.

This boundary covers dependency loading. It does not restrict direct filesystem
or network access, native code, worker threads, custom loaders or a malicious
concurrent filesystem writer. Lifecycle immutability is not an OS permission
boundary. The initial execution evidence uses Windows and Node24; minimum Node22
and other platforms require their own actual runs.

## Qualify the staged runtime

Use an existing physical manager directory with candidates beneath its
`generations` child. The experimental qualification module launches the fixed
worker from the candidate through its bootstrap:

```ts
const result = await qualifyManagedCandidate({ managerRoot, candidate });
if (result.status === "failed") {
  console.error(result.reason);
}
```

The worker uses actual copied Pi Agent, adapter and kernel code with a local
faux provider. It checks priced stopping after a tool turn, an explicit unenforced
cap for an unpriced model, cancellation before dispatch, cancellation while a tool
is held, and a held asynchronous `agent_end` listener. Held/released observations
show whether completion waited for the actual operation. Cancelled invocation
usage remains unknown even when a completed earlier turn reports usage; synthetic
prices and tokens do not represent a provider bill or strict cost admission.

Each attempt gets isolated writable home/state/temp directories under
`manager/runtime/qualification`, outside the candidate. Parent credentials,
proxy settings and Node injection variables are not forwarded; Windows inherited
path/profile defaults are explicitly overridden. The launcher accepts no custom
worker, executable or environment. Timeout defaults to 30 seconds and can be set
between 1 and 120,000 milliseconds; each output stream is capped at 64 KiB.
Timeout, cancellation, malformed observations, nonzero exit and uncertain cleanup
cannot produce a qualified result. Attempt scratch remains for diagnosis.

A qualified result is an exact frozen process-local receipt, backed by private
validated data. Copies and JSON round trips cannot recreate that receipt.
`validateManagedQualificationRecord` only validates ordinary persisted data;
it cannot issue approval authority. This checks cooperative candidate behavior,
not the integrity of hostile candidate code or malicious local file edits.

## Retain and select a qualified generation

The experimental `pi-adapter/managed/generation-store` module persists successful
qualification and a selected generation under the existing physical manager root:

```ts
const store = new ManagedGenerationStore(managerRoot);
if (result.status === "qualified") {
  await store.approve(result);
}
const selected = await store.readApproved();
const retained = await store.getQualifiedGeneration(candidate.generationId);
```

`approve` requires the exact result issued in this process for this manager.
It writes `qualifications/<generationId>.json` before `approved.json`; the pointer
contains only the generation ID. Reapproving a generation validates and reuses its
existing qualification record. It never overwrites that record, even if another
successful attempt has different valid observations. Restarted stores can read
persisted selection without turning JSON into an approval receipt.

Approval and both reader methods share `manager.lock`. They validate bounded
regular metadata files, physical candidate paths and matching identities.
`readApproved` returns `undefined` for a never-selected manager; a requested or
referenced generation that is missing or corrupt is an error. Corrupt current
selection also blocks approval until host reconciliation. No method silently
chooses the newest directory, falls back to workspace code or deletes old state.

If qualification publication fails, the selected pointer is untouched. If pointer
replacement fails, the existing atomic writer attempts to restore the old file.
A failed restoration can leave publication remnants; subsequent readers report
that reconciliation is required. This is cooperative locked publication, without
a power-loss transaction or hostile-file-writer integrity claim.

Selecting a generation here does not change ordinary CLI execution. Public managed
execution against real projects remains subject to the existing process
containment qualification. Installed versions, dependency pins and the native Pi
host lifecycle are unaffected by staging, qualification or selection.

[Implementation plan](superpowers/plans/2026-10-19-managed-pi.md) and
[current evidence](reports/2026-10-19-staged-continuation.md).

## Preserve a run's engine binding

Run records may now carry `{ kind: "managed-pi", generationId }`. Host run APIs
accept an optional `engineContext` containing that binding and an asynchronous
`assertQualifiedGeneration` callback. They capture the context before awaiting
and check availability before creating a new root. Children, retries, supervisor
rounds and tracked clarification inherit the captured binding.

Executable resume checks the original event record before restoring runtime
state. A different context, missing context for a managed run, or managed context
for a legacy run refuses; checkpoint edits cannot change the original identity.
Terminal supervised metadata reads and pause/inject/unblock controls need no
loaded engine. Old runs and ordinary callers retain the existing legacy path.

This host callback is an availability assertion. The controlled process driver establishes actual loaded identity before supplying it; setting a binding object alone does not change or prove the executor in use.
## Run the controlled application

The internal `pi-adapter/managed/driver` module exposes `startControlledManagedRun({ managerRoot, request, signal?, timeoutMs?, stopGraceMs?, maxOutputBytes? })` for trusted hosts and controlled offline projects. A `run` request supplies `stateRoot`, `projectRoot` and `objective`, with optional children/flowchart paths, track and assumeDefaults. A `resume` request supplies `stateRoot` and `runId`, with optional unpause, selectedActionIds and supervised flags.

New roots select the approved generation once. Resume reads the original event binding and loads that retained generation, even after another generation is approved. Missing or corrupt retained state refuses; the driver does not fall back or bind a legacy run. The fixed fresh-process entry verifies its physical location, bootstraps contained application imports, checks retained qualification and calls actual CLI main with Pi and the verified binding. It accepts no custom worker or environment, and does not add a public CLI selector or change SDK defaults.

Attempts use isolated home/state/temp directories below `manager/runtime/driver`; ambient credentials, proxies and Node injection settings are not inherited. The request's explicit state root remains host-owned. Timeout defaults to 60 seconds; stop grace defaults to 2 seconds, with a maximum of 30 seconds. Each output stream defaults to 256 KiB, configurable up to 2 MiB. Attempt files remain available for diagnosis.

The result reports status separately from settlement. `application-settled` requires a matching receipt after main, adapter, child work and pending telemetry have settled. A nonzero application exit still reports failure. Cancellation stops further work and reconciles a late flowchart stop after waiting/checkpoint/episode persistence, while preserving an already recorded terminal outcome. Force-stop, lost IPC, missing or malformed receipt and output overflow report unknown settlement; callers must retain uncertainty and must not automatically retry effects.

These are cooperative application and module-loading checks. Driver coverage uses a loopback provider and now includes held-tool cancellation and a deferred asynchronous agent_end listener through the actual fixed entry, CLI, PiAgentExecutor and copied Agent. The two combination tests instrument only a private staged candidate at the real Agent-construction seam; they do not add a production injection API or requalify the unchanged candidate. They observe pending ownership before release, no new provider request after cancellation, a single terminal outcome, and the retained generation binding. Unknown child settlement preserves the test candidate instead of restoring or reusing it. [P3 commands, reviews and limitations](reports/2026-10-21-controlled-combinations.md) distinguish this instrumented coverage from the ordinary qualification scenarios. It does not prove OS process-tree containment, hostile-code isolation or suitability for public real-project managed execution. That public path remains subject to the existing containment acceptance boundary.

# Read-only contribution SDK

The additive ESM entry points are `pi-sparkle/sdk/host.js` and
`pi-sparkle/sdk/testing.js`. Build before using a source checkout. The package
ships physical JavaScript and declaration forwarders to `dist/sdk/`; it adds no
`exports` or `main` resolver. Existing deep imports remain available, but this
SDK does not make every internal path a stable public API.

## Host a contribution

```ts
import { createContributionHost } from "pi-sparkle/sdk/host.js";

const host = createContributionHost({
  generationId: "workspace-1",
  capabilities: ["selected-files"],
  plugins: [{
    id: "task-notes", enabled: true, apiVersion: 1,
    requiredCapabilities: ["selected-files"],
    contributions: [{ kind: "context", id: "notes" }],
    load: async ({ signal }) => {
      signal.throwIfAborted();
      return [{ kind: "context", id: "notes", provide: async (task, signal) => {
        signal.throwIfAborted();
        return { items: [{ text: task.objective }] };
      } }];
    },
  }],
});

const result = await host.context("notes", {
  generationId: "workspace-1", revision: "source-revision-1",
  objective: "Inspect selected source", selectedFiles: [{ path: "src/example.ts" }],
});
if (result.status === "available") {
  // Include result.value.items in the host's task context.
} else {
  // Use the host's existing context retrieval fallback.
}
await host.close();
```

`createContributionHost` takes one immutable generation ID, capabilities, static
plugin manifests and optional direct `core` definitions. `host.generationId` and
`host.capabilities` are frozen snapshots. API version 1 is supported. Disabled,
version-incompatible or capability-incompatible plugins do not load. A request
with the wrong contribution kind also does not load. Declared IDs are unique
across all kinds, core definitions and plugins, including disabled plugins.
Duplicate declarations or malformed configuration throw during construction.

Concurrent first requests share one lazy activation. A loader returns the
complete array of definitions; IDs, kinds and callable fields must exactly match
its declarations before any definition is published. Failure is cached for this
host lifetime. There is no retry, discovery, reload or generation replacement
manager. A caller can construct a separate generation after settling the old one.

## Data and observations

Each callback receives a copied, frozen `ContributionRequest` containing only
`generationId`, `revision`, `objective` and `selectedFiles`. Each file reference
contains `path` and an optional `revision`; it does not provide file contents or
filesystem access. Unknown fields are omitted. The caller supplies the revision;
the host binds returned observations to that revision but does not independently
verify repository identity or read files.

Context callbacks return `ContextData`: `items` with `text` and optional `source`.
Diagnostic callbacks return `DiagnosticData`: `findings` with severity
`info | warning | error`, `message` and optional `path`. Returned data is
validated, copied and recursively frozen. Changes to a caller's input or a
plugin's retained output cannot change an admitted request or published result.

Bounds use JavaScript UTF-16 string length. Generation IDs, capability names,
plugin IDs and contribution IDs allow 128 characters; revisions allow 256;
objectives allow 16,384; file paths and source references allow 1,024. Requests
allow 64 selected files. Each response allows 64 entries, each text/message up to
32,768 characters, with combined text/message and path/source length at most
65,536. Nonempty values are required except context text. Configuration allows
128 capabilities, 128 plugins, and 128 definitions per plugin/core array. An
invalid request returns `unavailable` before activation; invalid responses return
`unavailable` without truncation or a partial observation.

`ContributionResult<T>` is either `{ status: "available", generationId,
revision, value }` or `{ status: "unavailable", reason }`. Reasons are `missing`,
`incompatible`, `activation-failed`, `invalid-request`, `failed`, `aborted`, and
`closed`. Callback error details are not returned. A diagnostic being available,
empty or unavailable never means PASS, accepted completion or authorization to
apply changes. Hosts must retain their independent acceptance process.

## Cancellation and lifetime

`context(id, request, signal?)` and `diagnose(id, request, signal?)` isolate each
caller's abort from shared activation. An aborted caller receives unavailable
promptly. If its callback is already running, its signal aborts, while the host
continues tracking actual settlement. Activation sees only the host lifetime
signal. Callbacks see both the host lifetime and their caller's signal.

`close()` synchronously stops admission, aborts the lifetime signal, prevents
late activation/result publication and awaits all admitted operations, including
activation and callbacks. It is idempotent. A loader or callback that never
settles leaves `close()` pending: cancellation alone is not proof of drain.
Closing cannot undo arbitrary module-import effects. Cooperative code must stop
and settle on abort. No callback timeout, process termination or effect rollback
is provided.

## Trust boundary and testing

Plugins run as trusted Node code in the same process. Capability declarations
control admission; they do not sandbox filesystem, network, imports or other
ambient authority. Requests expose no raw stores, Pi objects, credentials,
acceptance, apply methods or command tools. Load only code trusted with the
host's process privileges. This library does not automatically register plugins
with native execution or alter CLI behavior.

The testing entry exports existing `FakeExecutor`, `GatedExecutor` and the types
`AgentExecutor`, `AgentExecutionRequest`, `ExecutionEvent`. They exercise existing
execution behavior; they provide no production qualification or acceptance.
Runnable consumers are [context + FakeExecutor](../examples/sdk-consumer-context.mts)
and [diagnostic](../examples/sdk-consumer-diagnostic.mts).

For an opt-in offline packed-consumer check:

```powershell
$ErrorActionPreference = 'Stop'
pnpm build
pnpm pack --out .agent_workspace/staged-continuation/sdk-package.tgz --json
node scripts/sdk-consumer-probe.mjs
```

The probe extracts actual tarball bytes into a separate consumer, compiles both
examples with NodeNext and runs them. It checks representative existing dist,
source, extension and package-metadata paths plus CLI version. It reuses the
checkout's installed dependencies through a local link and its TypeScript tool;
it performs no network installation or publication. This is not a clean-registry
install or full interactive Pi compatibility test. Packaging has no prepack,
prepare or postpack lifecycle script; `prepublishOnly` remains reserved for the
existing publication workflow.

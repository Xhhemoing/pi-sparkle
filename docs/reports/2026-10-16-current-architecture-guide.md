# Current architecture and interactive guide — verification record

## Identity

- Task: `TASK-20261016-current-architecture-guide`.
- Date: 2026-10-16 UTC.
- Source baseline: PR #60 `740767403ef634c9d6f8be7829f8f489be7a68db`; main `44db4b1`; separate PR #61 `c4a9e3cd6cb9d7898fce8cd33c7d4c1288fe39fa` is not integrated.
- Scope: repository documentation and a self-contained, manually controlled HTML explanation. No runtime, dependency, schema, tool authority or package metadata changes.
- Decision: the user accepted the reviewed lightweight adaptive architecture and requested the current design in the project, without a numbered-revision presentation.
- Owners: separate architecture author and HTML author; root integrates entries and evidence; independent reviewer did not author the target files.
- State: documentation verified and independently reviewed; ready for publication to PR #60.

## Changes

The maintained entry points are [the framework](../framework.md),
[algorithm contracts](../architecture-algorithms.md), [migration plan](../architecture-migration.md),
[HTML explanation](../architecture.html) and [ADR-009](../decisions/0009-lightweight-adaptive-framework.md).
README links these entry points. Older quality snapshots retain their original
evidence and now have a historical banner. The status matrix separates design
acceptance from implemented, exercised and outcome-supported behavior.

The HTML is an offline document with a stable repository path. Future architecture
changes should update these maintained files together; a downloaded copy does not
retrieve or silently follow later remote changes. Supporting evidence may name a
commit or dependency release without turning the presentation into a release deck.

## Commands

| Command / check | Result | Scope |
|---|---|---|
| `corepack pnpm@10.17.1 --version` | PASS: `10.17.1` | Genuine pinned package manager, not the environment's fallback pnpm |
| `corepack pnpm@10.17.1 workflow:check` | PASS: 10 required files, 16 required headings | Repository documentation workflow |
| `python .agent_workspace/current-architecture-guide/check-links.py` | PASS: 557 local references, 0 missing | Changed Markdown/HTML files, including source references and HTML anchors |
| `node .agent_workspace/current-architecture-guide/root-browser.cjs` | PASS: 12 chapters, 34 manual step controls | Actual local HTML; previous/next/reset, keyboard, reading and detail controls; 390/768/1280/1440 px widths |
| Chromium offline / no-JS / reduced-motion / PDF print | PASS | 0 page errors, 0 external resource requests; 12 chapters readable without JS; reduced animation and cross-chapter printed text verified |
| Screenshot inspection | PASS | Desktop cover and responsibility diagram, plus mobile layout; no horizontal overflow at tested widths |
| `node .agent_workspace/current-architecture-guide/independent-browser-review.mjs` | PASS: 15/15 independent browser checks | Includes deferred-scroll regression, mobile motion control, 320/390 px layouts, native details/focus and HTML anchor identities |
| Independent documentation review | PASS; no remaining blocking finding | Separate reviewer checked architecture/ADR/status, algorithm and migration consistency and actual HTML |
| `git diff --check` | PASS | No whitespace errors |
| Full product gate / paid model evaluation | NOT RUN | Documentation-only scope; no runtime behavior changed |

## Behavioral Evidence

This delivery establishes an explanation and migration contract, not an implemented
adaptive runtime. Checks exercised the actual HTML controls and rendered layout.
Temporary scripts, browser output and screenshots live under
`.agent_workspace/current-architecture-guide/`; no private run data is published.

The first link scan ran while new files were still being authored, so it reported
the not-yet-created targets. It also found two older checklist references: a wrong
relative path was corrected, and an absent historical report was retained as an
explicit unavailable text reference. The completed scan passed; historical task
status and evidence claims were not rewritten.

One author's plain `pnpm workflow:check` hit the environment's fallback wrapper,
which tried an automatic install and exited with `ERR_PNPM_IGNORED_BUILDS` for
`@google/genai@2.21.0`, `esbuild@0.28.2` and `protobufjs@7.6.5` before running the
workflow script. No build approval was granted. The wrapper's four-line
`allowBuilds` addition to `pnpm-workspace.yaml` was removed exactly, and the file
has no diff. Both direct `node scripts/workflow-check.mjs` and the genuine pinned
`corepack pnpm@10.17.1 workflow:check` passed. This was an environment-wrapper
failure, not a failed product assertion or a dependency change in this delivery.

## Independent Review and Corrections

The reviewer did not author the target files. The final verdict is **PASS for the
documentation delivery**, with no remaining blocking finding. The review covered
the existing ADRs and sampled controller/store/review behavior as well as the
new design, implementation labels, HTML and migration boundaries.

- A reading-mode scroll callback could run after returning to guide mode and jump
  from `core` to `evidence` while leaving the URL at `#core`. The author cancels the
  pending timer and rechecks the active mode. Independent verification waited
  250 ms after rapid mobile toggling; root separately waited 300 ms. Both retained
  the correct chapter and URL.
- The unsupported twelve-PR ceiling was removed; M0–M7 can be split further.
- New SDK consumers use supported entry points, while old deep imports retain an
  explicit forwarding/migration window.
- Obsolete plugin proposals are rejected, but late effect receipts and usage still
  reach host reconciliation. The HTML and algorithm document now agree.
- Unarchived scratch prototype test counts were removed from the maintained guide;
  they do not serve as this delivery's product evidence.
- Author checks also corrected a mobile animation-toggle placement issue and print
  CSS that needed to hide controls and expose closed detail content. Root verified
  the final PDF contains detail text and no playback controls. Continuous-reading
  up/down arrows retain native scrolling.

The independent harness initially used an incorrect relative file URL and failed
before opening the product; the corrected harness produced the recorded 15/15
result, with zero browser errors or automatic external requests. Visual inspection
confirmed the desktop and mobile hierarchy and readable diagram controls. This is
a focused browser/accessibility review, not exhaustive cross-browser or
screen-reader certification. Product tests and production gates remain separate.

## Risks and Gates

- The nested-runner cancellation P0 is carried forward from the earlier architecture research: an equivalent POSIX nested detached-runner experiment kept writing after the outer timeout settled. This was not a real `develop` end-to-end reproduction or a fix. M0 must reproduce and settle the actual path before expanding process ownership or parallel writing.
- Documentation review does not establish Pi compatibility with arbitrary future releases, production reliability, actual provider savings or learning benefit. These require the migration plan's behavioral and outcome checks.
- Existing ADR-001/006 Pi boundaries and ADR-008 opaque identity/exact-byte rules remain in force. Explicit task presentation preferences are separate from immutable active learned-resource snapshots.
- S0-min, R10/R11, F6/F-PROD, root cost settlement, live-provider validation and production/outcome gates remain open on their own evidence.
- No merge into main, deployment or PR #61 integration is part of this task.

Carried-forward P0 evidence at source `7407674` (Node 24.19.0, Linux):
[controller](../../src/development/controller.ts) prepares the aggregate command,
[independent-check](../../src/execution/independent-check.ts) runs it, and
[recipe-check](../../src/development/recipe-check.ts) starts each recipe through the
same [command runner](../../src/execution/command-runner.ts). Both POSIX levels use
separate detached groups. The equivalent fixture used a 750 ms outer and 10 s
inner timeout; it reported `outerStatus=timed_out`, `outerSignal=SIGTERM` and a
heartbeat increasing from 23 to 29 after outer settlement. Its separate final
cleanup reported absent child, no further writes and removed temporary directory.
The fixture substituted only the unused configuration-error import when loading
TypeScript, and did not run the controller end to end. These observations explain
the migration priority; they are not fresh product-test results from this
documentation delivery. Actual configured aggregate/recipe limits differ, so
explicit operation cancellation is a particularly relevant real-path regression.

## Handoff

Keep the framework, algorithm contracts, migration plan, ADR and HTML consistent
when the architecture changes. The next runtime slice is migration M0; the other
modules remain bounded, optional work with their own acceptance evidence.

Publication verification will be recorded after the documentation commit is pushed
to the existing PR #60 branch. The [task plan](../superpowers/plans/2026-10-16-current-architecture-guide.md)
and [active checklist](../../tasks/todo.md) track this documentation delivery.

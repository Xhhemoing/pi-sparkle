# Scoped work-item queue verification

## Identity

- Task: `TASK-20261015-project-work-items`; author: baseline agent.
- Date/environment: 2026-10-15, Linux, Node 24.19.0.
- [Plan](../superpowers/plans/2026-10-15-project-work-items.md).
- Source: `src/development/work-items.ts`, `src/development/work-item-store.ts`.

## Commands

| Command | Result | Evidence |
|---|---|---|
| New schema/store tests before implementation | RED: two test modules failed to load missing implementation modules | `work-items-red.log`; this is feature-absence evidence, not a pre-existing product regression |
| `node scripts/run-tests.mjs test/unit/development/work-items.test.ts test/integration/development/work-item-store.test.ts` | PASS: 12 / 0 / 0 | `work-items-first-green.log` |
| Same tests plus `test/unit/persist/file-lock.test.ts test/unit/persist/atomic-file.test.ts` | PASS: 39 / 0 / 0 | `work-items-neighbors.log` |
| `node node_modules/typescript/bin/tsc --noEmit` | PASS, exit 0 | `work-items-typecheck.log` |
| ESLint on the two source files and two test files | PASS, exit 0 | `work-items-lint.log`; initial unnecessary regex escape corrected |
| Independent-review regression before fix | RED: 5 pass / 1 fail, unresolved prerequisite incorrectly accepted | `work-items-invariant-red.log` |
| Queue suites plus persistence neighbors after prerequisite-state fix | PASS: 40 / 0 / 0 | `work-items-invariant-green.log` |
| Affected ESLint after prerequisite-state fix | PASS, exit 0 | `work-items-invariant-lint.log` |
| `node node_modules/typescript/bin/tsc --noEmit` after prerequisite-state fix | PASS, exit 0 | `work-items-invariant-typecheck.log` |
| Protected-checker schema tests before parser support | RED: 6 pass / 1 fail, supported field rejected | `work-items-protected-red.log` |
| Sparse/accessor protected-path list before ordinary-slot validation | RED: 6 pass / 1 fail | `work-items-protected-array-red.log` |
| Queue schema/store after protected-path support | PASS: 14 / 0 / 0 | `work-items-protected-green.log` |
| TypeScript and affected ESLint after protected-path support | PASS, exit 0 for each | `work-items-protected-typecheck.log`, `work-items-protected-lint.log` |

Logs are beneath `.agent_workspace/architecture-20261015/`. These are author-run focused checks. Research agent independently reviewed the final schema/store and ran the 13 queue tests successfully after the prerequisite-state fix; no remaining scoped blocker was reported. Root owns CLI integration and the final combined gate.

## Behavioral Evidence

The queue is a host-authored execution projection of an existing plan, named by `authorityRef`, stored at a host-selected scoped path. It does not supersede `tasks/plan.md`, accepted ADRs or the status matrix. Definitions carry ID, goal, dependency IDs, literal relative scope prefixes, priority and named command/version recipes. The schema rejects unknown fields, unsafe scopes, unknown/duplicate/cyclic dependencies, invalid states and oversized arrays/text. Snapshots are copied and recursively frozen.

Selection is deterministic: dependency readiness, descending priority, then ID. Active running/blocked/review items reserve overlapping scopes; disjoint work remains selectable. The pure selector is advisory. `claimNext` reloads under the existing exclusive file lock, revalidates accepted evidence through a host resolver and creates a random fencing token. Competing store instances cannot double-own the same item. Explicit release invalidates old tokens; clocks never steal a claim or lock.

Independent review found a persisted-state gap: an accepted descendant could carry structurally valid evidence while its own prerequisite remained planned, allowing another descendant to advance. A behavioral regression failed before the fix. Validation now requires accepted prerequisites for every non-planned item, so the entire transitive chain obeys the same invariant as reachable host transitions. The corrected queue and persistence suites pass 40 tests. Artifact authenticity remains separately checked by the host resolver.

Controller review also found that a recipe's decisive checker could be inside the worker's allowed write scope. Optional recipe `protectedPaths` now carries at most 16 unique literal repository-relative prefixes with the same path restrictions as write scopes. Lists are copied/frozen; sparse or accessor slots are refused. Absent fields retain legacy library compatibility, and an explicit empty list is representable. The controller owns requiring protection for non-inline checks, denying writes to protected prefixes and verifying unchanged checker bytes against the clean base; its integration is separately reviewed. Complete declaration of checker dependencies remains the host's responsibility; this field does not infer command imports or execute checks itself.

Research agent independently re-reviewed this additive protected-path schema and ran its focused regression successfully, with no scoped blocker. This review covers the schema field and snapshot behavior; it does not assert completion of the controller's protection enforcement.

`markReady` and the separate explicit `accept` action require exact item/base revision/recipe/version/command/argv evidence plus a required host-owned artifact resolver. No success boolean grants authority. An absent, refusing, throwing or timed-out resolver leaves state unchanged. Accepted dependency evidence is resolved again before later selection/claim; deleted or stale artifacts can block continuation. Resolver inputs are immutable and carry the complete definition/scope and claim. A record's original base is retained; the host verifier owns ancestry/current-source rules for accepted dependencies.

State writes reuse `writeFileAtomic` with owner-only permissions and `withExclusiveFileLock`. Reads are bounded to 1 MiB, reject links/nonregular files and changed-during-read data, and parse strict state. New queues can only contain planned items; existing queue creation refuses overwrite. Existing locks are never automatically removed or stolen.

## Risks and Gates

- The callback is a trusted host dependency. It must resolve actual run artifacts and current candidate/recipe identity; the schema alone cannot authenticate evidence. Filesystem access by an equally privileged hostile actor is not an authentication boundary.
- Queue claims persist until explicit host release/transition. This preserves unknown-effect recovery; it is not a wall-clock lease or unattended recovery daemon.
- Scope prefixes reserve work, but enforcement of actual changed files belongs to the host verifier/execution controller. This queue does not execute commands or edit code.
- Default file limit is 1 MiB; maximum 128 work items and 8 recipes per item. Per-item host verification timeout defaults to 30 seconds, configurable up to 300 seconds; lock acquisition defaults to 5 seconds, capped at 30 seconds.
- The queue does not invent criterion outcome schemas, approve native application, promote policies, run paid providers or close production/outcome gates. Root's control plane and durable action ledger remain separately verified slices.

## Handoff

Root uses `createWorkQueue`, `WorkItemStore` and the exported DTOs for CLI/controller integration. `load` and the pure selector are inspection/advisory APIs; execution goes through `claimNext`. The host must register a real evidence resolver before ready/accept/dependency advancement, including checking that prerequisite results are available in the source used by their dependents. Independent review is complete for this slice; the final integrated gate remains outstanding.

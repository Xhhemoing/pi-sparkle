# Native apply registration — verification record (2026-09-20)

## Scope

`TASK-20260920-native-apply-registration` first implementation slice on branch
`feat/native-apply-registration` (base main `cf1f0da6`). Plan:
[2026-09-20-native-apply-registration](../superpowers/plans/2026-09-20-native-apply-registration.md).

- `src/native/apply-registration.ts` (new): host-facing registration boundary —
  `issueApplyRegistration` (persists the exact accepted write result as a
  content-addressed `native-apply-registration` loop artifact under the run
  subtree), `applyIssuedCandidate` (reconstructs the trusted result from
  hash-verified artifact bytes only; never from tool parameters),
  `findAcceptedLoopArtifact` (locates the write path's own final
  `ps-p3-closed-loop` record by content conditions: `acceptance.accepted ===
  true` and `acceptance.artifactHash === issued address`), `disposeIssuedCandidate`
  (delegates to the apply session's managed-path check).
- `extensions/pi-sparkle/index.ts`: new `sparkle_apply_candidate` tool —
  parameters are only the issued handle (`issue.runId`, `issue.artifactSha256`,
  `issue.candidatePath`, `candidatePath`); session-scoped `issuedCandidates`
  map; handles are issued exclusively through the new host-only
  `/sparkle-issue-candidate` command (typed by the user from the host-held
  write result; the model cannot invoke commands). No changes to
  `sparkle_delegate`. `SPARKLE_NATIVE=0` suppresses both tools via the
  existing early return.
- `test/unit/native/apply-registration.test.ts` (new): RED→GREEN refusal
  matrix — non-accepted results refused at issue; foreign run ids and wrong
  artifact hashes refused at apply; mutated results map to different artifact
  addresses (content-bound handles); disposal refuses unmanaged paths; handle
  shape pinned.
- `test/integration/native/apply-registration.test.ts` (new): full round-trip
  through Pi's real extension loader — trusted write (real git fixture) →
  unissued-handle refusal → host-only issue command → tool apply → source
  carries candidate content → verification passes at source root.
- `test/unit/native/extension.test.ts`: tool-surface pin now asserts exactly
  `sparkle_delegate` + `sparkle_apply_candidate` and that the apply tool's
  parameter keys are only `["candidatePath", "issue"]`.
- `docs/status-matrix.md`: native candidate application row updated
  (registered; trust boundary described).

## Trust boundary (summary)

The apply path executes `acceptance.command`/`args` inside the candidate.
Those fields therefore must never be model-controlled:

1. The write session freezes the host verification command at preflight.
2. Registration persists the accepted result as hash-addressed bytes.
3. The tool accepts only a handle; the result is rebuilt from those bytes.
4. Handle issuance is a slash command — a host/user surface, not callable
   from the model's tool set.
5. `candidatePath` must match both the handle and the stored record; the
   source must be clean at exactly `sourceRevision`; apply still refuses
   unaccepted/stale/non-fast-forward states before any mutation.

## Commands

| Command | Outcome |
|---|---|
| `pnpm test test/unit/native` | 23 pass / 0 fail (incl. 4 new registration unit tests, 2 loader pin tests) |
| `pnpm test test/integration/native` | 15 pass / 0 fail (incl. round-trip integration) |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm build` | exit 0 |
| `pnpm security:probe` | PASS, 0 open / 0 waived |
| `pnpm pi:probe` | PASS (pins 0.85.1 ×2, legacy identifier, ThinkingLevel import) |
| `pnpm workflow:check` | ok |
| `git diff --check` | exit 0 |

Full `pnpm gate` (serialized full suite) not yet run on this host session;
preceding slices recorded Windows resource contention for the parallel gate —
run `pnpm test -- --test-concurrency=1` before final delivery if the parallel
gate is flaky.

## Behavioral Evidence

- A model-supplied result object can never reach `NativeApplySession.apply`:
  the tool's TypeBox schema has no field that could carry a command, and the
  module refuses anything but the exact registered artifact body.
- Issued handles are content-bound: re-registering a mutated result produces
  a different artifact sha (asserted), and reads verify the on-disk hash.
- Foreign run ids (no run directory / no RUN_CREATED) are refused by the
  durable-run identity contract before any artifact is read.
- The round-trip integration test drives the real Pi loader
  (`loadExtensions`), the real git worktree plumbing, and the real
  independent-check execution — no live LLM.

## Handoff

- Remaining in `TASK-20260920-native-apply-registration`: serialized full
  suite, owner authorization (gate G3) for the first host-mutable tool
  registration, luna-fast independent review dispatch, PR + review package.
- The tool is registered but inert until a host issues a handle; there is no
  automatic write→apply chaining (write remains unregistered).
- F-PROD, live routing, Outcome-supported: unchanged and open.

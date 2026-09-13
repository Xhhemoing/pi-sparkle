# G1B — tool and artifact boundaries (2026-09-13)

## Identity
- Seat: Sparkle Implementer
- Ticket: PS-G1B
- Branch/worktree: `grok/trusted-execution-g1b` @ `E:\Project\pi-sparkle-g1b`
- Base: `eb6166ac7b6ca47cba1a28057169983f9f21c59b`

## Behavior delivered
- `resolveInsideRoot` refuses out-of-root symlinks/junctions (lexical resolve + `lstat`/`realpath` walk of existing components, including parent-dir links). Residual TOCTOU: a link can still be swapped after the check returns.
- `sparkle_run_command` is **default deny** without host `commandPolicy` (executable + optional argv prefix, env allowlist, timeout/output caps). Documented as **not** an OS sandbox: allowed executables (including repo test scripts) can still perform arbitrary process work; enable only for trusted fixtures / host-chosen rules. Untrusted model products need external OS isolation.
- `runIndependentCheck` reuses `authorizeCommand`. When no policy is passed, the host-supplied command is treated as an allow rule with empty env allowlist (host API, not model default-deny).
- Loop artifacts use `loop-artifact-v1` envelope (`schemaVersion`, `runId`, `body`). `readLoopArtifact` verifies on-disk byte hash + schema/runId; tampered JSON that still parses is refused. `save`/`read` take `runLockPath` (same cooperative lock as `deleteRunRecords` / ObservationStore). Save/read refuse when the run directory is missing — **no revive after delete**. `runClosedLoopCheck` creates the run directory once up-front; recursive mkdir under a missing run is not used as a revive path.

## Migration
- Callers of `createWorktreeCodingTools` that need `sparkle_run_command` must pass `commandPolicy.allow`.
- On-disk loop artifact shape gains the v1 envelope; content address covers the full file bytes.

## Residual limits
- Symlink/junction checks are best-effort vs TOCTOU.
- Nested acquisition of `runLockPath` (e.g. save inside `withRunLifecycleLock`) would deadlock — not reentrant; G1B does not add unlocked variants.
- Windows hosts without symlink privilege may soft-skip symlink unit cases; ticket not closed by skip alone — verify on a privileged environment when available.
- Process isolation is not provided by this PR.
